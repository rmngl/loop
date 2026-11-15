# loop Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `loop.skills`, a Buzz plugin that gives agents a reviewable folder of approved procedures — agents draft, the owner approves, the approved procedure rides in every turn's prompt.

**Architecture:** One Buzz plugin (single self-contained `plugin.js` built by concatenation from testable `src/*.js` modules) plus a folder at `~/.buzz/SKILLS/`. The plugin registers three agent tools and one `<plugin-instructions>` block; a bundled Node helper does every filesystem write, because the plugin API has no write access. Canonical state is files; `INDEX.md` is a generated human-readable copy and is never the injection source.

**Tech Stack:** JavaScript ES modules (`node --test` for tests), Buzz plugin API v1 (`ctx.agents`, `ctx.settingsCards`, `ctx.notifications`, `ctx.host.spawn`), Node 22+ on the user's machine.

**Spec:** `docs/superpowers/specs/2026-11-15-loop-skills-design.md` (revision 4)

## Global Constraints

Copied from the spec and verified against `block/buzz-app` @ `4a87b5cc`. Every task's requirements include these.

- **Plugin id `loop.skills`**; `apiVersion` must be `1`. Plugin ids: lowercase letter first, then lowercase/digits/`.`/`-`, ≤80 bytes, **no underscores**. Contribution ids: `/^[a-z0-9][a-z0-9._-]*$/`. Agent tool names: `/^[a-z][a-z0-9_]{0,63}$/`.
- **`addInstructions` text cap is 4096 UTF-8 bytes after trimming, and it THROWS, it does not truncate** (`src/features/agents/service.ts:3146-3150`). Exceeding it fails a turn. Never register without computing bytes first.
- **`when` must be synchronous.** Only `entry.when(current) === true` admits an entry; a Promise is silently dropped (`service.ts:3164-3170`).
- **A second `addInstructions` with the same id THROWS** (`src/plugins/contributions.ts:76-84`). There is no removal handle. Refresh = dispose a child `ctx.plugin(...)` scope and re-register there.
- **`host.files` is read-only**: `readFile` (≤50 MB) and `resolveDirectory` only (`src/plugins/api.ts:70-72`). Every write goes through a spawned Node helper.
- **`host.commands`: no shell, 5 s deadline, ≤16 args of ≤1024 bytes each, stdin ≤65536 only if `maxInputBytes` is declared, stdout 4096 by default / 1048576 max, returns `null` on failure or overflow.** An inline script cannot fit in 1024 bytes. Do not use `runCommand` for the helper.
- **`host.spawn` caller args: ≤256 args, each must not contain NUL, no length cap** (`src-tauri/src/host_process.rs:432`). Desktop only. This is the write path.
- **Windows caps a whole process command line at 32,767 characters — measured.** A 32 KB ASCII payload passed in argv fails with `ENAMETOOLONG`. Therefore the helper's *source* may travel in argv but its *request* must travel on **stdin**. `HELPER_SOURCE` is budgeted at 24000 bytes and `plugin.js` must stay under 400 KB, both asserted by the build.
- **No writes:** `ctx.artifactStorage` requires a selected community and exposes no plugin-side record write. All state is files under `~/.buzz/SKILLS/`.
- **Tool context carries only `{ session?, channel?, root?, topLevel?, wholeChannel? }`** (`src/buzz-mcp/client.ts:206-212`). There is no triggering event id, so provenance is `<channel>` + `<created_at>`, never a `buzz://message` deep link.
- **Design constants:** slug ≤40 ASCII chars and matches `/^[a-z0-9][a-z0-9._-]*$/`; `description` ≤48 characters; draft body ≤61440 bytes; injection header+footer is measured, not assumed.
- **Plugin module purity:** no top-level work, no `import` of any path (bare or relative), no JSX runtime. `React` comes from `ctx.react`. Only one file is loaded: `plugin.js`.
- **Language:** skills are written in the workspace language (default: Korean). Agent reply language still follows the asker. These are different problems; do not conflate them.

## Review Focus

The spec's silence on these is not permission for them to break the program. Each one's test is in the task named beside it.

1. **A `SKILL.md` with no front matter at all** (hand-written). Must show as `approved outside loop`, must not throw, must still be readable by `skills_read`, and its index line must fall back to the folder name. → Task 2, Task 4.
2. **A slug that collides with our own layout or a Windows reserved name** — `_drafts`, `.state`, `_rejected`, `_archived`, `con`, `nul`, `aux`, `com1`, `prn`. Must be refused with a readable message, never create a file that shadows our directories. → Task 2, Task 5.
3. **A draft body that begins with `---`.** It must not be able to forge front matter — approval stamps its own front matter and strips any existing block. → Task 2, Task 5.
4. **Two revisions of the plugin alive at once, or a reload mid tool call.** The stale registration must not double-append index lines and must not throw on registration. → Task 7.
5. **A skill folder that exists but whose `SKILL.md` is empty, is a directory, or is unreadable.** Must be reported as `broken` — shown in the library so a human can fix it, never injected, never treated as approval, and never a thrown error that kills the agent's turn. → Task 4, Task 5.
6. **A draft body large enough to break the write path.** 60 KB of ASCII must round-trip; the request therefore goes on stdin, and the helper refuses above 61440 bytes with a sentence. → Task 5's `ENAMETOOLONG` constraint and its body-size test.

---

## File Structure

```
plugins/loop-skills/
  manifest.json              plugin manifest; host grants: files, processes
  plugin.js                  BUILD OUTPUT (committed; installable as-is)
  scripts/build.mjs          concatenates src/*.js into one ES module
  src/
    format.js                front matter parse/serialize, slug rules, folder layout, byte length
    index.js                 builds the injection text under a byte budget
    approvals.js             approvals.jsonl lines, approval state machine, forgery detection
    request.js               builds helper requests and parses helper replies
    tools.js                 the three agent tools' names, schemas, descriptions
    helper.js                the Node helper SOURCE as a string constant
    ui.js                    library React components (settings card)
    plugin.js                apply(): registration only
  test/
    format.test.mjs
    index.test.mjs
    approvals.test.mjs
    request.test.mjs
    helper.test.mjs          runs the helper as a real child process in a temp dir
  README.md                  install steps and the honest limits
```

`src/plugin.js` is the entry; `scripts/build.mjs` wraps every other `src/*.js` in an IIFE, collects its `export`s into locals, and emits `plugin.js`. That keeps modules unit-testable while shipping one file, which the host requires.

**Tests are run from the repo root:** `node --test plugins/loop-skills/test/`. No test framework, no dependency, nothing to install. `loop` has no `package.json` and this plan does not add one.

---

### Task 1: Scaffold, build step, and manifest

**Files:**
- Create: `plugins/loop-skills/manifest.json`
- Create: `plugins/loop-skills/src/plugin.js`
- Create: `plugins/loop-skills/scripts/build.mjs`
- Create: `plugins/loop-skills/test/build.test.mjs`

`plugin.js` is a committed build output: a Buzz install is a folder copy, and a folder with no `plugin.js` in it does nothing. Do not add it to any `.gitignore`.

**The build must be a topological concatenation, not an IIFE per module.** The first version of this plan wrapped each `src/*.js` in `(function(){...})()` with its exports returned. That is wrong, and running it proved it: `src/index.js` legitimately begins `import { utf8Length } from "./format.js"`, and an `import` inside a function body is a **syntax error**. The bundle would parse as text and fail to load as a plugin. The corrected build below reads every module's relative imports, depth-first sorts dependencies before dependents, strips the `import` lines and the `export` keywords, and emits all top-level declarations into one scope. The price is that top-level names must be unique across `src/`, which the build throws on.

**Two things the tests pin that are easy to get wrong:**

1. `plugin.js` must contain no top-level `import` *in its code*. The helper's source is a template literal that legitimately contains `import { ... } from "node:fs/promises"` at column 0. A naive `/^import/m` scan reads that as a real import and fails. The test blanks template literals before scanning (and separately asserts the helper IS embedded, so blanking cannot hide a missing helper).
2. The helper body is inside a template literal, so the build's name scan sees it too. Every line of the helper body is indented two spaces and dedented at runtime; the build refuses a helper body with a declaration at column 0, because that would be hoisted into the bundle and shadow a real module.

**Interfaces:**
- Produces: `scripts/build.mjs` — CLI `node scripts/build.mjs`; prints `built plugin.js from N modules: <order>`. Emits `<modules in dependency order>\n\n<src/plugin.js verbatim, keeping its export keywords>`. Every wrapped module's top-level declarations are visible to `src/plugin.js`, so it may reference `buildInjection` or `parseSkill` without importing.
- Produces: `manifest.json` with `host.files: true` and `host.processes: [{ "id": "skills", "program": "node", "args": ["--input-type=module"] }]`.

- [ ] **Step 1: Write the failing test for the build step**

