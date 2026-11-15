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
