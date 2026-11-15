// The whole loop, end to end, through the BUILT plugin and a real child process:
// an agent drafts, a human approves, and the text that rides in every turn's
// prompt changes accordingly. This is the product claim, so it gets a test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn as realSpawn, execFile } from "node:child_process";
import { apply } from "../plugin.js";
import { HELPER_SOURCE } from "../src/helper.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run the helper the way the plugin does: source in argv, request on stdin. */
const helper = (root, command, payload = {}) =>
  new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      ["--input-type=module", "-e", HELPER_SOURCE],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (_e, stdout) => {
        const text = String(stdout ?? "").trim();
        try { resolve(JSON.parse(text.split("\n").pop())); } catch { resolve({ ok: false, error: text }); }
      },
    );
    child.stdin.end(JSON.stringify({ command, root, ...payload }));
  });

function harness(root) {
  const blocks = new Map();
  const tools = [];
  const submissions = [];
  const cleanups = [];

  const ctx = {
    react: {
      createElement: () => null,
      useState: (v) => [v, () => {}],
      useCallback: (fn) => fn,
      useEffect: () => {},
    },
    agents: {
      addTool: (tool) => tools.push(tool),
      addInstructions: ({ id, text }) => {
        if (blocks.has(id)) throw new Error(`instructions ${id} already registered`);
        blocks.set(id, text);
      },
    },
    settingsCards: { register: () => {} },
    notifications: {
      register: ({ id, label }) => {
        assert.equal(id, "draft");
        assert.ok(label);
        return { submit: async (item) => { submissions.push(item); } };
      },
    },
    host: {
      resolveDirectory: async () => root,
      spawn: async (_id, { args, onStdout }) => {
        const child = realSpawn(process.execPath, args);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (d) => onStdout?.(d));
        const exited = new Promise((done) => child.on("exit", () => done(0)));
        return {
          exited,
          write: async (data) => { child.stdin.write(data); },
          end: async () => { child.stdin.end(); },
        };
      },
    },
    effect: (fn) => { cleanups.push(fn); },
    plugin: (spec) => {
      spec.apply({ agents: { addInstructions: ({ id, text }) => { blocks.set(id, text); } } });
      return { dispose: () => { blocks.delete("skills-index"); } };
    },
  };
  return { ctx, blocks, tools, submissions, cleanups };
}

test("draft, approve, and the prompt block changes to name the skill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loop-loop-"));
  const root = join(dir, "SKILLS");
  await mkdir(join(root, "_drafts"), { recursive: true });

  const h = harness(root);
  apply(h.ctx);
  await wait(350);

  // 1. Zero skills: the block still tells the agent that drafting exists.
  const before = h.blocks.get("skills-index");
  assert.ok(before, "a block exists with no skills");
  assert.match(before, /아직 승인된 스킬이 없습니다/);
  assert.equal(before.includes("weekly-report"), false);

  // 2. An agent drafts.
  const draftTool = h.tools.find((t) => t.name === "skills_draft");
  const reply = await draftTool.call({}, { channel: "chan-1", session: "sess" }, {
    slug: "weekly-report",
    name: "주간 매출 보고",
    description: "매주 같은 규칙으로 매출 보고서를 만든다",
    body: "# 절차\n1. 유료 주문만 고른다\n2. 원 단위 정수로 쓴다\n",
    why: "여섯 가지 규칙을 매주 다시 설명해야 했다",
  });
  assert.match(reply, /waiting for the owner/i);
  assert.equal(h.submissions.length, 1, "exactly one quiet notification");
  assert.equal(h.submissions[0].sourceKey, "weekly-report");

  // Still not in the prompt: a draft is invisible until approved.
  await wait(350);
  assert.equal(h.blocks.get("skills-index").includes("weekly-report"), false,
    "an unapproved draft must not reach the prompt");

  // 3. The agent cannot read its own draft.
  const readTool = h.tools.find((t) => t.name === "skills_read");
  const refused = await readTool.call({}, {}, { slug: "weekly-report" });
  assert.match(refused, /not readable until/i);

  // 4. The human approves, out of band, as the library does.
  const approved = await helper(root, "approve", { slug: "weekly-report", by: "owner" });
  assert.equal(approved.ok, true);

  // 5. The next tool call refreshes the block, and now the skill is in it.
  await h.tools.find((t) => t.name === "skills_list").call({}, {}, {});
  await wait(350);
  const after = h.blocks.get("skills-index");
  assert.match(after, /weekly-report — 매주 같은 규칙으로 매출 보고서를 만든다/);

  // 6. And the agent can read it, getting the procedure itself.
  const body = await readTool.call({}, {}, { slug: "weekly-report" });
  assert.match(body, /유료 주문만 고른다/);

  // 7. The files are the record; the prompt is derived from them.
  const file = await readFile(join(root, "weekly-report", "SKILL.md"), "utf8");
  assert.match(file, /approved: owner/);
  const log = await readFile(join(root, ".state", "approvals.jsonl"), "utf8");
  assert.match(log, /"action":"approve"/);

  const cleanup = h.cleanups[0]?.();
  if (typeof cleanup === "function") cleanup();
});

test("a rejection reaches the next draft attempt with its reason", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loop-loop-"));
  const root = join(dir, "SKILLS");
  await mkdir(join(root, "_drafts"), { recursive: true });

  const h = harness(root);
  apply(h.ctx);
  await wait(350);

  const draftTool = h.tools.find((t) => t.name === "skills_draft");
  const args = {
    slug: "deploy", name: "배포", description: "프리뷰 배포",
    body: "# 절차\n1. 올린다", why: "매번 설명한다",
  };
  await draftTool.call({}, {}, args);

  await helper(root, "reject", { slug: "deploy", by: "owner", reason: "어느 채널인지 없음" });

  const again = await draftTool.call({}, {}, args);
  assert.match(again, /어느 채널인지 없음/, "the reason is returned so the agent can improve");
  assert.match(again, /Do not resubmit it unchanged/i);
});
