// The library humans approve from. Pure helpers first, so the sentences and the
// row model are testable without a React renderer; the component is built from
// them with `ctx.react.createElement` only — no JSX, no imports.

export const POINTER_START = "<!-- loop:skills:start -->";
export const POINTER_END = "<!-- loop:skills:end -->";

/** The three-line block the helper writes into the agent's AGENTS.md. */
export function pointerBlock() {
  const line = "Approved procedures live in `SKILLS/INDEX.md`. Read it before a task that one of them covers.";
  return `${POINTER_START}\n${line}\n${POINTER_END}`;
}

/**
 * What an empty library says. Not a form, not a starter pack, and not an
 * instruction to do our work — the agent drafts, the human decides.
 */
export function emptyLibrarySentence(language = "ko") {
  if (language === "en") {
    return "Have you asked for the same thing twice this week? Start with that. If not, just keep working — your agents will propose procedures as they go.";
  }
  return "지난주에 같은 일을 두 번 이상 시킨 게 있나요? 있으면 그걸로 시작하세요. 없으면 그냥 쓰세요 — 에이전트가 알아서 초안을 올립니다.";
}

/**
 * One draft row. `why` is the whole point of the row: it is the sentence the
 * human would otherwise have to keep retyping, so a missing one is stated
 * plainly rather than rendered as blank space.
 */
export function draftRowModel({ slug, frontMatter, body }) {
  const data = frontMatter ?? {};
  const why = typeof data.why === "string" && data.why.trim()
    ? data.why.trim()
    : "No why given. Ask the agent, or reject it — a draft that cannot say what it saves is not worth approving.";
  return {
    slug,
    name: typeof data.name === "string" && data.name ? data.name : slug,
    description: typeof data.description === "string" ? data.description : "",
    why,
    body: String(body ?? ""),
    author: typeof data.author === "string" ? data.author : "",
    channel: typeof data.channel === "string" ? data.channel : "",
    language: typeof data.lang === "string" ? data.lang : "ko",
  };
}

const CHIP = {
  draft: { text: "초안", tone: "warning" },
  approved: { text: "승인됨", tone: "success" },
  "approved-outside-loop": { text: "loop 밖에서 승인됨", tone: "danger" },
  rejected: { text: "거절됨", tone: "muted" },
  archived: { text: "보관됨", tone: "muted" },
  broken: { text: "읽을 수 없음", tone: "danger" },
};

export function stateChip(state) {
  return CHIP[state] ?? { text: state, tone: "muted" };
}

/**
 * The settings card. `deps` gives it the spawn, the root, and a refresh hook;
 * everything it shows comes from the helper's `list`, so the files stay the
 * record and this stays a view.
 */
export function LibraryCard(ctx, deps) {
  const React = ctx.react;
  const h = React.createElement;

  return function SkillsLibrary() {
    const [rows, setRows] = React.useState(null);
    const [busy, setBusy] = React.useState("");
    const [error, setError] = React.useState("");

    const load = React.useCallback(async () => {
      try {
        const reply = deps.parse(deps.spawn("list", { root: deps.root() }));
        const skills = (await reply)?.data?.skills ?? [];
        setRows(skills);
        setError("");
      } catch (problem) {
        setError(String(problem?.message ?? problem));
      }
    }, []);

    React.useEffect(() => { void load(); }, [load]);

    const act = async (command, payload) => {
      setBusy(`${command}:${payload.slug ?? ""}`);
      try {
        await deps.spawn(command, { root: deps.root(), ...payload });
        await deps.refresh?.();
        await load();
      } catch (problem) {
        setError(String(problem?.message ?? problem));
      } finally {
        setBusy("");
      }
    };

    if (rows === null) {
      return h("div", { className: "ui-card", style: { padding: "var(--space-panel-inset)" } },
        h("p", null, "불러오는 중…"));
    }

    const drafts = rows.filter((r) => r.state === "draft");
    const approved = rows.filter((r) => r.state === "approved");
    const outside = rows.filter((r) => r.state === "approved-outside-loop");
    const broken = rows.filter((r) => r.state === "broken");

    const row = (skill) => {
      const chip = stateChip(skill.state);
      return h("div", {
        key: skill.slug,
        className: "ui-card",
        style: { padding: "var(--space-2)", marginBottom: "var(--space-2)" },
      },
        h("div", { style: { display: "flex", gap: "var(--space-2)", alignItems: "baseline" } },
          h("span", { className: `ui-chip ui-chip-${chip.tone}` }, chip.text),
          h("strong", null, skill.name || skill.slug),
          h("span", { style: { opacity: 0.7 } }, skill.description || "")),
        skill.state === "approved"
          ? h("div", { style: { marginTop: "var(--space-1)" } },
            h("button", { type: "button", onClick: () => act("archive", { slug: skill.slug, by: "owner" }) }, "보관"))
          : null,
        skill.state === "approved-outside-loop"
          ? h("div", { style: { marginTop: "var(--space-1)" } },
            h("span", { style: { opacity: 0.7 } }, "loop 밖에서 만든 파일입니다. 내용을 확인하고 승인하세요."),
            h("button", { type: "button", onClick: () => act("adopt", { slug: skill.slug, by: "owner" }) }, "승인"))
          : null,
      );
    };

    return h("div", null,
      error ? h("p", { className: "ui-text-danger" }, error) : null,
      rows.length === 0
        ? h("p", null, emptyLibrarySentence("ko"))
        : null,
      drafts.length
        ? h("section", null, h("h3", null, "검토 대기"), drafts.map((skill) =>
          h("div", { key: skill.slug }, row(skill),
            h("div", { style: { display: "flex", gap: "var(--space-2)" } },
              h("button", {
                type: "button",
                disabled: busy !== "",
                onClick: () => act("approve", { slug: skill.slug, by: "owner" }),
              }, "승인"),
              h("button", {
                type: "button",
                disabled: busy !== "",
                onClick: () => act("reject", { slug: skill.slug, by: "owner", reason: "본문이 부족함" }),
              }, "거절")))))
        : null,
      approved.length
        ? h("section", null, h("h3", null, "승인된 절차"), approved.map(row))
        : null,
      outside.length
        ? h("section", null, h("h3", null, "loop 밖에서 승인됨"), outside.map(row))
        : null,
      broken.length
        ? h("section", null, h("h3", null, "읽을 수 없는 폴더"), broken.map(row))
        : null,
    );
  };
}
