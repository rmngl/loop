// Installs a plugin folder into Buzz's registry without the GUI.
//
// The app ships no `buzzodz` CLI on Windows, so plugin install is otherwise
// Browse-in-Settings only. This writes the same bytes the Rust manager writes:
//
//   Artifact { manifest, code, readme?, icon_png?, icon_jpg? }  (deny_unknown_fields)
//   revision = sha256(serde_json::to_vec(&Artifact))            compact, not pretty
//   artifact = <home>/profiles/<profile>/artifacts/<id>/<revision>.json
//   registry = <home>/profiles/<profile>/registry.json
//
// Sources are crates/plugin-manager/src/lib.rs (`install_artifact`, `save`) and
// `Artifact`/`Installed`/`ReloadSource`.
//
//   node scripts/install-plugin.mjs <plugin-dir> <buzz-home> [--remove] [--disabled]
//
// <buzz-home> is the app data folder holding `profiles/`: on Windows,
// %APPDATA%\xyz.block.buzz.desktop. Close Buzz first; it rewrites the registry
// from memory on exit.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat, copyFile } from "node:fs/promises";
import { join, dirname, resolve, isAbsolute } from "node:path";

const ARTIFACT_LIMIT = 8 * 1024 * 1024;
const README_LIMIT = 256 * 1024;
const ICON_LIMIT = 256 * 1024;

const usage = () => {
  console.error("usage: node scripts/install-plugin.mjs <plugin-dir> <buzz-home> [--remove] [--disabled]");
  process.exit(2);
};

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const [sourceDir, buzzHome] = args;
if (!sourceDir || !buzzHome) usage();
if (!isAbsolute(buzzHome)) {
  console.error(`buzz-home must be absolute, got: ${buzzHome}`);
  process.exit(2);
}

const profile = process.env.BUZZODZ_PROFILE ?? "default";
if (!/^[a-z][a-z0-9.-]*$/.test(profile)) {
  console.error(`invalid profile name: ${profile}`);
  process.exit(2);
}
const root = join(buzzHome, "profiles", profile);
const registryPath = join(root, "registry.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const optionalFile = async (path, limit) => {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`${path} must be a regular file, not a symlink or folder`);
    if (info.size > limit) throw new Error(`${path} exceeds ${limit} bytes`);
    return readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
};

const manifestText = await readFile(join(sourceDir, "manifest.json"), "utf8");
const code = await readFile(join(sourceDir, "plugin.js"), "utf8");
const manifest = JSON.parse(manifestText);

// The checks `Manifest::validate` makes that a bad folder would fail on anyway,
// surfaced before anything is written.
if (!code.trim()) throw new Error("plugin.js is empty: the build has not run");
if (manifest.apiVersion !== 1) throw new Error(`apiVersion must be 1, got ${manifest.apiVersion}`);
if (typeof manifest.id !== "string" || !/^[a-z][a-z0-9.-]*$/.test(manifest.id) || manifest.id.length > 80) {
  throw new Error(`invalid plugin id: ${manifest.id}`);
}
if (manifest.id.startsWith("buzz.") || manifest.id.startsWith("block.")) {
  throw new Error(`cannot replace a bundled plugin: ${manifest.id}`);
}

const registry = JSON.parse(await readFile(registryPath, "utf8"));
if (!registry.installed || typeof registry.installed !== "object") {
  throw new Error(`${registryPath} has no installed map; open Buzz once first`);
}
const previous = registry.installed[manifest.id];

if (flags.has("--remove")) {
  if (!previous) throw new Error(`${manifest.id} is not installed`);
  await copyFile(registryPath, `${registryPath}.backup-${Date.now()}`);
  delete registry.installed[manifest.id];
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  console.log(`removed ${manifest.id} (its artifact stays on disk)`);
  process.exit(0);
}

// A signed install may not become unsigned, and a publisher may not change.
if (previous?.currentSignature) {
  throw new Error(
    "Publisher changed or signed plugin became unsigned; remove and reinstall to change publisher",
  );
}

const artifact = { manifest, code };
const readme = await optionalFile(join(sourceDir, "README.md"), README_LIMIT);
if (readme) artifact.readme = readme.toString("utf8");
const iconPng = await optionalFile(join(sourceDir, "icon.png"), ICON_LIMIT);
if (iconPng) artifact.icon_png = iconPng.toString("base64");
const iconJpg = await optionalFile(join(sourceDir, "icon.jpg"), ICON_LIMIT);
if (iconJpg) artifact.icon_jpg = iconJpg.toString("base64");

// serde_json::to_vec is compact and follows struct order, which is the order of
// the keys above. Do not reorder these without re-checking the Rust struct.
const bytes = Buffer.from(JSON.stringify(artifact), "utf8");
if (bytes.length > ARTIFACT_LIMIT) throw new Error(`artifact exceeds 8 MiB: ${bytes.length}`);
const revision = sha256(bytes);

// ReloadSource::folder: the root must be absolute, the path relative.
const absoluteSource = resolve(sourceDir);
const sourceInfo = await stat(absoluteSource);
if (!sourceInfo.isDirectory()) throw new Error("Reload source root must be a regular folder");
const source = { root: absoluteSource, path: "." };

const installed = {
  manifest,
  current: revision,
  currentSource: source,
  // A new revision pushes the old one to `previous`; reinstalling the same one
  // keeps whatever history was there, exactly as install_artifact does.
  previous: previous && previous.current !== revision ? previous.current : (previous?.previous ?? null),
  previousSource:
    previous && previous.current !== revision
      ? (previous.currentSource ?? null)
      : (previous?.previousSource ?? null),
  enabled: flags.has("--disabled") ? false : true,
};
for (const key of ["readmeRevision", "iconPngRevision", "iconJpgRevision"]) {
  if (previous?.[key] !== undefined) installed[key] = previous[key];
}

// Backup before the registry changes: if Buzz rejects the entry it resets the
// profile, and that takes every other plugin's settings with it.
await copyFile(registryPath, `${registryPath}.backup-${Date.now()}`);

const artifactPath = join(root, "artifacts", manifest.id, `${revision}.json`);
await mkdir(dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, bytes);

// Fail here, not as "Installed artifact failed its integrity check" inside Buzz.
const written = await readFile(artifactPath);
if (sha256(written) !== revision) throw new Error("written artifact does not match its revision");
if (JSON.parse(written.toString("utf8")).code !== code) throw new Error("artifact code round-trip mismatch");

registry.installed[manifest.id] = installed;
await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");

const after = JSON.parse(await readFile(registryPath, "utf8"));
if (after.installed[manifest.id]?.current !== revision) throw new Error("registry write did not take");

console.log(`installed ${manifest.id}`);
console.log(`  revision : ${revision}`);
console.log(`  artifact : ${artifactPath} (${bytes.length} bytes)`);
console.log(`  enabled  : ${installed.enabled}`);
console.log(`  source   : ${absoluteSource}`);
