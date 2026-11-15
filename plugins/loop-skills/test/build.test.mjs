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
  // The helper's source is a template literal containing real `import` lines at
  // column 0. Blank that span, then assert the module itself has none.
  const codeOnly = blankTemplateLiterals(text);
  assert.equal(/^import\s/m.test(codeOnly), false, "plugin.js must contain no top-level import");
  assert.equal(/^\s*export\s+.*\bfrom\s/m.test(codeOnly), false, "no re-exports");
  const exported = [...codeOnly.matchAll(/^export\s+/gm)];
  assert.equal(exported.length, 2, "the module exports exactly inject and apply");
  assert.match(codeOnly, /^export const inject\s*=/m);
  assert.match(codeOnly, /^export function apply\(/m);
  // Proves it is a real module the host can import, not just text that looks right.
  const mod = await import(`../plugin.js?built=${Date.now()}`);
  assert.equal(typeof mod.apply, "function");
  assert.ok(Array.isArray(mod.inject));
});

/** Replace the body of every template literal with nothing, keeping the code. */
function blankTemplateLiterals(text) {
  let out = "";
  let inLiteral = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!inLiteral && ch === "`") { inLiteral = true; out += "``"; continue; }
    if (inLiteral) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === "`") { inLiteral = false; out += ""; }
      continue;
    }
    out += ch;
  }
  return out;
}

test("the build embeds the helper source and keeps it command-line sized", async () => {
  execFileSync(process.execPath, ["plugins/loop-skills/scripts/build.mjs"], { stdio: "pipe" });
  const text = await readFile("plugins/loop-skills/plugin.js", "utf8");
  // The bundle must carry the helper, or the installed plugin has no write path.
  assert.match(text, /loop:skills:start/, "the helper's pointer block is embedded");
  assert.match(text, /process\.stdin/, "the helper reads its request from stdin");
  const { HELPER_SOURCE } = await import("../src/helper.js");
  const bytes = Buffer.byteLength(HELPER_SOURCE, "utf8");
  assert.ok(bytes < 24_000, `helper source is ${bytes} bytes; Windows allows ~32767 for the whole line`);
  // The helper is legitimate module code, so its imports ARE at column 0. What
  // must not happen is the build's export scan hoisting them out of the string.
  assert.match(HELPER_SOURCE, /^import \{.*\} from "node:fs\/promises";/m);
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
