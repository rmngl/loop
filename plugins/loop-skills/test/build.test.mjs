// Every build here writes to a temporary file, never to `plugin.js`.
//
// `plugin.js` is imported by loop, plugin, reload and host-contract tests. A
// build that rewrote it in place raced those imports and failed with EBUSY on
// Windows — the suite went from 73/73 to a hard error with no source change.
// The committed artifact is checked by `--check` instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = "plugins/loop-skills";
const BUILD = `${ROOT}/scripts/build.mjs`;

/** Build into a throwaway file and return its text. */
const buildTo = async (dir, name = "plugin.js") => {
  const out = join(dir, name);
  execFileSync(process.execPath, [BUILD, "--out", out], { encoding: "utf8" });
  return readFile(out, "utf8");
};

const tempDir = () => mkdtemp(join(tmpdir(), "loop-build-"));

test("build emits one module whose only export is apply", async () => {
  const dir = await tempDir();
  try {
    const out = join(dir, "plugin.js");
    const stdout = execFileSync(process.execPath, [BUILD, "--out", out], { encoding: "utf8" });
    assert.match(stdout, /built plugin\.js/);
    const text = await readFile(out, "utf8");
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
    const mod = await import(pathToFileURL(out).href);
    assert.equal(typeof mod.apply, "function");
    assert.ok(Array.isArray(mod.inject));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
  const dir = await tempDir();
  try {
    const text = await buildTo(dir);
    // The bundle must carry the helper, or the installed plugin has no write path.
    assert.match(text, /loop:skills:start/, "the helper's pointer block is embedded");
    assert.match(text, /process\.stdin/, "the helper reads its request from stdin");
    const { HELPER_SOURCE } = await import("../src/helper.js");
    const bytes = Buffer.byteLength(HELPER_SOURCE, "utf8");
    assert.ok(bytes < 24_000, `helper source is ${bytes} bytes; Windows allows ~32767 for the whole line`);
    // The helper is legitimate module code, so its imports ARE at column 0. What
    // must not happen is the build's export scan hoisting them out of the string.
    assert.match(HELPER_SOURCE, /^import \{.*\} from "node:fs\/promises";/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the committed plugin.js matches what src/ builds to", async () => {
  // The bundle is committed because a Buzz install is a folder copy: a folder
  // without plugin.js does nothing. So drift is a shipping bug, not a nit.
  const dir = await tempDir();
  try {
    const built = await buildTo(dir);
    const committed = await readFile(`${ROOT}/plugin.js`, "utf8");
    assert.equal(
      committed,
      built,
      "plugin.js is stale — run: node plugins/loop-skills/scripts/build.mjs",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("build refuses two modules exporting the same name", async () => {
  // Both files are written here, so this test does not depend on any real module.
  // A silent shadow would make one module's function answer for another's.
  const one = `${ROOT}/src/_dupe-a.js`;
  const two = `${ROOT}/src/_dupe-b.js`;
  await writeFile(one, "export function collide() { return 1; }\n", "utf8");
  await writeFile(two, "export function collide() { return 2; }\n", "utf8");
  const dir = await tempDir();
  try {
    assert.throws(
      () =>
        execFileSync(process.execPath, [BUILD, "--out", join(dir, "plugin.js")], {
          stdio: "pipe",
        }),
      /Duplicate export collide/,
    );
  } finally {
    await rm(one, { force: true });
    await rm(two, { force: true });
    await rm(dir, { recursive: true, force: true });
  }
});
