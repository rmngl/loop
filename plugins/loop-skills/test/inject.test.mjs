// plugins/loop-skills/test/inject.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { InjectionHolder } from "../src/inject.js";
import { buildInjection } from "../src/index.js";

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
  // Inject a build that throws on the second call, so this tests the catch, not
  // whether some particular entry can make buildInjection fail.
  let calls = 0;
  const build = (entries, options) => {
    calls += 1;
    if (calls === 2) throw new Error("boom");
    return buildInjection(entries, options);
  };
  const holder = new InjectionHolder(register, () => {}, build);
  holder.set([], { language: "ko" });
  const before = [...live][0];
  holder.set([{ slug: "b", description: "d", approvedAt: 1 }], { language: "ko" });
  assert.deepEqual([...live], [before], "the block that was live stays live");
});

test("dispose is idempotent", () => {
  let disposed = 0;
  const holder = new InjectionHolder((t) => () => { disposed++; }, () => {});
  holder.set([], { language: "ko" });
  holder.dispose();
  holder.dispose();
  assert.equal(disposed, 1);
});
