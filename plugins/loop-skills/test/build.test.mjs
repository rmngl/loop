import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";

test("build emits one module whose only export is apply", async () => {
  const out = execFileSync(process.execPath, ["plugins/loop-skills/scripts/build.mjs"], {
    encoding: "utf8",
  });
  assert.match(out, /built plugin\.js/);
  const text = await readFile("plugins/loop-skills/plugin.js", "utf8");
  assert.equal(/^\s*import\s/m.test(text), false, "plugin.js must contain no import");
  const exported = [...text.matchAll(/^export\s+/gm)];
  assert.equal(exported.length, 1, "the entry keeps exactly one export, apply");
  assert.match(text, /^export function apply\(/m);
  // Proves it is a real module the host can import, not just text that looks right.
  const { apply } = await import(`../plugin.js?built=${Date.now()}`);
  assert.equal(typeof apply, "function");
});

test("build refuses two modules exporting the same name", async () => {
  // Both files are written here, so this test does not depend on any real module.
  // A silent shadow would make one module's function answer for another's.
  const one = "plugins/loop-skills/src/_dupe-a.js";
  const two = "plugins/loop-skills/src/_dupe-b.js";
  await writeFile(one, "export function collide() { return 1; }\n", "utf8");
  await writeFile(two, "export function collide() { return 2; }\n", "utf8");
  try {
    assert.throws(
      () => execFileSync(process.execPath, ["plugins/loop-skills/scripts/build.mjs"], { stdio: "pipe" }),
      /Duplicate export collide/,
    );
  } finally {
    await rm(one, { force: true });
    await rm(two, { force: true });
  }
});
