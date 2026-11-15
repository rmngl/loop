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
