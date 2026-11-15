// plugins/loop-skills/test/install.test.mjs
//
// The headless installer writes the bytes Buzz verifies. A drift here shows up
// as "Installed artifact failed its integrity check" at app start, which is a
// bad place to learn about it, so the format is pinned here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A Buzz home with only the registry a launch would leave behind. */
async function freshHome() {
  const home = await mkdtemp(join(tmpdir(), "buzz-home-"));
  await mkdir(join(home, "profiles", "default"), { recursive: true });
  await writeFile(
    join(home, "profiles", "default", "registry.json"),
    JSON.stringify({ version: 2, bundledEnabled: true, bundledOverrides: {}, installed: {} }, null, 2),
    "utf8",
  );
  return home;
}

/** A plugin folder copied out of the real one, so the test cannot drift from it. */
async function freshPlugin() {
  const dir = await mkdtemp(join(tmpdir(), "plugin-"));
  // Every file read_package reads. README.md is optional in the format but is
  // part of what this plugin ships, so a packaging bug must show up here.
  for (const file of ["manifest.json", "plugin.js", "README.md"]) {
    await cp(join("plugins", "loop-skills", file), join(dir, file));
  }
  return dir;
}

const install = (plugin, home, ...flags) =>
  execFileSync(
    process.execPath,
    ["plugins/loop-skills/scripts/install-plugin.mjs", plugin, home, ...flags],
    { encoding: "utf8", stdio: "pipe" },
  );

test("writes an artifact whose sha256 is the registry's revision", async () => {
  const home = await freshHome();
  const plugin = await freshPlugin();
  const out = install(plugin, home);
  assert.match(out, /installed loop\.skills/);

  const registry = JSON.parse(await readFile(join(home, "profiles", "default", "registry.json"), "utf8"));
  const entry = registry.installed["loop.skills"];
  assert.ok(entry, "the plugin is in the registry");
  assert.equal(entry.enabled, true);
  assert.equal(entry.previous, null, "a first install has no previous revision");

  const artifactPath = join(home, "profiles", "default", "artifacts", "loop.skills", `${entry.current}.json`);
  const bytes = await readFile(artifactPath);
  // This is the exact check Buzz makes on load (lib.rs `artifact()`).
  assert.equal(sha256(bytes), entry.current, "artifact bytes must hash to the revision");
});

test("the artifact has only the keys the Rust struct allows", async () => {
  const home = await freshHome();
  const plugin = await freshPlugin();
  install(plugin, home);
  const registry = JSON.parse(await readFile(join(home, "profiles", "default", "registry.json"), "utf8"));
  const entry = registry.installed["loop.skills"];
  const artifact = JSON.parse(
    await readFile(join(home, "profiles", "default", "artifacts", "loop.skills", `${entry.current}.json`), "utf8"),
  );

  // `deny_unknown_fields` on Artifact: a stray key fails the whole load.
  const allowed = new Set(["manifest", "code", "readme", "icon_png", "icon_jpg"]);
  for (const key of Object.keys(artifact)) assert.ok(allowed.has(key), `unexpected artifact key: ${key}`);
  assert.equal(typeof artifact.code, "string");
  assert.ok(artifact.code.includes("export function apply"), "the code is the built module");
  assert.match(artifact.readme ?? "", /loop Skills/, "README.md is carried when present");
});

test("the folder source is absolute, and the path is relative", async () => {
  const home = await freshHome();
  const plugin = await freshPlugin();
  install(plugin, home);
  const registry = JSON.parse(await readFile(join(home, "profiles", "default", "registry.json"), "utf8"));
  const source = registry.installed["loop.skills"].currentSource;
  // `ReloadSource::folder` rejects a relative root; plugin_reload needs `folder`.
  assert.equal(isAbsolutePath(source.root), true, `root must be absolute: ${source.root}`);
  assert.equal(source.path, ".");
});

test("a second install of a changed build records the old revision", async () => {
  const home = await freshHome();
  const plugin = await freshPlugin();
  install(plugin, home);
  const first = JSON.parse(await readFile(join(home, "profiles", "default", "registry.json"), "utf8"))
    .installed["loop.skills"].current;

  await writeFile(join(plugin, "plugin.js"), `${await readFile(join(plugin, "plugin.js"), "utf8")}\n// changed\n`, "utf8");
  install(plugin, home);
  const entry = JSON.parse(await readFile(join(home, "profiles", "default", "registry.json"), "utf8"))
    .installed["loop.skills"];
  assert.notEqual(entry.current, first, "a changed build is a new revision");
  assert.equal(entry.previous, first, "the old revision is kept for rollback");
  assert.equal(entry.enabled, true, "reinstalling keeps it enabled");
});

test("--disabled installs without enabling, and --remove takes it out", async () => {
  const home = await freshHome();
  const plugin = await freshPlugin();
  install(plugin, home, "--disabled");
  let registry = JSON.parse(await readFile(join(home, "profiles", "default", "registry.json"), "utf8"));
  assert.equal(registry.installed["loop.skills"].enabled, false);

  install(plugin, home, "--remove");
  registry = JSON.parse(await readFile(join(home, "profiles", "default", "registry.json"), "utf8"));
  assert.equal(registry.installed["loop.skills"], undefined, "removed from the registry");
});

test("a relative buzz-home is refused rather than guessed", async () => {
  const plugin = await freshPlugin();
  assert.throws(
    () => install(plugin, "relative/home"),
    (error) => /buzz-home must be absolute/.test(String(error.stderr ?? error.message)),
  );
});

test("an empty plugin.js is refused, because the build did not run", async () => {
  const home = await freshHome();
  const plugin = await freshPlugin();
  await writeFile(join(plugin, "plugin.js"), "  \n", "utf8");
  assert.throws(
    () => install(plugin, home),
    (error) => /plugin\.js is empty/.test(String(error.stderr ?? error.message)),
  );
});

test("a bundled plugin id cannot be replaced", async () => {
  const home = await freshHome();
  const plugin = await freshPlugin();
  const manifest = JSON.parse(await readFile(join(plugin, "manifest.json"), "utf8"));
  manifest.id = "buzz.channels";
  await writeFile(join(plugin, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  assert.throws(
    () => install(plugin, home),
    (error) => /cannot replace a bundled plugin/.test(String(error.stderr ?? error.message)),
  );
});

function isAbsolutePath(value) {
  return typeof value === "string" && (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value));
}
