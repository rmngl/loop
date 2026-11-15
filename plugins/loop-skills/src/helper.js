// The Node helper, as source text. `scripts/build.mjs` reads this file as text,
// so the code below is a STRING: it is not compiled with the plugin, and it can
// import node builtins freely because the spawned process is not sandboxed by
// the plugin loader.
//
// Two build hazards, both handled here rather than fought:
//   1. Every line of the helper is indented by two spaces and dedented at
//      runtime. `build.mjs` scans each src file for names at column 0, so an
//      unindented `function readSkill(` would be collected as a module export
//      that does not exist, and the build would produce a module that throws.
//   2. No backticks and no `${` anywhere below. This is a template literal.

const RAW = String.raw`
  import { readFile, writeFile, mkdir, rm, readdir, rename, stat } from "node:fs/promises";
  import { join, isAbsolute, dirname } from "node:path";

  const BODY_MAX = 61440;
  const START = "<!-- loop:skills:start -->";
  const END = "<!-- loop:skills:end -->";
  const POINTER = "Approved procedures live in %B%SKILLS/INDEX.md%B%. Read it before a task that one of them covers.";
  const KEY_ORDER = ["name", "description", "slug", "lang", "author", "channel",
    "created_at", "approved", "approved_at", "why", "status"];
  const TICK = String.fromCharCode(96);

  const done = (data) => process.stdout.write(JSON.stringify({ ok: true, data: data }) + "\n");
  const fail = (error, extra) =>
    process.stdout.write(JSON.stringify(Object.assign({ ok: false, error: error }, extra || {})) + "\n");

  const SLUG_SHAPE = /^[a-z0-9][a-z0-9._-]*$/;
  const RESERVED = new Set(["_drafts", "_rejected", "_archived", ".state", "index", "agents",
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"]);

  function slugOk(value) {
    if (typeof value !== "string") return false;
    if (!value || value.length > 40) return false;
    if (!SLUG_SHAPE.test(value)) return false;
    if (value.endsWith("-") || value.endsWith(".")) return false;
    const lower = value.toLowerCase();
    if (RESERVED.has(lower)) return false;
    if (RESERVED.has(lower.split(".")[0])) return false;
    return true;
  }

  function trimBody(body) {
    return String(body || "").replace(/^(?:[ \t]*\r?\n)+/, "").replace(/\s+$/, "");
  }

  function parseFm(text) {
    const source = typeof text === "string" ? text : "";
    const lines = source.split(/\r?\n/);
    if (!lines.length || lines[0].trim() !== "---") return { data: {}, body: trimBody(source) };
    let close = -1;
    for (let i = 1; i < lines.length; i += 1) if (lines[i].trim() === "---") { close = i; break; }
    if (close === -1) return { data: {}, body: trimBody(source) };
    const data = {};
    let lastKey = null;
    for (const raw of lines.slice(1, close)) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      const colon = line.indexOf(":");
      if (colon === -1 || /^\s/.test(line)) {
        if (lastKey) data[lastKey] = (data[lastKey] + " " + line.trim()).trim();
        continue;
      }
      const key = line.slice(0, colon).trim();
      let value = line.slice(colon + 1).trim();
      if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
        value = value.slice(1, -1);
      }
      if (key) { data[key] = value; lastKey = key; }
    }
    return { data: data, body: trimBody(lines.slice(close + 1).join("\n")) };
  }

  function renderFm(data, body) {
    const keys = Object.keys(data).filter((k) => data[k] !== undefined && data[k] !== null);
    const ordered = KEY_ORDER.filter((k) => keys.indexOf(k) !== -1)
      .concat(keys.filter((k) => KEY_ORDER.indexOf(k) === -1).sort());
    const head = ordered.map((k) => k + ": " + String(data[k]).replace(/\r?\n/g, " ").trim());
    return "---\n" + head.join("\n") + "\n---\n\n" + trimBody(body) + "\n";
  }

  async function readText(file) {
    try {
      const info = await stat(file);
      if (!info.isFile()) return null;
      const text = await readFile(file, "utf8");
      return text.trim() ? text : null;
    } catch { return null; }
  }

  async function writeText(file, text) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
  }

  async function appendLog(root, line) {
    const file = join(root, ".state", "approvals.jsonl");
    await mkdir(dirname(file), { recursive: true });
    let existing = "";
    try { existing = await readFile(file, "utf8"); } catch {}
    if (existing && !existing.endsWith("\n")) existing += "\n";
    await writeFile(file, existing + line, "utf8");
  }

  async function readLog(root) {
    const file = join(root, ".state", "approvals.jsonl");
    const text = await readText(file);
    const entries = {};
    if (!text) return entries;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (!parsed || typeof parsed.slug !== "string") continue;
      const record = entries[parsed.slug] || (entries[parsed.slug] = {});
      if (parsed.action === "approve" || parsed.action === "adopt") {
        record.approvedAt = String(parsed.at || "");
        record.approvedBy = String(parsed.by || "");
        delete record.archivedAt; delete record.rejectedAt;
      } else if (parsed.action === "reject") {
        record.rejectedAt = String(parsed.at || "");
        record.rejectionReason = parsed.reason === undefined ? "" : String(parsed.reason);
        delete record.approvedAt; delete record.approvedBy;
      } else if (parsed.action === "archive") {
        record.archivedAt = String(parsed.at || "");
        delete record.approvedAt; delete record.approvedBy;
      }
    }
    return entries;
  }

  function stateOf(frontMatter, record, draft) {
    if (frontMatter === undefined) return "broken";
    if (record && record.archivedAt) return "archived";
    if (record && record.approvedAt) return "approved";
    if (record && record.rejectedAt) return "rejected";
    if (draft === true) return "draft";
    if (!frontMatter || Object.keys(frontMatter).length === 0) return "approved-outside-loop";
    return frontMatter.approved ? "approved-outside-loop" : "draft";
  }

  async function listSkills(root) {
    const log = await readLog(root);
    let names = [];
    try { names = await readdir(root); } catch { return []; }
    const skills = [];
    for (const name of names.sort()) {
      if (name.startsWith("_") || name.startsWith(".") || !slugOk(name)) continue;
      const text = await readText(join(root, name, "SKILL.md"));
      const fm = text === null ? undefined : parseFm(text).data;
      const record = log[name];
      skills.push({
        slug: name,
        name: (fm && fm.name) || name,
        description: (fm && fm.description) || "",
        state: stateOf(fm, record, false),
        approvedAt: record && record.approvedAt ? record.approvedAt : null,
        why: (fm && fm.why) || "",
      });
    }
    return skills;
  }

  function approvedSet(skills) {
    return skills.filter((s) => s.state === "approved")
      .sort((a, b) => String(b.approvedAt || "").localeCompare(String(a.approvedAt || "")));
  }

  async function writeIndex(root, skills) {
    const approved = approvedSet(skills);
    const lines = ["# Skills", "",
      "Generated by loop.skills. Files under each folder are the record; this page is a copy.", ""];
    if (!approved.length) lines.push("No approved skills yet.", "");
    for (const skill of approved) {
      lines.push("- " + skill.slug + " \u2014 " + (skill.description || skill.name));
    }
    const text = lines.join("\n") + "\n";
    await writeText(join(root, "INDEX.md"), text);
    return { entries: approved.length, bytes: Buffer.byteLength(text, "utf8") };
  }

  function block() { return START + "\n" + POINTER + "\n" + END; }

  async function setPointer(file, add) {
    let existing = "";
    try { existing = await readFile(file, "utf8"); } catch {}
    const has = existing.indexOf(START) !== -1;
    if (add && has) return { changed: false };
    if (!add && !has) return { changed: false };
    let next;
    if (add) {
      next = existing.replace(/\s+$/, "") + "\n\n" + block() + "\n";
    } else {
      next = existing.replace(new RegExp("\\n*" + START + "[\\s\\S]*?" + END + "\\n?"), "").replace(/\s+$/, "");
      next = next ? next + "\n" : "";
    }
    await writeText(file, next);
    return { changed: true };
  }

  function requireBody(body) {
    if (typeof body !== "string" || !body.trim()) return "the procedure body is empty";
    if (Buffer.byteLength(body, "utf8") > BODY_MAX) {
      return "the procedure is too large: " + Buffer.byteLength(body, "utf8") + " bytes, limit " + BODY_MAX;
    }
    return null;
  }

  async function handle(request) {
    const root = request.root;
    if (typeof root !== "string" || !isAbsolute(root)) return fail("root must be an absolute path");
    const command = request.command;
    const slug = request.slug;

    if (command === "list") return done({ skills: await listSkills(root) });

    if (command === "index") return done(await writeIndex(root, await listSkills(root)));

    if (command === "pointer") {
      const file = request.agentsFile;
      if (typeof file !== "string" || !isAbsolute(file)) return fail("agentsFile must be an absolute path");
      return done(await setPointer(file, request.add === true));
    }

    if (command !== "list" && !slugOk(slug)) {
      return fail("that is not a usable skill id: use lowercase letters, digits, dot, dash or underscore");
    }

    if (command === "read") {
      const text = await readText(join(root, slug, "SKILL.md"));
      if (text === null) return fail('no SKILL.md for "' + slug + '"');
      const skills = await listSkills(root);
      const found = skills.find((s) => s.slug === slug);
      if (!found || found.state !== "approved") {
        return fail('"' + slug + '" is not approved, so it cannot be read');
      }
      const parsed = parseFm(text);
      const refs = [];
      const refPattern = new RegExp(TICK + "([^" + TICK + "]+\\.(?:md|mjs|js|py|sh|csv))" + TICK, "g");
      let match;
      while ((match = refPattern.exec(parsed.body))) refs.push(match[1]);
      return done({
        text: text, frontMatter: parsed.data, body: parsed.body,
        references: Array.from(new Set(refs)),
      });
    }

    if (command === "draft") {
      const problem = requireBody(request.body);
      if (problem) return fail(problem);
      const pending = await readText(join(root, "_drafts", slug + ".md"));
      if (pending) return fail("pending");
      const log = await readLog(root);
      const record = log[slug];
      if (record && record.rejectedAt) {
        return fail("rejected", { reason: record.rejectionReason || "" });
      }
      if (await readText(join(root, slug, "SKILL.md"))) {
        return fail("already-approved");
      }
      const data = {
        name: String(request.name || slug),
        description: String(request.description || ""),
        slug: slug,
        lang: String(request.lang || "ko"),
        author: String(request.agent || "agent"),
        channel: String(request.channel || ""),
        created_at: new Date().toISOString(),
        why: String(request.why || ""),
        status: "draft",
      };
      const body = parseFm(request.body).body;
      const file = join(root, "_drafts", slug + ".md");
      await writeText(file, renderFm(data, body));
      return done({ path: file });
    }

    if (command === "reject") {
      const file = join(root, "_drafts", slug + ".md");
      const text = await readText(file);
      if (text === null) return fail('no draft named "' + slug + '"');
      await appendLog(root, JSON.stringify({
        action: "reject", slug: slug, at: new Date().toISOString(),
        by: String(request.by || "owner"), reason: String(request.reason || ""),
      }) + "\n");
      await mkdir(join(root, "_rejected"), { recursive: true });
      await rename(file, join(root, "_rejected", slug + ".md"));
      return done({ moved: slug });
    }

    if (command === "approve") {
      const file = join(root, "_drafts", slug + ".md");
      const text = await readText(file);
      if (text === null) return fail('no draft named "' + slug + '"');
      const parsed = parseFm(text);
      const now = new Date().toISOString();
      const data = Object.assign({}, parsed.data, { slug: slug, approved: String(request.by || "owner"), approved_at: now });
      delete data.status;
      const target = join(root, slug, "SKILL.md");
      await writeText(target, renderFm(data, parsed.body));
      await appendLog(root, JSON.stringify({
        action: "approve", slug: slug, at: now, by: String(request.by || "owner"),
      }) + "\n");
      await rm(file, { force: true });
      return done({ path: target, approvedAt: now });
    }

    if (command === "adopt") {
      const target = join(root, slug, "SKILL.md");
      const text = await readText(target);
      if (text === null) return fail('no SKILL.md for "' + slug + '"');
      const parsed = parseFm(text);
      const now = new Date().toISOString();
      const data = Object.assign({}, parsed.data, { slug: slug, approved: String(request.by || "owner"), approved_at: now });
      delete data.status;
      await writeText(target, renderFm(data, parsed.body));
      await appendLog(root, JSON.stringify({
        action: "adopt", slug: slug, at: now, by: String(request.by || "owner"),
      }) + "\n");
      return done({ path: target, approvedAt: now });
    }

    if (command === "archive") {
      const target = join(root, slug);
      try { await stat(target); } catch { return fail('no skill named "' + slug + '"'); }
      const now = new Date().toISOString();
      await mkdir(join(root, "_archived"), { recursive: true });
      await rename(target, join(root, "_archived", slug));
      await appendLog(root, JSON.stringify({
        action: "archive", slug: slug, at: now, by: String(request.by || "owner"),
      }) + "\n");
      return done({ moved: slug });
    }

    return fail("unknown command: " + String(command));
  }

  async function main() {
    let raw = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) raw += chunk;
    let request;
    try { request = JSON.parse(raw); } catch { return fail("the request was not JSON"); }
    await handle(request);
  }

  main().catch((error) => fail(String((error && error.message) || error)));
`;

/** Dedented helper source, ready to pass as `node --input-type=module -e`. */
export const HELPER_SOURCE = RAW
  .replace(/^ {2}/gm, "")
  .replace(/^\n/, "")
  // A literal backtick cannot appear inside a template literal, so %B% stands in.
  .replace(/%B%/g, String.fromCharCode(96));
