// plugins/loop-skills/test/plugin.test.mjs
// Drives apply() with a fake ctx shaped exactly like the host's, so the
// registration contract is checked without Buzz installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { apply, inject } from "../plugin.js";
import { HELPER_SOURCE } from "../src/helper.js";

/** A ctx that records what apply registers and can actually run the helper. */
async function fakeCtx() {
  const dir = await mkdtemp(join(tmpdir(), "loop-ctx-"));
  const root = join(dir, "SKILLS");
  await mkdir(join(root, "_drafts"), { recursive: true });

  const tools = [];
  const cards = [];
  const notifications = [];
  const instructions = [];
  const effects = [];

  const ctx = {
    agents: {
      addTool: (tool) => {
        if (tools.some((t) => t.name === tool.name)) throw new Error(`duplicate tool ${tool.name}`);
        tools.push(tool);
      },
      addInstructions: (block) => instructions.push(block),
    },
    settingsCards: { register: (card) => cards.push(card) },
    notifications: {
      register: ({ id, label }) => {
        const record = { id, label, submitted: [] };
        notifications.push(record);
        return { submit: async (item) => { record.submitted.push(item); } };
      },
    },
    host: {
      resolveDirectory: async () => root,
      spawn: async (_id, { args }) => {
        const { spawn: realSpawn } = await import("node:child_process");
        const child = realSpawn(process.execPath, args);
        // The host delivers stdout through the option, not the return value, so
        // the fake does too — anything else would not exercise the real seam.
        let listener;
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (d) => { if (listener) listener(d); });
        const exited = new Promise((done) => child.on("exit", () => done(0)));
        return {
          onStdout: (fn) => { listener = fn; },
          exited,
          write: async (data) => { child.stdin.write(data); },
          end: async () => { child.stdin.end(); },
        };
      },
    },
    effect: (fn) => effects.push(fn),
    plugin: (spec) => {
      // The host scopes a child plugin; here it applies immediately and returns
      // a dispose handle, which is what the injection holder replaces.
      spec.apply({ agents: { addInstructions: (b) => instructions.push(b) } });
      return { dispose: () => {} };
    },
  };
  return { ctx, root, tools, cards, notifications, instructions, effects };
}

test("inject names exactly the services apply touches", () => {
  assert.deepEqual([...inject].sort(), ["agents", "host", "notifications", "settingsCards"]);
});

test("apply registers three tools and one notification", async () => {
  const f = await fakeCtx();
  apply(f.ctx);
  // apply starts async work; give the first refresh a tick.
  await new Promise((r) => setTimeout(r, 300));

  assert.deepEqual(f.tools.map((t) => t.name).sort(), ["skills_draft", "skills_list", "skills_read"]);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].id, "draft");
  // Neither the settings card nor the injection block exist yet: Tasks 7 and 8
  // add them. Asserting them here would make this test fail until those land,
  // which is not a defect in this one.
  assert.equal(f.cards.length, 0, "Task 8 adds the library card");
  assert.equal(f.instructions.length, 0, "Task 7 adds the injection block");
});

test("skills_draft through the real spawn writes a draft and notifies once", async () => {
  const f = await fakeCtx();
  apply(f.ctx);
  await new Promise((r) => setTimeout(r, 300));

  const draft = f.tools.find((t) => t.name === "skills_draft");
  const reply = await draft.call({}, { channel: "chan-1", session: "sess" }, {
    slug: "weekly-report", name: "주간 보고", description: "매주 같은 규칙",
    body: "# 절차\n1. 한다", why: "매번 설명한다",
  });
  assert.match(reply, /waiting for the owner/i);

  const written = await readFile(join(f.root, "_drafts", "weekly-report.md"), "utf8");
  assert.match(written, /why: 매번 설명한다/);

  // One notification for a new draft. A second draft of the same slug is
  // refused as pending, so it must not notify again.
  await draft.call({}, {}, {
    slug: "weekly-report", name: "주간 보고", description: "매주 같은 규칙",
    body: "# 절차\n1. 한다", why: "매번 설명한다",
  });
  assert.equal(f.notifications[0].submitted.length, 1, "a pending draft does not re-notify");
});

test("a tool call answers with a sentence when the host refuses to spawn", async () => {
  const f = await fakeCtx();
  f.ctx.host.spawn = async () => { throw new Error("Processes require an installed desktop plugin"); };
  apply(f.ctx);
  await new Promise((r) => setTimeout(r, 300));
  const list = f.tools.find((t) => t.name === "skills_list");
  const reply = await list.call({}, {}, {});
  assert.match(reply, /couldn't read|desktop/i);
});

test("HELPER_SOURCE is a real module the spawned process can run", async () => {
  assert.match(HELPER_SOURCE, /process\.stdin/);
  assert.ok(Buffer.byteLength(HELPER_SOURCE) < 24_000);
});
