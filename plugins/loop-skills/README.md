# loop Skills

A folder of approved procedures your agents can read, and drafts they propose.

Agents do not get better because they are told to. They get better when the
procedure they used last week is still there this week, and when the human never
has to retype it.

## Install

1. **Settings → Plugins → Manage plugins → Add → Browse**, then pick this folder
   (`plugins/loop-skills`).
2. Review the host access it asks for: **files** (read) and **processes** (a
   `node` helper). Select **Install plugin**.

Use **Browse**, not drag-and-drop. A dragged folder is copied into Buzz's own
storage, so `plugin_reload` has nothing to reload and your edits never reach the
running plugin.

You need Node 22 or newer on `PATH`, because every write goes through a spawned
helper.

## Where the files are

```
~/.buzz/SKILLS/
  <slug>/SKILL.md          an approved procedure (front matter + markdown body)
  _drafts/<slug>.md        a draft, invisible to every agent
  _rejected/<slug>.md      a rejected draft, kept so the agent can read why
  _archived/<slug>/        an archived skill, out of the list
  .state/approvals.jsonl   append-only decisions
  INDEX.md                 a generated human-readable copy
```

**The files are the record.** `INDEX.md` is regenerated from them and is never
what the agent's prompt is built from — one edited line there cannot silently
change what every agent believes.

The approved set is injected into every turn as one `<plugin-instructions>`
block, capped at 4096 bytes. When the block fills up, the oldest entries are
dropped; `skills_list` still returns all of them.

## The three tools an agent gets

| tool | what it does |
|---|---|
| `skills_list` | one line per approved skill, slug + when to use it |
| `skills_read` | the whole procedure, by slug |
| `skills_draft` | propose a new one; lands in `_drafts/` until a human approves |

Review and approve in **Settings → Skills**. Approve, Reject (with a reason),
Adopt (a hand-written file), Archive. A rejected slug comes back to the agent
with the reason, so it can do better instead of resubmitting the same thing.

## What this does not do

- **It is shared by every local agent.** Approval is global in v1. A per-agent
  toggle is a later feature; do not assume one exists.
- **Codex agents do not read this folder.** They read `~/.codex/skills`. They
  still get the tools, so they can call `skills_read`, but the folder-based path
  is not theirs.
- **Local agents only.** Hosted and Mesh agents get neither the index nor the
  tools.
- **The gate is not a security boundary.** An agent with `write` and `bash` can
  edit these files directly. The approval gate prevents accidents and leaves an
  audit trail. It is not a sandbox, and it was never meant to be one.
- **No token savings.** Measured, not assumed: for a short procedure the skill
  path costs about 30% more prompt tokens than stating the rules inline, because
  the index line plus a `skills_read` round trip exceeds the rules themselves.
  The saving is the human's, not the model's — you stop retyping the same six
  rules every week. For long procedures it wins both ways.

## If something is wrong

- **No card in Settings → Skills**: the plugin failed to activate. Check
  `plugin_status` with `id: "loop.skills"`.
- **A folder shows as 읽을 수 없음 (unreadable)**: it has no `SKILL.md`, or the
  file is empty or unreadable. Fix or remove the folder; it is never injected.
- **"Processes require an installed desktop plugin"**: the plugin is not marked
  as a desktop plugin, or the host refused `spawn`. Writes need the desktop app.
- **A skill in the list that you did not approve**: it was written outside loop.
  It appears under 승인됨 밖 (approved outside loop) with an Adopt button, and its
  front matter is never trusted on its own.
