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
