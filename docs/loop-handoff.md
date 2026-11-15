# Where loop stands — handoff, 2026-11-16

Written so another machine can pick this up with no session memory. Everything
below is committed and pushed; nothing depends on an uncommitted file or a
running process.

Two repositories:

| Repo | What it is | Push remote |
|---|---|---|
| `rmngl/loop` (this one) | plans, design docs, the `loop.skills` plugin | `origin` |
| `rmngl/loop-app` (**private**) | the Buzz fork: rename, no-account, local backend | `origin-private` in the working clone |

The fork is private on purpose: it is Buzz-derived and the rename is a
trademark matter, not a licence one. `LICENSE` and `NOTICE.md` stay.

---

## 1. What works right now

`loop` opens on a fresh machine with **no account and no community address**:

- no language screen, no welcome/account screen, no community-address screen;
- the community names itself `내 워크스페이스` from NIP-11;
- one channel named `일반` is seeded on first run, with the viewer on its roster
  so the composer accepts a message;
- messages are stored in SQLite, page back through history, and arrive live on
  an open socket without a reload;
- an agent added to the channel reads it and publishes into it.

That is M0–M2 of the design minus media. Nothing here needs Docker, Postgres,
Redis, S3, TLS, or a second process.

## 2. The one architectural fact to keep

**The relay is a signing participant, not a store.** The client checks
`pubkey === relayAuthor` on seven kinds and either throws or silently hides UI
when the check fails — no error ever reaches a log. `13534` missing means the
owner/admin menus simply vanish. `39006` missing means the channel loads
forever. So the local backend signs its own channel state with the community
key; that key lives in `state` as `relay.key` and survives restarts.

## 3. Where the code is

Fork, branch `local-backend`, 13 commits on top of `a58af0c6`:

```
f45dd2bd  fix: key the fan-out sink by owner, not one global slot
4d9316cc  feat: membership commands, agent read and publish        (Task 11)
ef7cb992  feat: deliver writes to every open subscription           (Task 10)
66b5510a  feat: nip-cw window pages with signed bounds              (Task 9)
24519fe1  feat: seed channel with the viewer on its roster          (Task 8)
c70345f6  feat: relay-signed channel metadata and rosters           (Task 7)
2b02aebb  feat: native socket, nip-42 auth, eose                    (Task 6)
face6e10  feat: /events with a relay receipt                        (Task 5)
2bfb45a6  feat: filters, keyset paging, /query                      (Task 4)
ddf54530  feat: event storage, replacement, tag index               (Task 3)
b1862afb  feat: first-run key and community seed                    (Task 2)
b4651421  test: drain the request body before refusing              (pre-existing fix)
9170edd6  feat: module, sqlite store, nip-11 contract               (Task 1)
```

New module `src-tauri/src/local_backend/` (~1,800 lines, ~1,460 of them tests):

| File | Lines | What |
|---|---|---|
| `mod.rs` | 480 | `LocalBackend`, `Reply`, `Subscriptions` fan-out, `agent_query`/`agent_publish` |
| `store.rs` | 341 | SQLite: `state`, `events`, `event_tags`, `seen_kinds` |
| `event.rs` | 271 | the only signer, plus the five relay-authored constructors |
| `session.rs` | 153 | one socket's protocol: greeting, NIP-42, REQ replay, EOSE, CLOSE |
| `filter.rs` | 141 | NIP-01 filters, keyset paging |
| `window.rs` | 129 | NIP-CW pages and their signed 39006 bound |
| `roster.rs` | 160 | 9000/9001/9021/9022 applied to the 39002 + a 40099 notice |
| `seed.rs` | 123 | the first channel |
| `nip11.rs` | 13 | the feature switch |
| `tests.rs` | 1,459 | 63 tests |

Seams outside the module — nine, not the seven the design doc first counted:

1. `relay::send()` — HTTP, before `evidence()`
2. `relay::relay_info()` — `GET /` (bypasses `send`)
3. `federated_identity::socket::relay_socket_connect` — returns `Native` **and** registers
4. `identity::IdentityHost::create_if_missing` — first-run key
5. `app_agents::app_agent_query` / `app_agent_publish` — the agent's own reads and writes
6. `federated_identity::assertion::discovery` — **found by launching, not in the design**
7. `media_blocks::read` / `relay::fetch_media_bounded` — deferred to M3
8. `relay::upload_file_authorized` — deferred to M3
9. `relay::channel_creation_supported` — via seam 2

## 4. Test state

| Suite | Result |
|---|---|
| `cargo test --lib local_backend` | **63 passed** |
| `cargo test --lib federated_identity` | **159 passed** |
| `cargo test --lib relay::tests` | **105 passed**, 1 ignored |

