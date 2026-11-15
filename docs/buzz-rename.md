# Renaming Buzz to loop

Status: applied to the fork; typecheck, Rust compile, and the identity suite pass.
Fork: `block/buzz-app` @ `4a87b5cc` + the no-account patch + this rename.

## Why

Three separate reasons, in ascending order of force:

1. **The product is loop.** Buzz is the app loop was built on; shipping a
   product under another company's name makes every later decision about what
   loop is harder to explain.
2. **The license permits it but does not require it.** `LICENSE` is Apache-2.0,
   which grants the right to modify and redistribute. It does not require a
   rename. Anyone saying "라이선스 때문에 바꿔야 한다" is half right: the license
   is not the problem, and the license is the thing that must be kept.
3. **The trademark is the real reason.** Apache-2.0 §6 grants no trademark
   rights. And this fork is not only "inspired by" Buzz: `NOTICE.md` recorded
   that `public/` and `src-tauri/icons/` were **copied from Block Buzz**. Shipping
   Block's app icon under Block's product name implies an endorsement that does
   not exist. That is the problem the rename solves.

`LICENSE` and `NOTICE.md` stay. Dropping attribution would be the actual legal
risk; the name is not.

## What was already true

This repository **had already been renamed once**. `NOTICE.md` calls upstream
"Block Buzz" and "old Buzz"; `package.json` is `buzz-foundation`; and there is a
whole compatibility layer — `src-tauri/src/sign_out/legacy_identifier.rs`,
`legacy_cli_shortcut.rs`, `src/features/identity/LegacyIdentityOffer.tsx` — that
reads the previous app's data rather than renaming it. That is the pattern this
rename follows.

## The rule that made it tractable

One distinction carries the whole job:

> **Capital `Buzz` is the product's name. Lowercase `buzz` is a path, a URL
> scheme, an env var, a CLI command, a wire header, or a crate.**

So `Buzz` → `loop` in shipped text, and lowercase `buzz` never changes. This is
why `~/.buzz`, `buzz://`, `BUZZ_*`, `xyz.block.buzz.desktop` and `buzz-*` need no
individual judgment.

## Layers, and why they get opposite answers

| Layer | Size | Decision |
|---|---|---|
| Text a person reads | 1,317 lines / 426 files | **Renamed** |
| State identifiers | `~/.buzz` 732, `BUZZ_*` 420, `buzz://` 582, `xyz.block.buzz.desktop` 97 | **Kept** |
| Upstream dependencies | 6 `buzz-*` crates, one by git rev | **Cannot change** |

Renaming layer 2 would break existing keys, the plugin registry, agent
workspaces, and every invite link already shared. A user losing their data is
worse than a legacy name surviving in a path. The repo's own
`legacy_identifier.rs` demonstrates the correct handling: read the old name,
do not change it.

### Two places the naive rule was wrong

**`"Buzz Relay"` is server data, not branding.** The relay reports that name
itself, and `src/features/communities/community-name.ts` compares against it to
decide whether a host is a nameless default. Renaming the comparison would have
silently changed which communities get a display name. It is protected.

**Words that name the real Buzz app must keep saying Buzz.** `Buzz (Legacy)`,
`old Buzz`, `another Buzz` — these appear in the import UI, where they refer to
the Block app the user also has. Writing "loop (Legacy)" would name software that
never existed and point the import at nothing.

## The wordmark: text, not new artwork

The onboarding screen drew `buzz-wordmark.png` — a **332 KB PNG of the word
"Buzz"** — and ran a WebGL shader over it. Re-making that artwork was the only
thing standing between this rename and completion, so the decision was to drop
the artwork entirely:

- `OnboardingWordmark.tsx` is now `loop` set as text: no image, no canvas, no
  shader, no 332 KB on first paint, sharp at every scale.
- `wordmark.frag` (the shader) is deleted.
- `public/buzz-wordmark.png` is deleted.
- `public/buzz-mark.svg` and `public/buzz-loading-mark.svg` were Block artwork
  too; both are now the word in text. The loading mark keeps its **1760 ms**
  animation cycle, because `src/app/launch.ts` reads its timing from that file.
- App icons are generated: a white `l` on a rounded dark square. The old ones
  were copied from Block.

File names like `buzz-mark.svg` are kept: they are referenced from `index.html`,
`App.tsx`, `ThreadPanel.tsx` and a test, and the name is not visible to anyone.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck` | passes |
| `cargo check --all-targets` | passes, 4m18s |
| `src/features/identity/identity.test.tsx` | **230 / 230** |
| Visible brand text still saying Buzz | 0 (a rescan for `alt`, `aria-label`, `title`, `placeholder`, JSX text, and quoted strings found 9 hits, all inside comments) |

The rescan mattered: the renamer protects whole lines, so `alt="Buzz"` on the
same line as `src="/buzz-loading-mark.svg"` was skipped twice. That is a real
failure mode of line-level protection, and it is why the check is by *shape of
visible text* rather than by file.

## What a reviewer should look at

1. `src-tauri/tauri.conf.json`, `tauri.{linux,macos,windows}.conf.json` —
   `productName` and window titles are now `loop`. This changes the installer
   name and the window title.
2. `src/features/agent-harness/base_prompt.md` — line 1 tells an agent it is
   "operating inside loop". This is what an agent will say about itself.
3. The `NOTICE.md` trademark section — the claim that this project is not
   affiliated with Block, and the list of deliberately-kept identifiers.
4. Anything in `src/bundled/*/README.md` — these are read *inside the app* in the
   plugin browser, so they are product surface, not repository docs.

## What this does not do

- **`~/.buzz` is not moved to `~/.loop`.** That needs migration code and buys
  nothing today; the path is invisible to users.
- **The bundle identifier stays `xyz.block.buzz.desktop`.** Changing it relocates
  secure storage, so every existing key would look missing. The repo already has
  the tool to handle this (`legacy_identifier.rs`) if it is ever wanted.
- **`buzz://` links keep working.** Changing the scheme breaks every invite
  already sent, and other people's links are not ours to break.
