// The approval log is append-only text and the state machine that reads it.
// A corrupt line is counted, never fatal: the log is written by a child process
// that can be killed mid-write, so damage is expected, not exceptional.

export const APPROVAL_ACTION = {
  approve: "approve",
  adopt: "adopt",
  reject: "reject",
  archive: "archive",
};

const ACTIONS = new Set(Object.values(APPROVAL_ACTION));

/** The same shape `validSlug` accepts, duplicated so this module has no deps. */
const SLUG_SHAPE = /^[a-z0-9][a-z0-9._-]*$/;

export function approvalLine({ action, slug, at, by, reason }) {
  if (!ACTIONS.has(action)) throw new Error(`unknown approval action: ${action}`);
  if (typeof slug !== "string" || slug.length === 0 || slug.length > 40 || !SLUG_SHAPE.test(slug)) {
    throw new Error(`refusing to log a hostile slug: ${slug}`);
  }
  const line = { action, slug, at: String(at ?? ""), by: String(by ?? "") };
  if (reason !== undefined) line.reason = String(reason);
  return `${JSON.stringify(line)}\n`;
}

/**
 * Later lines win. `approve`/`adopt` set an approval, `archive` clears it (an
 * archived skill is not an approved one), `reject` clears any approval too.
 */
export function parseApprovals(text) {
  const entries = {};
  let damaged = 0;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      damaged += 1;
      continue;
    }
    if (
      !parsed || typeof parsed !== "object" ||
      !ACTIONS.has(parsed.action) ||
      typeof parsed.slug !== "string" || !SLUG_SHAPE.test(parsed.slug)
    ) {
      damaged += 1;
      continue;
    }
    const record = entries[parsed.slug] ?? {};
    if (parsed.action === APPROVAL_ACTION.approve || parsed.action === APPROVAL_ACTION.adopt) {
      record.approvedAt = String(parsed.at ?? "");
      record.approvedBy = String(parsed.by ?? "");
      delete record.archivedAt;
      delete record.rejectedAt;
    }
    if (parsed.action === APPROVAL_ACTION.reject) {
      record.rejectedAt = String(parsed.at ?? "");
      record.rejectionReason = parsed.reason === undefined ? "" : String(parsed.reason);
      delete record.approvedAt;
      delete record.approvedBy;
    }
    if (parsed.action === APPROVAL_ACTION.archive) {
      record.archivedAt = String(parsed.at ?? "");
      delete record.approvedAt;
      delete record.approvedBy;
    }
    entries[parsed.slug] = record;
  }
  return { entries, damaged };
}

/**
 * @param input {
 *   frontMatter: Record<string,string> | undefined,  // undefined = no readable SKILL.md
 *   record?: { approvedAt?, rejectedAt?, archivedAt? },
 *   draft?: boolean,
 * }
 *
 * Rules are ordered, and the order is the contract. `broken` first, because a
 * folder with no readable file must never inherit an approval it cannot honour.
 */
export function skillState({ frontMatter, record, draft } = {}) {
  if (frontMatter === undefined) return "broken";
  if (record?.archivedAt) return "archived";
  if (record?.approvedAt) return "approved";
  if (record?.rejectedAt) return "rejected";
  if (draft === true) return "draft";
  const claimsApproval = frontMatter && Object.keys(frontMatter).length > 0
    ? frontMatter.approved !== undefined && frontMatter.approved !== ""
    : true; // no front matter at all: hand-written, readable, not trusted
  if (claimsApproval) return "approved-outside-loop";
  return "draft";
}
