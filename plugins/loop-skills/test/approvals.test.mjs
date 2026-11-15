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