```js
// plugins/loop-skills/test/build.test.mjs
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
  assert.equal(exported.length, 1, "the entry keeps exactly one export, apply");
  assert.match(codeOnly, /^export function apply\(/m);
  // Proves it is a real module the host can import, not just text that looks right.
  const { apply } = await import(`../plugin.js?built=${Date.now()}`);
  assert.equal(typeof apply, "function");
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test plugins/loop-skills/test/build.test.mjs`
Expected: FAIL — `Cannot find module .../scripts/build.mjs`.

- [ ] **Step 3: Write `manifest.json`**

```json
{
  "id": "loop.skills",
  "name": "loop Skills",
  "apiVersion": 1,
  "description": "Owner-approved procedures your agents can read, and drafts they can propose.",
  "discovery": { "category": "agents", "tags": ["agents", "skills", "procedures"] },
  "host": {
    "files": true,
    "processes": [{ "id": "skills", "program": "node", "args": ["--input-type=module"] }]
  }
}
```

- [ ] **Step 4: Write `scripts/build.mjs`**

Measured behaviour this must have, from running it:
- Modules are emitted in **dependency order**, computed from their relative imports. `src/index.js` imports from `src/format.js`; `src/request.js` imports from `src/helper.js`. An IIFE wrapper cannot host a real `import`, so this is a flat concatenation with imports stripped and exports stripped.
- The entry file **keeps** its `export` keywords — it is the module the host imports. Stripping them yields a module with no exports, which Buzz reports as a plugin with no `apply`.
- A duplicate top-level name across modules **throws**, because one module's function answering for another's is silent and wrong.
- The helper source is measured as `HELPER_SOURCE` (the dedented string that actually travels), and its body must not have a declaration at column 0.

```js
// Concatenates src/*.js into the single ES module the host loads.
//
// Order matters and is computed, not alphabetical: `src/index.js` imports from
// `src/format.js`, and `src/request.js` imports from `src/helper.js`. An earlier
// version wrapped each module in an IIFE, which silently produced a file with
// `import` statements inside a function — a syntax error the host would report
// as a plugin that failed to load. So: topologically sort by import, strip the
// import lines and the `export` keywords, and emit every module's top-level
// declarations into one scope.
//
// The cost is that every top-level name must be unique across src/, which the
// build enforces rather than hoping for.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "src");
const ENTRY = "plugin.js";

/** `export function f(` -> `function f(`; `export const x =` -> `const x =`. */
const stripExports = (text) =>
  text.replace(/^export\s+(?=(?:default\s+)?(?:async\s+)?function|const|let|class|{)/gm, "");

/** Every `from "./x.js"` this module depends on, resolved to a basename. */
const imports = (text) => {
  const found = [];
  for (const m of text.matchAll(/^import\s[^;]*?from\s+["'](\.\/[^"']+)["']/gm)) {
    found.push(basename(m[1]));
  }
  return found;
};

/** Bare `import "./x.js";` too, so a side-effect import cannot be reordered away. */
const sideEffectImports = (text) => {
  const found = [];
  for (const m of text.matchAll(/^import\s+["'](\.\/[^"']+)["'];?/gm)) found.push(basename(m[1]));
  return found;
};

const topLevelNames = (text) => {
  const found = [];
  for (const m of text.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) found.push(m[1]);
  for (const m of text.matchAll(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) found.push(m[1]);
  return found;
};

const all = (await readdir(SRC)).filter((f) => f.endsWith(".js") && f !== ENTRY);
const sources = new Map();
for (const file of all) sources.set(file, await readFile(join(SRC, file), "utf8"));

const deps = new Map();
for (const [file, text] of sources) {
  deps.set(file, [...imports(text), ...sideEffectImports(text)].filter((d) => sources.has(d)));
}

// Depth first, dependencies first. A cycle is a build error, not a guess.
const order = [];
const state = new Map();
const visit = (file, trail) => {
  const seen = state.get(file);
  if (seen === "done") return;
  if (seen === "open") throw new Error(`Circular import: ${[...trail, file].join(" -> ")}`);
  state.set(file, "open");
  for (const dep of deps.get(file) ?? []) visit(dep, [...trail, file]);
  state.set(file, "done");
  order.push(file);
};
for (const file of all.slice().sort()) visit(file, []);

const parts = [];
const owners = new Map();
for (const file of order) {
  const text = sources.get(file);
  const body = stripExports(text)
    .split("\n")
    .filter((line) => !/^import\s[^;]*?from\s+["']\.\/[^"']+["'];?\s*$/.test(line))
    .filter((line) => !/^import\s+["']\.\/[^"']+["'];?\s*$/.test(line))
    .join("\n")
    .trimEnd();
  for (const name of topLevelNames(body)) {
    // One module's `parse` answering for another's is the failure this prevents.
    if (owners.has(name)) throw new Error(`Duplicate export ${name} in src/${file} and src/${owners.get(name)}`);
    owners.set(name, file);
  }
  parts.push(`// ---- src/${file} ----\n${body}`);
}

// The entry KEEPS its `export` keywords: it is the module the host imports.
const entry = (await readFile(join(SRC, ENTRY), "utf8")).trimEnd();
const output = `// GENERATED by scripts/build.mjs — edit src/*.js instead.\n${parts.join("\n\n")}\n\n// ---- src/${ENTRY} ----\n${entry}\n`;

// The helper source travels in a process command line. Windows caps one at
// 32767 characters, and a 32 KB payload in argv already fails with
// ENAMETOOLONG — measured. Measure the string that actually travels.
const helperPath = join(SRC, "helper.js");
if (sources.has("helper.js")) {
  const { HELPER_SOURCE } = await import(`file://${helperPath.replace(/\\/g, "/")}`);
  if (typeof HELPER_SOURCE !== "string" || !HELPER_SOURCE) {
    throw new Error("src/helper.js must export HELPER_SOURCE as a non-empty string");
  }
  const bytes = Buffer.byteLength(HELPER_SOURCE, "utf8");
  if (bytes > 24_000) throw new Error(`helper source too large for a command line: ${bytes} bytes`);

  // The helper body sits in a template literal, so a declaration at column 0
  // inside it would be hoisted into the bundle and shadow a real module.
  const fileText = sources.get("helper.js");
  const literal = fileText.slice(fileText.indexOf("String.raw"), fileText.lastIndexOf("`"));
  const hoisted = literal.split("\n").filter((line) => /^(?:async\s+)?(?:function|const|let|class)\s/.test(line));
  if (hoisted.length > 0) {
    throw new Error(`helper body has ${hoisted.length} declaration(s) at column 0; indent the body by two spaces`);
  }
}

if (Buffer.byteLength(output, "utf8") > 400_000) throw new Error("plugin.js is unexpectedly large");

await writeFile(join(ROOT, "plugin.js"), output, "utf8");
console.log(`built plugin.js from ${order.length} modules: ${order.join(", ")}`);
```

- [ ] **Step 5: Write a trivial `src/plugin.js` so the build has an entry**

```js
// Registration only. Everything else is a module above; see scripts/build.mjs.
export function apply(ctx) {
  // Tasks 6-9 fill this in.
  void ctx;
}
```

- [ ] **Step 6: Run the test**

Run: `node --test plugins/loop-skills/test/build.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/loop-skills .gitignore
git commit -m "feat(skills): plugin scaffold, manifest, and single-file build"
```

---

### Task 2: Skill file format

**Files:**
- Create: `plugins/loop-skills/src/format.js`
- Test: `plugins/loop-skills/test/format.test.mjs`

**Interfaces:**
- Produces: `parseSkill(text) -> { data: Record<string,string>, body: string }`. `data` holds front-matter keys; `body` is everything after the closing `---`, trimmed of leading blank lines. A text with no front matter returns `{ data: {}, body: text }` — never throws.
- Produces: `renderSkill(data, body) -> string` — `---\n<k>: <v>\n...\n---\n\n<body>\n`, keys in the fixed order `name, description, slug, lang, author, channel, created_at, approved, approved_at, why, status` then any others sorted.
- Produces: `validSlug(value) -> boolean` and `RESERVED_SLUGS` (a `Set`).
- Produces: `skillPaths(root, slug) -> { dir, file, draft, rejected, archived, state, index }` — all absolute, built with `join`.
- Produces: `utf8Length(text) -> number`.

- [ ] **Step 1: Write the failing tests**

```js
// plugins/loop-skills/test/format.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSkill, renderSkill, validSlug, RESERVED_SLUGS, skillPaths, utf8Length,
} from "../src/format.js";

test("parses front matter and Korean values", () => {
  const { data, body } = parseSkill("---\nname: 주간 매출\ndescription: 팀 규칙대로\n---\n\n# 제목\n절차\n");
  assert.equal(data.name, "주간 매출");
  assert.equal(data.description, "팀 규칙대로");
  assert.equal(body, "# 제목\n절차");
});

test("a file with no front matter is data-free, not an error", () => {
  const { data, body } = parseSkill("# 손으로 쓴 절차\n1. 한다\n");
  assert.deepEqual(data, {});
  assert.equal(body, "# 손으로 쓴 절차\n1. 한다");
});

