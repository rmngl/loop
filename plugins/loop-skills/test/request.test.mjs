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