`cargo test` is not sufficient: a `Subscriptions: Clone` error passed tests and
failed `--release`. Run `cargo check --release --all-targets` before believing a
build.

## 5. What is not done

**Task 12 — acceptance + `docs/loop-local-backend.md`.** This is the next work
item and the only one in the plan.

**Tasks 9, 10, 11 have never been seen in the running app.** They have unit
coverage; the last launch check ran a build that predated all three. The build
started at 00:05 on 2026-11-16 is the first containing them. Until a screenshot
shows a message surviving a reload and an agent replying, treat those three as
unverified:

1. launch with a fresh `%APPDATA%\xyz.block.buzz.desktop`
2. the sidebar shows `일반`
3. post a message → it appears without a reload
4. restart → the message is still there
5. add an agent, ask it something → it replies in the channel

**OS-visible name is still Buzz.** `Buzz.exe`, `Buzz Foundation` in file
properties, install folder `%LOCALAPPDATA%\Buzz Foundation`. Cause:
`productName` in `tauri.windows.conf.json` and `tauri.linux.conf.json`
overrides `tauri.conf.json`. Fix needs `productName: "loop"`,
`mainBinaryName: "loop"`, and the 8 files / 18 lines that hardcode `Buzz.exe` /
`Buzz.app`, changed together. It installs in parallel, not as an upgrade.

**Media (M3)** — upload, ranged and unranged fetch. The plan deliberately
deferred it: M2's deliverable is a text answer and unobservable work cannot be
verified. It is also the only place a fake response can be constructed
(`tauri::http::Response<Vec<u8>>`), because `reqwest::Response` has no public
constructor.

**`loop.skills` Task 10 acceptance** — 2 runs without a skill, draft, approve, 2
runs with. The plugin is built and verified in a real host; the measurement that
says whether a skill pays for itself is not run.

**Publishing the fork is done but private.** `rmngl/loop-app` exists because
`origin` pointed at `block/buzz-app` and there was no pushable remote. The clone
had been **shallow**, which made the first push fail with
`did not receive expected object`; `git fetch --unshallow` fixed it. If you
clone fresh, clone full or expect the same error.

## 6. Traps that cost time here

- **`pnpm run tauri build --no-bundle`, never plain `cargo build`.** Plain cargo
  loads `devUrl` and the window shows `ERR_CONNECTION_REFUSED`. Bare
  `pnpm tauri` silently falls through to `install`.
- **A detached build does not inherit the interactive PATH.** `pnpm` and `cmake`
  must be added explicitly — see `.scratch-build-seed.ps1` in the fork (cmake path
  in `C:/workspaces/loop/.scratch-cmake-path.txt`).
- **Build cost**: ~4 min compile + ~4 min LTO link. Poll the log; do not sleep
  for a fixed time and assume.
- **Windows + PowerShell quoting** destroys JSON raw strings
  (`r#"…"#` terminates at `"#h"`; use `r##"…"##`). `Select-String` has no
  `-Recurse`. Write `.mjs`/`.ps1` files instead of heredocs.
- **A test that fails only on Windows is a real defect.** Prove it pre-existing
  by stashing and re-running at the base commit before dismissing it — that is
  how `b4651421` was found (an unread request body reset the connection, so a
  refusal read as `network-unavailable`).
- **Line-level brand protection hides copy on any line that also holds a data
  token.** That is how `alt="Buzz"` beside `src="/buzz-loading-mark.svg"` survived
  two passes.

## 7. The seed, exactly

`BUZZ_DEFAULT_COMMUNITY_URL=https://loop.localhost` at build time. It is read
only for `command === "build"` in `vite.config.ts:136-142`, becomes
`VITE_BUZZ_OPEN_RELAY`, and `services.ts` passes it to `createCommunities` —
the only seed path. `scripts/local-backend-env.mjs` prints the right value for
either mode.

`.localhost` is reserved by RFC 6761, so a missed seam fails at `127.0.0.1`
instead of leaking to the internet. That is why it is not `localhost:port`.

## 8. Where to read more

- `docs/superpowers/specs/2026-11-15-loop-local-backend-design.md` — the design
  (rev 2). Its seam table is now known to be one short: see seam 6 above.
- `docs/superpowers/plans/2026-11-15-loop-local-backend.md` — the 12 tasks.
  Where its code samples disagree with the crate, the crate wins; the plan was
  wrong about three nostr-0.45.5 APIs and one arithmetic claim.
- `docs/buzz-rename.md` — what the rename touched and every bug it caused.
- `docs/buzz-without-an-account.md` — the account patch, plus `.patch`.
- The execution ledger — per-task commits, test counts and every defect found
  while executing, kept outside git at
  `.superpowers/sdd/2026-11-15-loop-local-backend/progress.md`.