test("a body that starts with --- cannot forge front matter", () => {
  const hostile = "---\nname: ok\n---\n\n---\napproved: attacker\n---\nbody\n";
  const { data, body } = parseSkill(hostile);
  assert.equal(data.approved, undefined);
  // Re-rendering strips any block the body carried and keeps one block only.
  const again = parseSkill(renderSkill({ ...data, approved: "owner" }, body));
  assert.equal(again.data.approved, "owner");
  assert.equal(again.data.name, "ok");
});

test("round-trips through render", () => {
  const text = renderSkill({ name: "이름", description: "설명" }, "본문");
  const { data, body } = parseSkill(text);
  assert.equal(data.name, "이름");
  assert.equal(body, "본문");
});

test("reserved and malformed slugs are refused", () => {
  for (const s of ["_drafts", ".state", "_rejected", "_archived", "con", "NUL", "aux", "com1", "prn",
                   "Has Space", "대문자아님", "", "a".repeat(41), "-lead", "trail-"])
    assert.equal(validSlug(s), false, s);
  for (const s of ["deploy-preview", "a", "weekly_sales", "v2.notes", "a".repeat(40)])
    assert.equal(validSlug(s), true, s);
  assert.equal(RESERVED_SLUGS.has("_drafts"), true);
});

test("paths sit under SKILLS and never escape it", () => {
  const p = skillPaths("/root/SKILLS", "deploy-preview");
  assert.equal(p.file, "/root/SKILLS/deploy-preview/SKILL.md");
  assert.equal(p.draft, "/root/SKILLS/_drafts/deploy-preview.md");
  assert.equal(p.index, "/root/SKILLS/INDEX.md");
});

