// Front matter, slug rules, folder layout, and byte math. No I/O, no host calls.
// Everything here is pure so it can run under plain `node --test`.

export const SLUG_MAX = 40;
export const DESCRIPTION_MAX = 48;

/** Windows device names, refused with or without an extension. */
const DEVICE_NAMES = [
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

export const RESERVED_SLUGS = new Set([
  "_drafts", "_rejected", "_archived", ".state", "index", "INDEX", "AGENTS",
  ...DEVICE_NAMES,
]);

/** The order keys are written in; anything else follows, sorted. */
const KEY_ORDER = [
  "name", "description", "slug", "lang", "author", "channel",
  "created_at", "approved", "approved_at", "why", "status",
];

/** UTF-8 bytes. The host's 4096-byte cap is bytes, not characters. */
export function utf8Length(text) {
  return Buffer.byteLength(text, "utf8");
}

/** `con`, `CON.md`, `Aux.tar.gz` all resolve to a device name on Windows. */
function isDeviceName(rest) {
  const stem = rest.split(".")[0].toLowerCase();
  return DEVICE_NAMES.includes(stem);
}

export function validSlug(value) {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > SLUG_MAX) return false;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value)) return false;
  if (value.endsWith("-") || value.endsWith(".")) return false;
  if (RESERVED_SLUGS.has(value.toLowerCase())) return false;
  if (isDeviceName(value)) return false;
  return true;
}

/**
 * Split on the FIRST `---` line and the NEXT `---` line only. A `---` later in
 * the body is body text, so a body cannot open its own front matter block.
 * `data` is `{}` for a file with no front matter — never an error.
 */
export function parseSkill(text) {
  const source = typeof text === "string" ? text : "";
  const lines = source.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") return { data: {}, body: trimBody(source) };

  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") { close = i; break; }
  }
  // An unterminated block is not front matter; treat the whole file as body.
  if (close === -1) return { data: {}, body: trimBody(source) };

  const data = {};
  let lastKey = null;
  for (const raw of lines.slice(1, close)) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    // A continuation line (no colon) is folded into the previous value.
    if (colon === -1 || /^\s/.test(line)) {
      if (lastKey) data[lastKey] = `${data[lastKey]} ${line.trim()}`.trim();
      continue;
    }
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key) { data[key] = value; lastKey = key; }
  }

  return { data, body: trimBody(lines.slice(close + 1).join("\n")) };
}

/** Leading blank lines only. Trailing newlines are normalised away. */
function trimBody(body) {
  return body.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/\s+$/, "");
}

/** Any front-matter-shaped block at the head of a body is removed. */
function stripLeadingBlock(body) {
  const { body: stripped } = parseSkill(body);
  const looksLikeBlock = /^\s*---\r?\n/.test(body);
  return looksLikeBlock ? stripped : body;
}

export function renderSkill(data, body) {
  const keys = Object.keys(data ?? {}).filter((k) => data[k] !== undefined && data[k] !== null);
  const ordered = [
    ...KEY_ORDER.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !KEY_ORDER.includes(k)).sort(),
  ];
  const head = ordered.map((k) => `${k}: ${String(data[k]).replace(/\r?\n/g, " ").trim()}`);
  const clean = trimBody(stripLeadingBlock(typeof body === "string" ? body : ""));
  return `---\n${head.join("\n")}\n---\n\n${clean}\n`;
}

/** Absolute paths only; the caller passes an already-resolved root. */
export function skillPaths(root, slug) {
  const at = (relative) => `${root}/${relative}`;
  return {
    dir: at(slug),
    file: at(`${slug}/SKILL.md`),
    draft: at(`_drafts/${slug}.md`),
    rejected: at(`_rejected/${slug}.md`),
    archived: at(`_archived/${slug}`),
    state: at(".state"),
    index: at("INDEX.md"),
  };
}
