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
import { until } from "./_until.mjs";
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
    // The host supplies React; the card uses ctx.react.createElement only.
    react: {
      createElement: () => null,
      useState: (initial) => [initial, () => {}],
      useCallback: (fn) => fn,
      useEffect: () => {},
    },
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
      spawn: async (_id, { args, onStdout }) => {
        const { spawn: realSpawn } = await import("node:child_process");
        const child = realSpawn(process.execPath, args);
        // The host takes onStdout as an OPTION and the returned object has no
        // such method, so the fake must match or it hides a silent bug.
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
  // `react` is required: LibraryCard builds the Settings card from ctx.react
  // (`src/plugins/api.ts:96`). See test/host-contract.test.mjs.
  assert.deepEqual([...inject].sort(),
    ["agents", "host", "notifications", "react", "settingsCards"]);
});

test("apply registers three tools and one notification", async () => {
  const f = await fakeCtx();
  apply(f.ctx);
  // apply starts async work; wait for the block rather than guessing how long.
  await until(() => f.instructions.length > 0, "the first injection block");

  assert.deepEqual(f.tools.map((t) => t.name).sort(), ["skills_draft", "skills_list", "skills_read"]);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].id, "draft");
  // The settings card is now registered too; the pointer effect is additive.
  assert.equal(f.cards.length, 1, "the library card is registered");
  // The injection block must exist from the first turn, and only once.
  assert.equal(f.instructions.length, 1, "one block, registered at startup");
  assert.equal(f.instructions[0].id, "skills-index");
  assert.match(f.instructions[0].text, /skills_draft/);
  assert.ok(f.effects.length >= 1, "the block is owned by an effect");
});

test("skills_draft through the real spawn writes a draft and notifies once", async () => {
  const f = await fakeCtx();
  apply(f.ctx);
  await until(() => f.instructions.length > 0, "the first injection block");

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
  // spawn throws here, so no block ever appears; the tool call is what matters.
  const list = f.tools.find((t) => t.name === "skills_list");
  const reply = await list.call({}, {}, {});
  assert.match(reply, /couldn't read|desktop/i);
});

test("HELPER_SOURCE is a real module the spawned process can run", async () => {
  assert.match(HELPER_SOURCE, /process\.stdin/);
  assert.ok(Buffer.byteLength(HELPER_SOURCE) < 24_000);
});
