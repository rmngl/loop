// plugins/loop-skills/test/host-contract.test.mjs
//
// These assertions are transcribed from block/buzz-app @ 4a87b5cc, not invented.
// Each one pins a shape the plugin got wrong once, and a wrong shape here fails
// silently rather than loudly — which is exactly why it needs a test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const PLUGIN = new URL("../src/plugin.js", import.meta.url);

test("stdout is collected through the spawn OPTION, not a method", async () => {
  // src/features/host/service.ts:125 — onStdout is in HostProcessOptions.
  // :388-390 — spawn(id, {onStdout, onStderr, ...options}).
  // :128-147 — the returned HostProcess has write, end, kill, exited only.
  const text = await readFile(PLUGIN, "utf8");
  assert.match(text, /onStdout:/, "spawn must be given an onStdout option");
  assert.equal(/\.onStdout\?\.\(/.test(text), false,
    "there is no onStdout method on the returned process; calling it silently collects nothing");
});

test("the draft notification opens the Settings card, not a nonexistent page", async () => {
  // src/features/navigation/targets.ts:54-62 — kind "plugin" needs a pageId that
  // the plugin actually publishes. This plugin publishes a settings CARD, so a
  // "plugin" target with pageId "library" opens nothing.
  // :298-322 — kind "settings" + pluginId is accepted only under section "plugins".
  const text = await readFile(PLUGIN, "utf8");
  const target = text.slice(text.indexOf("target:"), text.indexOf("target:") + 300);
  assert.match(target, /kind: "settings"/);
  assert.match(target, /section: "plugins"/);
  assert.match(target, /pluginId: "loop\.skills"/);
  assert.equal(/pageId:/.test(target), false, "a settings card has no pageId");
});

test("inject lists the services apply touches and no others", async () => {
  const { inject } = await import("../plugin.js");
  // `react` is reached as ctx.react by the library card, so it belongs here too.
  assert.deepEqual([...inject].sort(),
    ["agents", "host", "notifications", "react", "settingsCards"]);
});
