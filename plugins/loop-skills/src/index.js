// The one block that rides in every turn's prompt. This module owns the byte
// budget: the host THROWS above 4096 UTF-8 bytes of trimmed text, so nothing
// here is allowed to exceed it, and nothing here is allowed to throw.

import { utf8Length, DESCRIPTION_MAX } from "./format.js";

/** `addInstructions` refuses anything larger, after trimming. */
export const INJECT_LIMIT = 4096;

const DEFAULT_SKILLS_ROOT = "~/.buzz/SKILLS";

const ENTRY_LINE = (slug, description) => `- ${slug} — ${description}`;

function header(language, root) {
  if (language === "en") {
    return {
      open: "<plugin-instructions plugin=\"loop.skills\">",
      intro: `Approved procedures your owner has written or accepted live in ${root}.`,
      read: "Call skills_read with a slug before starting a task one of them covers.",
      empty: "No approved skills yet — the library is empty and that is fine.",
      draft:
        "If a task made you do something you would otherwise have to be told again, call skills_draft once to propose it. The owner decides; you cannot approve your own draft.",
    };
  }
  return {
    open: "<plugin-instructions plugin=\"loop.skills\">",
    intro: `승인된 절차는 ${root} 에 있습니다.`,
    read: "그 절차가 다루는 작업을 시작하기 전에 skills_read 로 slug 를 지정해 읽으세요.",
    empty: "아직 승인된 스킬이 없습니다. 라이브러리가 비어 있는 것이 정상입니다.",
    draft:
      "다시 설명받지 않아도 되게 만든 일이 있었다면 skills_draft 를 한 번 호출해 제안하세요. 승인은 소유자가 합니다. 자기 초안을 스스로 승인할 수는 없습니다.",
  };
}

const CLOSE = "</plugin-instructions>";

function draftOnly(language, root) {
  const t = header(language, root);
  if (language === "en") {
    return [
      t.open,
      t.intro,
      t.empty,
      `Call skills_list to check. It returns nothing until the owner approves a draft.`,
      t.draft,
      CLOSE,
    ].join("\n");
  }
  return [
    t.open,
    t.intro,
    t.empty,
    "확인하려면 skills_list 를 호출하세요. 소유자가 초안을 승인하기 전까지는 아무것도 나오지 않습니다.",
    t.draft,
    CLOSE,
  ].join("\n");
}

/** One description, cut at a character boundary, ending in an ellipsis. */
function cutDescription(description, maxChars) {
  const chars = [...description];
  if (chars.length <= maxChars) return description;
  return `${chars.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

/**
 * @param entries readonly { slug, description, approvedAt }[], any order
 * @param options { language?: "ko" | "en", skillsRoot?: string }
 * @returns { text, included, dropped }
 */
export function buildInjection(entries, options = {}) {
  const language = options?.language === "en" ? "en" : "ko";
  const root = typeof options?.skillsRoot === "string" && options.skillsRoot
    ? options.skillsRoot
    : DEFAULT_SKILLS_ROOT;

  const all = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && typeof e.slug === "string" && e.slug)
    .map((e) => ({
      slug: e.slug,
      description: typeof e.description === "string" ? e.description.trim() : "",
      approvedAt: typeof e.approvedAt === "number" ? e.approvedAt : 0,
    }))
    .sort((a, b) => b.approvedAt - a.approvedAt || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  // Zero approved skills is a complete product state, not a broken one — and it
  // is the ONLY moment the agent learns to draft, so this must never be "".
  if (all.length === 0) return { text: draftOnly(language, root), included: 0, dropped: 0 };

  const t = header(language, root);
  const head = [t.open, t.intro, "", t.read, ""];
  const list = language === "en"
    ? "Call skills_list to see this list again."
    : "이 목록을 다시 보려면 skills_list 를 호출하세요.";
  const tail = ["", list, t.draft, CLOSE];

  const render = (kept) => [...head, ...kept.map((e) => ENTRY_LINE(e.slug, e.description)), ...tail].join("\n");

  const kept = all.slice();
  let text = render(kept);

  // 1. Drop the oldest whole entries.
  while (utf8Length(text) > INJECT_LIMIT && kept.length > 0) {
    kept.pop();
    text = render(kept);
  }

  // 2. Still over? Trim the longest description, at a character boundary.
  while (utf8Length(text) > INJECT_LIMIT && kept.length > 0) {
    const longest = kept.reduce((a, b) => ([...b.description].length > [...a.description].length ? b : a));
    const chars = [...longest.description];
    if (chars.length <= 1) break;
    longest.description = cutDescription(longest.description, Math.max(1, Math.floor(chars.length / 2)));
    text = render(kept);
  }

  // 3. Last resort: header and footer alone are fixed cost, so the list goes.
  if (utf8Length(text) > INJECT_LIMIT) {
    kept.length = 0;
    text = draftOnly(language, root);
  }

  // Description cap belongs to the entry, not the budget, but enforcing it here
  // means one bad entry cannot push the block over.
  if (kept.some((e) => [...e.description].length > DESCRIPTION_MAX)) {
    for (const e of kept) e.description = cutDescription(e.description, DESCRIPTION_MAX);
    text = render(kept);
    if (utf8Length(text) > INJECT_LIMIT) { kept.length = 0; text = draftOnly(language, root); }
  }

  return { text, included: kept.length, dropped: all.length - kept.length };
}
