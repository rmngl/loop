// plugins/loop-skills/test/reload.test.mjs
// Review Focus #4, as a test rather than a probe: what actually happens when the
// plugin is reloaded or two revisions are alive at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn as realSpawn } from "node:child_process";
import { apply } from "../plugin.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const workingSpawn = async (_id, { args }) => {
  const child = realSpawn(process.execPath, args);
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
};

/** One shared instruction registry, with the host's duplicate-id rule. */
function registry() {
  const blocks = new Map();
  return {
    blocks,
    add({ id, text }) {
      if (blocks.has(id)) throw new Error(`instructions ${id} already registered`);
      const token = Symbol(id);
      blocks.set(id, { token, text });
      return token;
    },
    remove(id, token) {
      const held = blocks.get(id);
      if (held && held.token === token) blocks.delete(id);
    },
  };
}

function makeCtx(reg, root) {
  const cleanups = [];
  const ctx = {
    agents: { addTool: () => {}, addInstructions: ({ id, text }) => { reg.add({ id, text }); } },
    settingsCards: { register: () => {} },
    notifications: { register: () => ({ submit: async () => {} }) },
    host: { resolveDirectory: async () => root, spawn: workingSpawn },
    effect: (fn) => { cleanups.push(fn); },
    plugin: (spec) => {
      const mine = [];
      spec.apply({
        agents: { addInstructions: ({ id, text }) => { mine.push([id, reg.add({ id, text })]); } },
      });
      return { dispose: () => { for (const [id, token] of mine.splice(0)) reg.remove(id, token); } };
    },
  };
  const disposeAll = () => {
    for (const fn of cleanups.splice(0)) {
      const release = fn();
      if (typeof release === "function") release();
    }
  };
  return { ctx, disposeAll };
}

test("a reload leaves exactly one block: unload removes, reload adds", async () => {
  const root = await mkdtemp(join(tmpdir(), "loop-reload-"));
  const reg = registry();

  const rev1 = makeCtx(reg, root);
  apply(rev1.ctx);
  await wait(300);
  assert.equal(reg.blocks.size, 1, "revision 1 has one block");

  rev1.disposeAll();
  assert.equal(reg.blocks.size, 0, "unloading revision 1 removes its block");

  const rev2 = makeCtx(reg, root);
  apply(rev2.ctx);
  await wait(300);
  assert.equal(reg.blocks.size, 1, "revision 2 has exactly one block");

  rev2.disposeAll();
  assert.equal(reg.blocks.size, 0);
});

test("two revisions alive at once do not throw, and the live block survives", async () => {
  const root = await mkdtemp(join(tmpdir(), "loop-reload-"));
  const reg = registry();

  const rev1 = makeCtx(reg, root);
  apply(rev1.ctx);
  await wait(300);
  const first = reg.blocks.get("skills-index")?.text;
  assert.ok(first, "revision 1 registered");

  const rev2 = makeCtx(reg, root);
  assert.doesNotThrow(() => apply(rev2.ctx), "a second revision must not throw at startup");
  await wait(300);

  // Revision 2 cannot take an id revision 1 still holds, and it must not delete
  // it either: that block is what keeps agents reading the approved procedures.
  assert.equal(reg.blocks.size, 1, "still exactly one block");
  assert.equal(reg.blocks.get("skills-index")?.text, first, "the live block is unchanged");
});