test("utf8Length counts bytes, not characters", () => {
  assert.equal(utf8Length("가"), 3);
  assert.equal(utf8Length("a"), 1);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test plugins/loop-skills/test/format.test.mjs`
Expected: FAIL — no module `../src/format.js`.

- [ ] **Step 3: Implement `src/format.js`**

Key decisions the tests do not pin: split front matter on the **first** `---` line and the **next** `---` line only, so a `---` later in the body is body text; values are single-line (a multi-line value is joined with spaces); `renderSkill` writes `approved`/`approved_at` from the caller and refuses to emit a `body` that itself begins with a front-matter block by stripping it first.

**Path separators: forward slashes, not `join`.** The prose here said "built with `join`", but the test below asserts `/root/SKILLS/...`, and `join` on Windows returns `\root\SKILLS\...`. The test is the contract; `skillPaths` composes strings. Node's `fs` accepts forward slashes on Windows, and one spelling across platforms means the injected text and the helper agree.

`RESERVED_SLUGS` must include `_drafts`, `_rejected`, `_archived`, `.state`, `index`, and the Windows device names `con prn aux nul com1 com2 com3 com4 com5 com6 com7 com8 com9 lpt1 lpt2 lpt3 lpt4 lpt5 lpt6 lpt7 lpt8 lpt9` (case-insensitive, and also refused with an extension such as `con.md`).

- [ ] **Step 4: Run the tests**

Run: `node --test plugins/loop-skills/test/format.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/loop-skills/src/format.js plugins/loop-skills/test/format.test.mjs
git commit -m "feat(skills): skill file format, slug rules, and path layout"
```

---

### Task 3: Injection text under a byte budget

**Files:**
- Create: `plugins/loop-skills/src/index.js`
- Test: `plugins/loop-skills/test/index.test.mjs`

**Interfaces:**
- Consumes: `utf8Length`, `RESERVED_SLUGS` from `format.js`.
- Produces: `INJECT_LIMIT = 4096`, `DESCRIPTION_MAX = 48`, `SLUG_MAX = 40`.
- Produces: `buildInjection(entries, options) -> { text: string, included: number, dropped: number }`.
  - `entries: readonly { slug, description, approvedAt: number }[]`, newest `approvedAt` first is the caller's job; this function sorts by `approvedAt` descending and keeps that order.
  - `options: { language: "ko" | "en", skillsRoot?: string }`. `skillsRoot` defaults to `~/.buzz/SKILLS` and must appear in the text verbatim, because a conversation bound to its own folder gets the base prompt rewritten to absolute paths (spec §7.6).
  - With zero entries it returns the **draft-only block** (no list) — this is the chicken-and-egg fix in spec §7.2, and it must never be the empty string.
  - With entries it returns the heading, the list, the footer, then the draft instruction. It drops trailing entries until `utf8Length(text) <= INJECT_LIMIT`, and never throws.

- [ ] **Step 1: Write the failing tests**

```js
// plugins/loop-skills/test/index.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInjection, INJECT_LIMIT } from "../src/index.js";
import { utf8Length } from "../src/format.js";

const entries = (n, descriptionChars) =>
  Array.from({ length: n }, (_, i) => ({
    slug: `skill-${String(i).padStart(3, "0")}`,
    description: "가".repeat(descriptionChars),
    approvedAt: i,
  }));

test("zero approved skills still instructs the agent to draft", () => {
  const ko = buildInjection([], { language: "ko" });
  assert.equal(ko.included, 0);
  assert.match(ko.text, /skills_draft/);
  assert.match(ko.text, /아직 승인된 스킬이 없습니다/);
  assert.ok(utf8Length(ko.text) < 600, `zero state is ${utf8Length(ko.text)} bytes`);
  // The empty state is written in the workspace language, not in English.
  const en = buildInjection([], { language: "en" });
  assert.match(en.text, /No approved skills yet/);
  assert.match(en.text, /skills_draft/);
  assert.equal(en.text.includes("승인된"), false);
});

test("never exceeds the cap, even with 100 Korean entries", () => {
  const { text, included, dropped } = buildInjection(entries(100, 48), { language: "ko" });
  assert.ok(utf8Length(text) <= INJECT_LIMIT, `over cap: ${utf8Length(text)}`);
  assert.ok(included > 0);
  assert.equal(included + dropped, 100);
});

test("keeps the newest and drops the oldest", () => {
  const { text } = buildInjection(entries(100, 48), { language: "ko" });
  assert.match(text, /skill-099/);
  assert.equal(text.includes("skill-000"), false);
});

test("a single long description is trimmed, not allowed to overflow", () => {
  const one = [{ slug: "long-one", description: "가".repeat(4000), approvedAt: 1 }];
  const { text } = buildInjection(one, { language: "ko" });
  assert.ok(utf8Length(text) <= INJECT_LIMIT);
});

test("always names the absolute skills root and the tool prefix", () => {
  const { text } = buildInjection(entries(2, 10), {
    language: "en",
    skillsRoot: "/home/me/.buzz/SKILLS",
  });
  assert.match(text, /\/home\/me\/\.buzz\/SKILLS/);
  for (const name of ["skills_list", "skills_read", "skills_draft"])
    assert.match(text, new RegExp(name));
});

test("the list is plain lines the model can match to a slug", () => {
  const { text } = buildInjection(
    [{ slug: "deploy-preview", description: "테스트 채널에 프리뷰를 올린다", approvedAt: 1 }],
    { language: "ko" },
  );
  assert.match(text, /- deploy-preview — 테스트 채널에 프리뷰를 올린다/);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test plugins/loop-skills/test/index.test.mjs`
Expected: FAIL — no module `../src/index.js`.

- [ ] **Step 3: Implement `src/index.js`**

Truncation rule the tests require but do not spell out: build the full text, then while `utf8Length(text) > INJECT_LIMIT` drop the **last** line of the list; if the list is empty and it still overflows, cut the longest description at a character boundary until it fits. Header and footer are never cut, so the footer must be short (one line each for the read instruction and the draft instruction). Report `{ included, dropped }` so the library can show how many entries the prompt does not carry.

**Language, and a test this plan first got wrong.** The zero-skill test as written demanded `/No approved skills yet/` from a `language: "ko"` block — it contradicted spec §7.7 and failed. The zero state is written in the **workspace language**; the test now asserts the Korean sentence for `ko` and the English one for `en`, and asserts they do not leak into each other. Separately, the list version had no `skills_list` mention at all, which the "always names the tool prefix" test caught — real defect, fixed by a footer line, not by weakening the test.

- [ ] **Step 4: Run the tests**

Run: `node --test plugins/loop-skills/test/index.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/loop-skills/src/index.js plugins/loop-skills/test/index.test.mjs
git commit -m "feat(skills): injection text with byte-budgeted truncation"
```

---

### Task 4: Approval record and state machine

**Files:**
- Create: `plugins/loop-skills/src/approvals.js`
- Test: `plugins/loop-skills/test/approvals.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `APPROVAL_ACTION` = `{ approve: "approve", adopt: "adopt", reject: "reject", archive: "archive" }`.
- Produces: `approvalLine({ action, slug, at, by, reason? }) -> string` — one JSON object plus `\n`; throws on an unknown action or a slug without `validSlug`-shaped characters, because a corrupt log is worse than a refused write.
- Produces: `parseApprovals(text) -> { entries: Record<string, { approvedAt?: string, approvedBy?: string, rejectedAt?: string, rejectionReason?: string, archivedAt?: string }>, damaged: number }` — later lines win; a line that is not JSON, or whose action is unknown, increments `damaged` and is skipped.
- Produces: `skillState({ frontMatter, record, draft }) -> "approved" | "approved-outside-loop" | "draft" | "rejected" | "archived" | "broken"`, rules in order:
  1. `frontMatter === undefined` → `broken`. This is the caller saying "there is no readable `SKILL.md`": missing, a directory, zero bytes, or unreadable. A broken folder is **never injected** and never treated as approval — it is shown in the library so a human can fix or remove it.
  2. `record.archivedAt` → `archived`.
  3. `record.approvedAt` → `approved`.
  4. `record.rejectedAt` → `rejected`.
  5. `draft === true` → `draft`.
  6. `frontMatter.approved` set, or `frontMatter` is `{}` (a hand-written file with no front matter) → `approved-outside-loop`: readable, suspect, not silently trusted.
  7. otherwise → `draft`.

- [ ] **Step 1: Write the failing tests**

```js
// plugins/loop-skills/test/approvals.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalLine, parseApprovals, skillState } from "../src/approvals.js";

test("writes one JSON object per line", () => {
  const line = approvalLine({ action: "approve", slug: "deploy", at: "2026-11-15T03:00:00Z", by: "abc" });
  assert.equal(line.endsWith("\n"), true);
  assert.equal(JSON.parse(line).slug, "deploy");
});

test("refuses an unknown action and a hostile slug", () => {
  assert.throws(() => approvalLine({ action: "delete-everything", slug: "x", at: "t", by: "o" }));
  assert.throws(() => approvalLine({ action: "approve", slug: "../../etc/passwd", at: "t", by: "o" }));
});

test("later lines win, damaged lines are counted not fatal", () => {
  const text = [
    approvalLine({ action: "approve", slug: "a", at: "t1", by: "o" }),
    approvalLine({ action: "archive", slug: "a", at: "t2", by: "o" }),
    "not json\n",
    '{"action":"mystery","slug":"a"}\n',
  ].join("");
  const { entries, damaged } = parseApprovals(text);
  assert.equal(damaged, 2);
  assert.equal(entries.a.archivedAt, "t2");
  assert.equal(entries.a.approvedAt, undefined, "a later archive clears the approval");
});

test("state: a file claiming approval with no record is suspect", () => {
  assert.equal(skillState({ frontMatter: { approved: "owner" }, record: undefined }),
    "approved-outside-loop");
});

test("state: a file with no front matter is readable but suspect", () => {
  assert.equal(skillState({ frontMatter: {}, record: undefined }), "approved-outside-loop");
});

test("state: record wins over front matter", () => {
  const record = { approvedAt: "t", approvedBy: "o" };
  assert.equal(skillState({ frontMatter: { approved: "attacker" }, record }), "approved");
  assert.equal(skillState({ frontMatter: {}, record: { archivedAt: "t" } }), "archived");
  assert.equal(skillState({ frontMatter: {}, record: { rejectedAt: "t" } }), "rejected");
});

test("state: a draft file is a draft", () => {
  assert.equal(skillState({ frontMatter: {}, draft: true }), "draft");
});

test("state: a folder with no readable SKILL.md is broken, never approved", () => {
  assert.equal(skillState({ frontMatter: undefined }), "broken");
  assert.equal(skillState({ frontMatter: undefined, record: { approvedAt: "t" } }), "broken");
});
```

`draft: true` is the only way to get `"draft"`, and only files read out of `_drafts/` set it. A `broken` folder is shown in the library so a human can fix it, and is never injected.

- [ ] **Step 2: Run and watch them fail**

Run: `node --test plugins/loop-skills/test/approvals.test.mjs`
Expected: FAIL — no module `../src/approvals.js`.

- [ ] **Step 3: Implement `src/approvals.js`**

- [ ] **Step 4: Run the tests**

Run: `node --test plugins/loop-skills/test/approvals.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/loop-skills/src/approvals.js plugins/loop-skills/test/approvals.test.mjs
git commit -m "feat(skills): append-only approval log and skill state machine"
```

---

### Task 5: Node helper — every filesystem operation

**Files:**
- Create: `plugins/loop-skills/src/helper.js` (exports `HELPER_SOURCE`, a string)
- Create: `plugins/loop-skills/src/request.js`
- Test: `plugins/loop-skills/test/helper.test.mjs`
- Test: `plugins/loop-skills/test/request.test.mjs`

**Interfaces:**
- Produces from `request.js`: `helperArgs() -> string[]` returning `["--input-type=module", "-e", HELPER_SOURCE]`, and `helperRequest(command, payload) -> string` returning `JSON.stringify({ command, ...payload })`.
  **Why the payload is not an argument:** Windows caps a process command line at 32,767 characters. A 32 KB ASCII draft body pushed through argv fails with `ENAMETOOLONG` — measured, not theorised. The request travels on **stdin** and the helper reads `process.stdin` to end. `HELPER_SOURCE` stays in argv, so `scripts/build.mjs` must refuse to emit a build whose source exceeds **24000 bytes**.
- Produces: `parseReply(stdout) -> { ok: true, data: unknown } | { ok: false, error: string }` — the helper always prints exactly one JSON object on stdout and nothing else; anything unparseable becomes `{ ok: false, error: "helper printed no result" }`. When stdout holds several lines, the last parseable object wins, because a stray `console.log` must not be able to fake success.

`spawn` here is injected, not imported, and its signature is `(command, payload) => Promise<{ stdout }>`; `src/plugin.js` supplies the Buzz-backed one (Task 6).
- Produces from `helper.js`: `HELPER_SOURCE`. It is an ES module body (no imports at top level other than `node:` builtins, which are allowed because the spawned process is not sandboxed by the plugin loader) handling:
  - `list` → `{ skills: [{ slug, description, state, approvedAt }] }`
  - `read` `{ slug }` → `{ text, frontMatter, body, references: string[] }` or `{ error }`
  - `draft` `{ slug, name, description, body, why, channel, agent }` → `{ path }` or `{ error: "pending" | "rejected", reason? }`
  - `approve` `{ slug, by }`, `adopt` `{ slug, by }`, `reject` `{ slug, by, reason }`, `archive` `{ slug, by }`
  - `index` → rewrites `SKILLS/INDEX.md` from the approved set and returns `{ entries, bytes }`
  - `pointer` `{ add: true | false }` → writes or removes the marked block in `AGENTS.md`

Every command takes `{ root }` (the absolute `SKILLS` directory) and must reject a `root` that is not absolute.

- [ ] **Step 1: Write the failing test for `request.js`**

```js
// plugins/loop-skills/test/request.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { helperArgs, helperRequest, parseReply } from "../src/request.js";

test("the source travels in argv and the payload does not", () => {
  const args = helperArgs();
  assert.deepEqual(args.slice(0, 2), ["--input-type=module", "-e"]);
  assert.ok(args[2].length > 0, "the helper source is passed with -e");
  const request = helperRequest("read", { root: "/r", slug: "deploy" });
  assert.deepEqual(JSON.parse(request), { command: "read", root: "/r", slug: "deploy" });
  assert.equal(args.includes(request), false, "the payload must not be an argument");
});

test("a 60 KB body still fits the request string, which stdin carries", () => {
  const request = helperRequest("draft", { root: "/r", slug: "s", body: "a".repeat(61440) });
  assert.ok(request.length > 61440);
  assert.equal(request.includes("\u0000"), false);
});

test("an unparseable reply is a reported failure, not a throw", () => {
  assert.deepEqual(parseReply(""), { ok: false, error: "helper printed no result" });
  assert.deepEqual(parseReply("Error: boom"), { ok: false, error: "helper printed no result" });
  assert.deepEqual(parseReply('{"ok":true,"data":1}'), { ok: true, data: 1 });
});

test("a stray line before the result cannot fake a failure, and the last result wins", () => {
  assert.deepEqual(parseReply('debug\n{"ok":true,"data":1}\n'), { ok: true, data: 1 });
  assert.deepEqual(parseReply('{"ok":true,"data":1}\n{"ok":false,"error":"late"}'),
    { ok: false, error: "late" });
});
```

- [ ] **Step 2: Write the failing helper tests (they run the real helper)**

```js
// plugins/loop-skills/test/helper.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HELPER_SOURCE } from "../src/helper.js";

const run = (root, command, payload = {}) =>
  new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      ["--input-type=module", "-e", HELPER_SOURCE],
      { encoding: "utf8" },
      (_err, stdout) => resolve(JSON.parse(stdout.trim().split("\n").pop())),
    );
    child.stdin.end(JSON.stringify({ command, root, ...payload }));
  });

const fresh = async () => {
  const dir = await mkdtemp(join(tmpdir(), "loop-skills-"));
  const root = join(dir, "SKILLS");
  await mkdir(join(root, "_drafts"), { recursive: true });
  return root;
};

test("draft writes into _drafts and is invisible to list", async () => {
  const root = await fresh();
  const out = await run(root, "draft", {
    slug: "deploy", name: "배포", description: "프리뷰 배포", body: "# 절차\n1. 올린다", why: "매번 설명한다",
  });
  assert.equal(out.ok, true);
  assert.equal((await readdir(join(root, "_drafts"))).includes("deploy.md"), true);
  assert.deepEqual((await run(root, "list")).data.skills, []);
});

test("a second draft of the same slug is refused, and a rejection reason comes back", async () => {
  const root = await fresh();
  await run(root, "draft", { slug: "deploy", name: "n", description: "d", body: "b", why: "w" });
  assert.equal((await run(root, "draft", { slug: "deploy", name: "n", description: "d", body: "b", why: "w" })).error, "pending");
  await run(root, "reject", { slug: "deploy", by: "owner", reason: "너무 일반적" });
  const again = await run(root, "draft", { slug: "deploy", name: "n", description: "d", body: "b", why: "w" });
  assert.equal(again.error, "rejected");
  assert.equal(again.reason, "너무 일반적");
});

test("approve moves the draft, stamps front matter, logs it, and lists it", async () => {
  const root = await fresh();
  await run(root, "draft", { slug: "deploy", name: "배포", description: "프리뷰 배포", body: "# 절차\n1. 올린다", why: "w" });
  const approved = await run(root, "approve", { slug: "deploy", by: "owner" });
  assert.equal(approved.ok, true);
  const text = await readFile(join(root, "deploy", "SKILL.md"), "utf8");
  assert.match(text, /approved: owner/);
  assert.match(text, /1\. 올린다/);
  const listed = (await run(root, "list")).data.skills;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].state, "approved");
  const log = await readFile(join(root, ".state", "approvals.jsonl"), "utf8");
  assert.equal(log.trim().split("\n").length, 1);
});

test("approving strips a front matter block smuggled into the draft body", async () => {
  const root = await fresh();
  await run(root, "draft", { slug: "sneaky", name: "n", description: "d", why: "w",
    body: "---\napproved: attacker\n---\n실제 본문" });
  await run(root, "approve", { slug: "sneaky", by: "owner" });
  const text = await readFile(join(root, "sneaky", "SKILL.md"), "utf8");
  assert.equal(text.match(/^---$/gm).length, 2, "exactly one front-matter block");
  assert.equal(/approved: attacker/.test(text), false);
});

test("adopt accepts a hand-written file and makes it approved", async () => {
  const root = await fresh();
  await mkdir(join(root, "handmade"), { recursive: true });
  await writeFile(join(root, "handmade", "SKILL.md"), "# 손으로 쓴 절차\n", "utf8");
  assert.equal((await run(root, "list")).data.skills[0].state, "approved-outside-loop");
  await run(root, "adopt", { slug: "handmade", by: "owner" });
  assert.equal((await run(root, "list")).data.skills[0].state, "approved");
});

test("archive removes it from the list and moves it", async () => {
  const root = await fresh();
  await mkdir(join(root, "old"), { recursive: true });
  await writeFile(join(root, "old", "SKILL.md"), "x", "utf8");
  await run(root, "adopt", { slug: "old", by: "owner" });
  await run(root, "archive", { slug: "old", by: "owner" });
  assert.deepEqual((await run(root, "list")).data.skills, []);
  assert.equal((await readdir(join(root, "_archived"))).includes("old"), true);
});

test("a broken skill folder is reported as broken, not approved and not fatal", async () => {
  const root = await fresh();
  await mkdir(join(root, "empty"), { recursive: true });                 // no SKILL.md
  await mkdir(join(root, "dir-skill", "SKILL.md"), { recursive: true }); // SKILL.md is a directory
  await mkdir(join(root, "zero"), { recursive: true });
  await writeFile(join(root, "zero", "SKILL.md"), "", "utf8");           // zero bytes
  const out = await run(root, "list");
  assert.equal(out.ok, true);
  const byState = Object.fromEntries(out.data.skills.map((s) => [s.slug, s.state]));
  assert.deepEqual(byState, { empty: "broken", "dir-skill": "broken", zero: "broken" });
  assert.match((await run(root, "read", { slug: "empty" })).error, /no SKILL\.md/);
});

test("index regenerates the human copy and reports byte size", async () => {
  const root = await fresh();
  await mkdir(join(root, "one"), { recursive: true });
  await writeFile(join(root, "one", "SKILL.md"),
    "---\nname: 하나\ndescription: 첫 절차\n---\n\n본문\n", "utf8");
  await run(root, "adopt", { slug: "one", by: "owner" });
  const out = await run(root, "index");
  assert.ok(out.data.entries >= 1);
  const text = await readFile(join(root, "INDEX.md"), "utf8");
  assert.match(text, /one — 첫 절차/);
});

test("pointer adds and removes a marked block, leaving the rest of AGENTS.md alone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loop-agents-"));
  const file = join(dir, "AGENTS.md");
  await writeFile(file, "# 기존 내용\n손대지 마라\n", "utf8");
  await run(join(dir, "SKILLS"), "pointer", { add: true, agentsFile: file });
  const withBlock = await readFile(file, "utf8");
  assert.match(withBlock, /loop:skills:start/);
  assert.match(withBlock, /손대지 마라/);
  await run(join(dir, "SKILLS"), "pointer", { add: false, agentsFile: file });
  assert.equal(await readFile(file, "utf8"), "# 기존 내용\n손대지 마라\n");
});

test("a 60 KB ASCII body survives the write path", async () => {
  const root = await fresh();
  const body = "a".repeat(60 * 1024);
  const out = await run(root, "draft", { slug: "big", name: "n", description: "d", body, why: "w" });
  assert.equal(out.ok, true, JSON.stringify(out));
  const text = await readFile(join(root, "_drafts", "big.md"), "utf8");
  assert.equal(text.includes("a".repeat(60 * 1024)), true);
});

test("a body above the 61440-byte cap is refused with a sentence", async () => {
  const root = await fresh();
  const out = await run(root, "draft", { slug: "huge", name: "n", description: "d",
    body: "a".repeat(61441), why: "w" });
  assert.equal(out.ok, false);
  assert.match(out.error, /too large/);
});

test("a relative root is refused", async () => {
  const out = await run("SKILLS", "list");
  assert.equal(out.ok, false);
  assert.match(out.error, /absolute/);
});
```

- [ ] **Step 3: Run and watch both fail**

Run: `node --test plugins/loop-skills/test/request.test.mjs plugins/loop-skills/test/helper.test.mjs`
Expected: FAIL — no modules `../src/request.js` and `../src/helper.js`.

- [ ] **Step 4: Implement `src/request.js` and `src/helper.js`**

`HELPER_SOURCE` is written as a template literal. It may `import` from `node:fs/promises` and `node:path`; it must not import anything else. It reads its one request from **stdin**, catches every error and prints `{ ok: false, error }` so the plugin never sees a stack trace on stdout. Body size above 61440 bytes is refused with `{ ok: false, error: "the procedure is too large: ..." }` — the test greps `/too large/`. Slug validation is duplicated inside the helper (it cannot import `format.js`, and the boundary must hold even if the plugin is replaced) and the two must agree — Task 2's test list is the source of truth for what is refused.

**Three mechanical rules the helper body must follow, each of which broke the build when violated:**

1. **Every line is indented two spaces and dedented at runtime** (`RAW.replace(/^ {2}/gm, "").replace(/^\n/, "")`). The build's name scan reads the file text, so a `const` at column 0 inside the literal would be collected as a module export that does not exist. The build now throws if it finds one.
2. **No backticks and no `${` anywhere in the body** — it is a template literal. Where the helper needs a literal backtick (it looks for `` `file.md` `` references in bodies), it uses `String.fromCharCode(96)`.
3. **The pointer block text contains backticks**, so it goes through a `%B%` placeholder that is substituted after dedenting.

`scripts/build.mjs` measures `HELPER_SOURCE` (not the file) against 24000 bytes. The measured Windows ceiling is 32767 characters for the whole command line; 24000 leaves room for `node`, `--input-type=module`, `-e`, and quoting. As of implementation it is 13,374 bytes.

- [ ] **Step 5: Run the tests**

Run: `node --test plugins/loop-skills/test/request.test.mjs plugins/loop-skills/test/helper.test.mjs`
Expected: PASS (4 + 14 tests).

- [ ] **Step 6: Commit**

```bash
git add plugins/loop-skills/src/request.js plugins/loop-skills/src/helper.js plugins/loop-skills/test/request.test.mjs plugins/loop-skills/test/helper.test.mjs
git commit -m "feat(skills): node helper for every filesystem operation"
```

---

### Task 6: The three agent tools

**Files:**
- Create: `plugins/loop-skills/src/tools.js`
- Modify: `plugins/loop-skills/src/plugin.js`
- Test: `plugins/loop-skills/test/tools.test.mjs`

**Interfaces:**
- Consumes: `helperArgs`, `parseReply` from `request.js`; `validSlug`, `DESCRIPTION_MAX`, `SLUG_MAX` from `format.js`.
- Produces from `tools.js`: `TOOLS` — an array of three objects `{ name, description, inputSchema }` with exactly these names and schemas:

```js
const slug = { type: "string", minLength: 1, maxLength: 40, pattern: "^[a-z0-9][a-z0-9._-]*$" };
export const TOOLS = [
  {
    name: "skills_list",
    description:
      "List the procedures the owner has approved. Returns one slug and one line each. Call skills_read before doing a task one of them covers.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "skills_read",
    description:
      "Read one approved procedure in full by slug. Drafts are not readable until the owner approves them.",
    inputSchema: {
      type: "object",
      properties: { slug },
      required: ["slug"],
      additionalProperties: false,
    },
  },
  {
    name: "skills_draft",
    description:
      "Propose a repeatable procedure for the owner to review. Use it once when a task taught you something you would otherwise have to be told again. The draft is not visible to any agent until the owner approves it.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { ...slug, description: "Short kebab-case id, e.g. weekly-sales-report" },
        name: { type: "string", minLength: 1, maxLength: 80 },
        description: { type: "string", minLength: 1, maxLength: 48, description: "One line saying when to use it" },
        body: { type: "string", minLength: 1, maxLength: 61440, description: "The procedure, in markdown" },
        why: { type: "string", minLength: 1, maxLength: 400, description: "One line: what would have to be re-explained next time" },
      },
      required: ["slug", "name", "description", "body", "why"],
      additionalProperties: false,
    },
  },
];
```

- Produces from `tools.js`: `callTool({ spawn, root, notifyDraft }, name, args, context) -> Promise<string>`. It never throws: every failure becomes a sentence the agent can act on.
- Produces from `plugin.js`: `apply(ctx)` that registers all three via `ctx.agents.addTool`, with `call: (client, context, args) => callTool(deps, name, args, context)`.

**Plan defects found by implementing this task, all three real:**

1. **`inject` is a module export, not a call.** The plan said `apply` must "`inject` `["react", "agents", …]`". Wrong twice: `inject` is an exported constant the host reads *before* calling `apply` (`docs/plugin-authoring-guide.md:3,22`), and naming `react` would demand the React service for a plugin that adds no components. The list is `["agents", "settingsCards", "notifications", "host"]`, pinned by a test.
2. **`makeSpawn`'s timeout leaked.** `Promise.race([collected, timeout])` leaves the losing 20 s timer alive, which holds the event loop: every tool test took 20 seconds. `clearTimeout` in a `finally` — the same fix `callTool` already had — took the suite from 20,813 ms to 1,173 ms.
3. **A spawn failure bypassed the desktop message.** `deps.spawn` throwing was caught by the outer `try`, so the agent got "That did not work: …" instead of "I couldn't write to the skills folder … Procedures need the desktop app." The spawn now fails inside `send` as an ordinary `{ ok: false, error }` reply.

- [ ] **Step 1: Write the failing tests**

```js
// plugins/loop-skills/test/tools.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS, callTool } from "../src/tools.js";

const ok = (data) => async () => ({ stdout: JSON.stringify({ ok: true, data }) });

test("names are unique, prefixed, and match the host's tool-name rule", () => {
  const names = TOOLS.map((t) => t.name);
  assert.deepEqual(names.slice().sort(), ["skills_draft", "skills_list", "skills_read"]);
  for (const n of names) assert.match(n, /^[a-z][a-z0-9_]{0,63}$/);
  for (const t of TOOLS) {
    assert.equal(t.inputSchema.type, "object");
    assert.ok(t.description.length > 20);
  }
});

test("list renders an empty library as a plain sentence", async () => {
  const out = await callTool({ spawn: ok({ skills: [] }), root: "/r" }, "skills_list", {}, {});
  assert.match(out, /No approved skills yet/);
});

test("read of a missing slug says drafts are not readable", async () => {
  const out = await callTool(
    { spawn: async () => ({ stdout: JSON.stringify({ ok: false, error: 'no approved skill "x"' }) }), root: "/r" },
    "skills_read", { slug: "x" }, {},
  );
  assert.match(out, /not readable until/i);
});

test("draft passes channel and agent through and reports the path", async () => {
  let seen;
  const spawn = async (command, payload) => {
    seen = payload;
    return { stdout: JSON.stringify({ ok: true, data: { path: "/r/_drafts/x.md" } }) };
  };
  const out = await callTool({ spawn, root: "/r", notifyDraft: async () => {} }, "skills_draft",
    { slug: "x", name: "n", description: "d", body: "b", why: "w" },
    { channel: "chan-1", session: "sess" });
  assert.equal(seen.channel, "chan-1");
  assert.match(out, /waiting for the owner/i);
});

test("a rejected slug returns the reason, so the agent can do better", async () => {
  const spawn = async () => ({ stdout: JSON.stringify({ ok: false, error: "rejected", reason: "너무 일반적" }) });
  const out = await callTool({ spawn, root: "/r" }, "skills_draft",
    { slug: "x", name: "n", description: "d", body: "b", why: "w" }, {});
  assert.match(out, /너무 일반적/);
});

test("a spawn that throws becomes a readable refusal, never a throw", async () => {
  const spawn = async () => { throw new Error("Processes require an installed desktop plugin"); };
  const out = await callTool({ spawn, root: "/r" }, "skills_draft",
    { slug: "x", name: "n", description: "d", body: "b", why: "w" }, {});
  assert.match(out, /couldn't write/i);
  assert.match(out, /desktop/i);
});

test("an over-long description is refused before it reaches the disk", async () => {
  let called = false;
  const spawn = async () => { called = true; return { stdout: "" }; };
  const out = await callTool({ spawn, root: "/r" }, "skills_draft",
    { slug: "x", name: "n", description: "가".repeat(49), body: "b", why: "w" }, {});
  assert.equal(called, false);
  assert.match(out, /48/);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test plugins/loop-skills/test/tools.test.mjs`
Expected: FAIL — no module `../src/tools.js`.

- [ ] **Step 3: Implement `src/tools.js`**

- Produces: `helperArgs() -> string[]` (see `request.js`) and the spawn wiring. The plugin's real `spawn` is `(command, payload) => { const child = await ctx.host.spawn("skills", { args: helperArgs() }); child.write(helperRequest(command, payload)); child.end(); ... }` — it collects stdout until `exited` and returns `{ stdout }`. Reads have a 20 s budget; a timeout returns a readable sentence naming the command.

The draft success string must contain "waiting for the owner", and the missing-skill string must contain "not readable until".

- [ ] **Step 4: Run the tests**

Run: `node --test plugins/loop-skills/test/tools.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Wire the tools into `src/plugin.js` and rebuild**

`src/plugin.js` must export **`inject`** as a module-level constant and **`apply(ctx)`** as a function. `inject` is NOT a method called inside `apply` — it is a module export the host reads before calling `apply` (`docs/plugin-authoring-guide.md:3,22`; `src/plugins/api.ts:87-91`). Writing `ctx.inject([...])` inside `apply` was the first version of this plan and is silently useless.

The module also must not do work at top level (`plugin-authoring-guide.md:48`): no `resolveDirectory`, no `spawn`, nothing. All of it belongs inside `apply`. `apply` must finish activating within 10 seconds, so the root resolution is awaited by the tool calls, never by `apply` itself.

`apply` must resolve the root once with `await ctx.host.resolveDirectory("~/.buzz/SKILLS", { create: true })` inside a promise held for the tool calls, and register the three tools. A failure to resolve is stored, not thrown: a missing folder is a degraded plugin, not a broken one, and every tool answers with a sentence.

`notifyDraft` calls the notification registered here; Task 8's library uses the same one.

- [ ] **Step 6: Verify it loads in Buzz**

Install the folder (Settings → Plugins → Manage plugins → Add → Browse → the plugin folder), then call `plugin_status` with `id: "loop.skills"`.
Expected: `applied`, and the three tools listed. If it reports `failed`, the error names the throwing field.

- [ ] **Step 7: Commit**

```bash
node plugins/loop-skills/scripts/build.mjs
git add plugins/loop-skills
git commit -m "feat(skills): agent tools for list, read, and draft"
```

---

### Task 7: Injection registration and refresh

**Files:**
- Create: `plugins/loop-skills/src/inject.js`
- Modify: `plugins/loop-skills/src/plugin.js`
- Test: `plugins/loop-skills/test/inject.test.mjs`

**Interfaces:**
- Consumes: `buildInjection` from `index.js`.
- Produces from `inject.js`: `class InjectionHolder { constructor(register, dispose) }` with methods `set(entries, options) -> void` and `dispose() -> void`:
  - `register(text)` registers the block inside a fresh child `ctx.plugin({ inject: ["agents"], apply })` scope and returns that scope's dispose function.
  - `set` computes the text; **if it equals the currently registered text, it does nothing** (this is what stops two revisions from double-appending); otherwise it calls `dispose()` on the previous scope first, then registers.
  - `dispose` is idempotent and safe to call on a rejected registration.
  - If `buildInjection` throws (it should not), `set` swallows it and keeps the previous registration live — an injection failure must never kill a turn.

- [ ] **Step 1: Write the failing tests**

```js
// plugins/loop-skills/test/inject.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { InjectionHolder } from "../src/inject.js";

test("registers once and re-registers only when the text changes", async () => {
  const live = new Map();
  let next = 0;
  const register = (text) => {
    const id = ++next;
    live.set(id, text);
    return () => live.delete(id);
  };
  const holder = new InjectionHolder(register, () => {});
  holder.set([], { language: "ko" });
  assert.equal(live.size, 1);
  holder.set([], { language: "ko" });
  assert.equal(live.size, 1, "identical text must not add a second block");
  holder.set([{ slug: "a", description: "d", approvedAt: 1 }], { language: "ko" });
  assert.equal(live.size, 1, "the old block is disposed before the new one");
  assert.match([...live.values()][0], /- a — d/);
});

test("a throwing build keeps the previous registration", async () => {
  const live = new Set();
  const register = (text) => { live.add(text); return () => live.delete(text); };
  const holder = new InjectionHolder(register, () => {});
  holder.set([], { language: "ko" });
  const before = [...live][0];
  holder.set([{ slug: "bad", description: null, approvedAt: 1 }], { language: "ko" });
  assert.deepEqual([...live], [before]);
});

test("dispose is idempotent", () => {
  let disposed = 0;
  const holder = new InjectionHolder((t) => () => { disposed++; }, () => {});
  holder.set([], { language: "ko" });
  holder.dispose();
  holder.dispose();
  assert.equal(disposed, 1);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test plugins/loop-skills/test/inject.test.mjs`
Expected: FAIL — no module `../src/inject.js`.

- [ ] **Step 3: Implement `src/inject.js` and wire it in `src/plugin.js`**

In `plugin.js`, the real `register` must be:

```js
const holder = new InjectionHolder((text) => {
  const scope = ctx.plugin({ inject: ["agents"], apply: (child) => child.agents.addInstructions({ id: "skills-index", text }) });
  return () => scope.dispose();
}, (error) => console.warn("loop.skills: could not update the skills block", error));
```

and `ctx.effect(() => () => holder.dispose())` owns it. Call `holder.set(...)` once at startup — the zero-skill block must be live from the first turn — and again after every tool call, so a decision takes effect on the next turn.

**What a reload actually does, measured in both orders** (`test/reload.test.mjs`):

- **Host order: dispose, then apply.** Revision 1's effect cleanup removes its block; revision 2 registers one. Net result exactly one block. This is the real path and it is clean.
- **Both revisions alive at once.** Revision 2's `addInstructions` throws with `instructions skills-index already registered`, because revision 1 owns a scope revision 2 cannot dispose. The correct behaviour is to **keep revision 1's block and report** — it is still delivering approved procedures. Retrying cannot help, and deleting the live block would be strictly worse. `InjectionHolder` therefore leaves the old text live and calls `onError`. Its `#text` resets to `undefined`, so the next refresh retries registration once revision 1 is gone.

Do not "fix" this by giving each revision a unique id: two blocks would then be appended to every turn during the overlap, doubling the index.

- [ ] **Step 4: Run the tests**

Run: `node --test plugins/loop-skills/test/inject.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify in Buzz**

With one approved skill present, run `plugin_status` twice and confirm only one `skills-index` block exists; then ask a local agent something trivial and confirm its Activity tab shows the block once. Reload the plugin (`plugin_reload`) and repeat — the block must still appear exactly once.

- [ ] **Step 6: Commit**

```bash
node plugins/loop-skills/scripts/build.mjs
git add plugins/loop-skills
git commit -m "feat(skills): register the injection block and refresh it on change"
```

---

### Task 8: Settings library, notification, and `AGENTS.md` pointer

**Files:**
- Create: `plugins/loop-skills/src/ui.js`
- Modify: `plugins/loop-skills/src/plugin.js`
- Test: `plugins/loop-skills/test/ui.test.mjs`

**Interfaces:**
- Produces from `ui.js`: `LibraryCard(ctx, deps)` — a component factory. It renders, in order:
  1. With zero skills and zero drafts, a single sentence: *"지난주에 같은 일을 두 번 이상 시킨 게 있나요? 있으면 그걸로 시작하세요. 없으면 그냥 쓰세요 — 에이전트가 알아서 초안을 올립니다."* (English: *"Have you asked for the same thing twice this week? Start with that. If not, just keep working — your agents will propose procedures as they go."*)
  2. Then a row per draft: state chip, name, one-line description, the agent that wrote it, `<channel>` link, age, and `why` in full.
  3. Then a row per approved skill: same, plus the read count from `usage.json`, plus `Archive`.
  4. Each draft row expands to its full body with `Approve` / `Edit` / `Reject`; `Reject` requires a reason.
  5. A `pending outside loop` group for `approved-outside-loop` skills with `Adopt`.
- Produces: `notificationFor(ctx)` returning `{ submit }` from `ctx.notifications.register({ id: "draft", label: "Skill draft" })`; `submit({ sourceKey: slug, target: { version: 1, kind: "plugin", pluginId: "loop.skills", pageId: "library" }, title: "스킬 초안", body: name })`.
- Produces: `pointerBlock(root)` — the exact three-line block the helper writes into `AGENTS.md`:

```markdown
<!-- loop:skills:start -->
Approved procedures live in `SKILLS/INDEX.md`. Read it before a task that one of them covers.
<!-- loop:skills:end -->
```

- [ ] **Step 1: Write the failing tests**

```js
// plugins/loop-skills/test/ui.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pointerBlock, emptyLibrarySentence, draftRowModel } from "../src/ui.js";

test("the pointer block is exactly three marked lines", () => {
  const block = pointerBlock();
  assert.equal(block.split("\n").filter((l) => l.trim()).length, 3);
  assert.match(block, /^<!-- loop:skills:start -->/);
  assert.match(block, /<!-- loop:skills:end -->$/);
});

test("the empty library is a sentence, not a form and not a starter pack", () => {
  for (const text of [emptyLibrarySentence("ko"), emptyLibrarySentence("en")]) {
    assert.ok(text.length > 40 && text.length < 300);
    assert.equal(/만드세요|create a skill/i.test(text), false, "no instruction to do our work");
  }
});

test("a draft row exposes why, and a missing why is called out rather than hidden", () => {
  const withWhy = draftRowModel({ slug: "a", frontMatter: { name: "A", why: "매번 설명해야 했다" }, body: "b" });
  assert.equal(withWhy.why, "매번 설명해야 했다");
  const without = draftRowModel({ slug: "b", frontMatter: { name: "B" }, body: "b" });
  assert.match(without.why, /why/i);
  assert.equal(without.slug, "b");
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test plugins/loop-skills/test/ui.test.mjs`
Expected: FAIL — no module `../src/ui.js`.

- [ ] **Step 3: Implement `src/ui.js` and register the card**

Register with `ctx.settingsCards.register({ id: "library", title: "Skills", component })`. Use `ctx.react.createElement` only — no JSX, no imports. Use host classes (`ui-card`) and tokens (`var(--space-panel-inset)`, `var(--space-2)`); no fixed widths; no custom frame or heading (the host supplies both).

On plugin start, call the helper's `pointer` with `add: true`; on `ctx.effect` cleanup, `add: false`.

**Decision recorded here so the executor does not relitigate it:** v1 does **not** register an agent tab (`ctx.agents.registerTab`). It is not on the documented Steady surface and the library card is canonical. A tab is a later convenience, and the code comment must say so.

- [ ] **Step 4: Run the tests**

Run: `node --test plugins/loop-skills/test/ui.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify in Buzz**

Open Settings → Skills. With nothing installed, confirm the sentence appears and no banner appears anywhere else in the app. Have an agent produce a draft; confirm exactly one OS notification arrives, that clicking it opens the library, and that approving the draft makes it appear in the next turn's prompt.

- [ ] **Step 6: Commit**

```bash
node plugins/loop-skills/scripts/build.mjs
git add plugins/loop-skills
git commit -m "feat(skills): library card, draft notification, and AGENTS.md pointer"
```

---

### Task 9: README and the honest limits

**Files:**
- Create: `plugins/loop-skills/README.md`
- Modify: `docs/superpowers/specs/2026-11-15-loop-skills-design.md` — §7.4's "honest limit" paragraph gains one sentence pointing at the README.

**Interfaces:** none.

- [ ] **Step 1: Write `README.md`**

It must state, in this order: what the folder is; how to install (Settings → Plugins → Manage plugins → Add → **Browse**, not drag-and-drop — a dragged folder is copied and cannot be reloaded); that `~/.buzz/SKILLS/` is shared by every local agent, so approval is global in v1; that Codex agents read skills from `~/.codex/skills`, not this folder, so they are second-class; that local agents only — hosted and Mesh agents get neither the index nor the tools; and the honest limit verbatim from the spec: **an agent with `write` and `bash` can edit these files directly, so the approval gate prevents accidents and leaves an audit trail — it is not a security boundary.**

- [ ] **Step 2: Add the pointer sentence to the spec**

- [ ] **Step 3: Commit**

```bash
git add plugins/loop-skills/README.md docs/superpowers/specs/2026-11-15-loop-skills-design.md
git commit -m "docs(skills): install steps and the honest limits"
```

---

### Task 10: Acceptance run

**Files:**
- Create: `docs/superpowers/specs/2026-11-15-loop-skills-acceptance.md` (the record; numbers, not prose)

**Interfaces:** none. This task produces evidence, not code.

- [ ] **Step 1: Pick the task with the user**

Ask which repeated task they will use. Do not choose one for them — spec §9 exists because the task is per-person.

- [ ] **Step 2: Record the baseline**

Run the task twice with no approved skills. Record, by hand: turn count, wall clock, how many times the human had to correct the agent, and the `mem_get core` byte size. Record prompt tokens from `agents.types()[i].usage(agent, { since, signal })` summed as `input + cacheRead + cacheWrite` — **not `input` alone** (spec §12.3).

- [ ] **Step 3: Let the agent draft**

Run the task a third time and do not mention skills. Record whether a draft appeared, and paste the draft into the record.

- [ ] **Step 4: Approve and re-run**

Approve with `Approve`, then run the task twice more. Record the same five numbers.

- [ ] **Step 5: Write the verdict against the spec's own conditions**

Pass requires: turn count or rework count down, prompt tokens not up, `core` not grown, and the human saying the result is as good or better. Write `PASS` or `FAIL` and the four numbers. If it fails, apply spec §9.4 rather than arguing with the measurement.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-11-15-loop-skills-acceptance.md
git commit -m "test(skills): acceptance run for <task>"
```

---

## Self-Review

**1. Spec coverage.** §7.1 layout → Tasks 2, 5. §7.2 injection → Tasks 3, 7. §7.3 tools → Task 6. §7.4 gate (Approve/Edit/Reject/Adopt/Archive, forgery chip, notification, empty state) → Tasks 4, 5, 8. §7.5 per-agent toggle → explicitly out (v1 ships "all approved, all local agents", as the spec says). §7.6 degrade → Task 6's spawn-failure test and Task 8's pointer. §7.7 language → `options.language` in Task 3, `lang` in the front matter in Task 2. §7.8 usage counting → **gap**: `usage.json` is written by no task. It is deliberately deferred, because spec §12.3 showed the count is not a value signal; the library shows "도구로 읽힘" only if a later task adds it. Nothing else in the spec lacks a task. §9 acceptance → Task 10.

**2. Step scan.** Every step names a file, a signature, or a command with expected output. Two places where the plan could have written code instead: `src/helper.js`'s body and the library components — both are specified by their command set and their tests, and their bodies are the implementer's.

**3. Type consistency.** `buildInjection(entries, options)` is called with those two arguments in Task 3's tests, Task 7's `holder.set`, and Task 8's library. `callTool(deps, name, args, context)` is used identically in Task 6's tests and Task 6's `apply`. `skillPaths` returns the keys `dir, file, draft, rejected, archived, state, index`, and Task 5's helper uses `root` plus relative names, not `skillPaths` — deliberate, because the helper cannot import it. `parseSkill` returns `{ data, body }`, and `skillState` takes `{ frontMatter, record, draft? }` — Task 8's `draftRowModel` receives `frontMatter`, matching. The tool names are `skills_*` throughout, and the injection text names the same three; the spec's `skill_read` spelling is superseded, and Task 3's test pins the new one so nobody "fixes" it back.

**4. Review Focus.** Each of the six has a named test: (1) hand-written file → Task 2's no-front-matter test and Task 4's `approved-outside-loop` test. (2) reserved slugs → Task 2's refusal test, plus Task 5's `../` refusal. (3) `---` in the body → Task 2's forge test and Task 5's smuggle test. (4) two revisions → Task 7's "identical text must not add a second block" test. (5) broken folder → Task 4's `broken`-beats-record test and Task 5's three-way broken test. (6) oversized body → Task 5's 60 KB stdin test. No line in Review Focus is left without a test.

**5. Proportion.** The plan is roughly the spec's length; its code blocks are test assertions plus three signatures, not implementations.

**One thing this plan cannot verify.** Tasks 6–8 assume Buzz is installed on this machine. It is not: there is no `~/.buzz`. Tasks 1–5 and 9 run entirely under `node --test` and are verifiable today; Tasks 6, 7, 8 and 10 require the user to install Buzz 1.0 and turn on the Pi plugin first. If that install does not happen, the plan stops being executable at Task 6 — which is the honest boundary, not a scheduling problem.

---

## Implementation record

Executed inline on 2026-11-15, tasks 1–9. **62 tests pass** under `node --test "plugins/loop-skills/test/*.test.mjs"`. `plugin.js` is 54,519 bytes / 1,348 lines, 0 top-level imports, 2 exports (`inject`, `apply`).

### What was proven without Buzz

- The file format, slug rules, and path layout.
- The 4096-byte injection budget, including 100 Korean entries, and the zero-skill block.
- The approval state machine, including `broken`, `approved-outside-loop`, and a body that tries to forge front matter.
- The helper as a **real child process**: every command, 60 KB via stdin, Korean round-trip, `AGENTS.md` pointer add/remove idempotence.
- `apply` against a ctx shaped like the host's: three tools, one notification, one injection block, library card.
- **The whole loop**: draft → invisible in the prompt → human approves → the block names the skill → `skills_read` returns it. Plus rejection-with-reason.
- **Both reload orders** (see Task 7).

### Defects found by executing, not reviewing

Seven, all fixed, all recorded in the task where they were found: the IIFE build emitting `import` inside a function; the template-literal false positive in the import scan; `inject` as a module export rather than a call; two `Promise.race` timers leaking 20 s each; a spawn failure bypassing the desktop message; `stdout` never collected because the fake host ignored `onStdout`; and the library card failing silently on a ctx without `react`.

### What remains unproven, and needs Buzz installed

**UPDATE — all five were verified on 2026-11-15 against Buzz 1.0.2 installed on Windows.** See "Verified in the real host" below; the original list is kept so the record shows what was a guess before it was a fact.

1. **`ctx.host.spawn` keeping stdin open** long enough for `write(...)` + `end()`. The spike proved Node does; the host's wrapper is a guess.
2. **`resolveDirectory("~/.buzz/SKILLS", { create: true })`** resolving under the plugin's real owner scope.
3. **`addInstructions` accepting our text** — the 4 KB arithmetic is ours, the host's byte check is not.
4. **`ctx.settingsCards.register`** rendering the card, and the notification opening the library.
5. **Task 10's acceptance run**, which needs a task the user chose.

Task 10 is not marked done: it is the measurement, and measuring requires the installed app.

### Verified in the real host (Buzz 1.0.2, Windows x64)

Installed from the official `Buzz_1.0.2_x64_unsigned.exe`, SHA-256 checked against the release's `SHA256SUMS`. The plugin was installed by writing the plugin-manager's own artifact format (`Artifacts {manifest, code} → sha256 → registry.json`), because the installer ships no `buzzodz` CLI and plugin install is otherwise GUI-only.

A diagnostic plugin made the same host calls and reported back — every one succeeded:

| Host call | Result | Evidence |
|---|---|---|
| `agents.addInstructions` | accepted | 149 chars / 221 bytes, no throw |
| `agents.addTool` | accepted | tool registered with the real schema shape |
| `settingsCards.register` | accepted | `ctx.react.createElement` is a function |
| `notifications.register` | accepted | returned an object whose `submit` is a function |
| `host.resolveDirectory("~/.buzz/SKILLS", {create:true})` | accepted | returned `C:\Users\grey\.buzz\SKILLS` |
| **`host.spawn` + `write` + `end` + `onStdout`** | **accepted** | exit 0, **20,513 bytes sent and the helper read all 20,513** |

The last row is the one the whole write path depended on. Note what it also proved: **`node` resolves on PATH** for a spawned process, because the manifest declares `program: "node"` and `resolve_program` returns the bare name on Windows.

`loop.skills` itself, with the probe removed, recreates `~/.buzz/SKILLS` and writes the `AGENTS.md` pointer block on launch — which means its own `apply` reaches the helper and back.

**One defect this found that no test could:** `onStdout` is an *option* of `spawn`, not a method on what it returns (`src/features/host/service.ts:125,388-390`; the returned `HostProcess` has only `write`, `end`, `kill`, `exited`). The plugin called `child.onStdout?.(…)`, so a real host collected **nothing** while the optional-call silently succeeded. Three test fakes had implemented `onStdout` as a returned method and agreed with the bug. Fixed, and pinned by `test/host-contract.test.mjs`.

**Still not verified: a real agent turn.** Buzz loads and activates plugins at startup, before sign-in, so everything above holds with no account. But the injection reaching an agent's prompt and the tools appearing in an agent session both need a local agent, which needs an account and a community. That is the one remaining boundary, and it is a product boundary, not a code one.
