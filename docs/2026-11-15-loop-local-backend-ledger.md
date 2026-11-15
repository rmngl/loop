# SDD ledger — plan: docs/superpowers/plans/2026-11-15-loop-local-backend.md

Executor: inline (human partner chose direct implementation).
Working tree: `C:/workspaces/_scratch-buzz-app`, branch `local-backend`, BASE `a58af0c6`.
The plan and this ledger live in `C:/workspaces/loop`; every commit named below is in the fork.

Pre-flight: 12 tasks, shared interfaces are the module's own types. Rows below.

| # | Producer → Consumer | Produced | Consumed | Finding |
|---|---|---|---|---|
| 1 | T1 `Reply`/`http` → T4, T5 | `Reply {status, headers, body}`, `LocalBackend::http(viewer, path, method, body)` | same | ok |
| 2 | T3 `event::sign` → T5, T6, T7, T8, T9, T11 | `sign(&Keys, kind, created_at, tags, content) -> Result<Event, String>` | same | ok |
| 3 | T5 `viewer_keys`/`signed_message` → T6, T8, T9, T11 | test helpers in `tests.rs` | same | ok; `signed_message` takes `created_at` |
| 4 | T6 `Sockets::register/start/send/unregister` → T10 | registry + frame receiver | fan-out target | ok; `Subscriptions` mirrors REQ/CLOSE |
| 5 | T7 constructors → T8 seed | 39000/39001/39002/13534/40099 | seed writes | ok |
| 6 | T9 `window::answer` → T12 | rows + one 39006 | contract parity | ok |
| 7 | T4 `Filter` → T6 session, T10 dispatch | `Filter::matches`, `filter::parse` | replay + fan-out | ok |

Ruling: workspace resolves under `C:/workspaces/loop` because that is where the plan
lives; the code is in the fork. The ledger records fork commits explicitly, so the
split cannot be mistaken for a lost task.

Task 1: complete (commits a58af0c6..9170edd6, tests: cargo test --lib local_backend -> 3 passed; cargo test --lib relay::tests -> 105 passed)

Task 2: complete (commits 9170edd6..b1862afb; plus a pre-existing-fixture fix b4651421).
  - identity.rs create_if_missing: Ok(None) when a key exists; restore()'s error is not treated as absence.
  - tests: first_run_never_replaces_a_saved_key, first_run_creates_a_key_only_when_the_store_is_readable_and_empty.
    The plan's `fixture_without_key(true)` uses OsStore, which has no platform impl under test; the in-memory
    `missing_fixture()` is the readable-empty case, so the test uses it.
  - lib.rs setup: key creation gated on local_backend::current(), mirrors identity_create's backup call, non-fatal.
  - scripts/local-backend-env.mjs prints BUZZ_DEFAULT_COMMUNITY_URL (build) or BUZZ_RELAY_URL+BUZZ_DEV_OPEN_RELAY (dev).
  - Test run: cargo test --lib identity:: -> 192 passed, 0 failed. cargo check --all-targets clean.
  - NOT claimed: the two screens are gone. Only Task 6's launch check observes that.
Pre-existing defect found and fixed (b4651421): federated_identity::assertion::tests::refusing_issuer closed the
  socket without draining the request body; on Windows that resets the connection, so two tests failed with
  network-unavailable instead of the fixture's refusal. Fails identically at 9170edd6 (stashed-and-rerun proof),
  so it is not caused by this task. After the drain fix, cargo test --lib federated_identity::assertion -> 28 passed.

Task 3: complete (commit ddf54530). event.rs sign/addressable/replaceable/d_tag; store schema v2 (ordered step
  migration from v1), insert/count/tag_rows/get_kind/get_latest/seen_kinds. cargo test --lib local_backend -> 8 passed.
  Plan defect found: the tag test asserted 4 tag rows for a 3-tag event. Now asserts the exact rows and also that a
  multi-letter tag name is not indexed.
  Plan defect found: `Tag::from(Vec<String>)` does not exist in nostr 0.45.5; `Tag::parse` is the checked constructor.
  Plan defect found: `nostr::event::Timestamp` is private; it is `nostr::types::Timestamp`, and `finalize` needs
  `FinalizeEvent` in scope.

Task 4: complete (commit 2bfb45a6). filter.rs (parse/matches), Store::query, POST /query, LocalBackend::write.
  cargo test --lib local_backend -> 13 passed; cargo test --lib relay::tests -> 105 passed, 1 ignored.
  DELIBERATE DEVIATION from the plan: Filter::matches ignores `before_id`. The plan lists it as non-matching but the
  draft implementation applied it; the socket fan-out uses `matches`, and applying a page cursor to live delivery
  would silently drop a newly arrived message. Test `a_cursor_shapes_the_query_but_never_hides_a_live_message` pins it.
  Note: `seen_kinds` records requested kinds with first_seen=0, so M3's measurement distinguishes asked-about from written.

Task 5: complete (commit face6e10). publish/ receipt, /events, /api/join-policy, 404 fallback.
  cargo test --lib local_backend -> 19 passed.
  Verified the Task 1 seam forwards `url.path()`, `method` and `body` to LocalBackend::http (relay.rs:1062-1069), so
  these tests exercise the real seam rather than a parallel call.
  Added a fifth test beyond the plan: a duplicate publish is accepted again (the client re-sends after an ambiguous
  transport failure and must be able to confirm).
  Plan carried a `backend_fixture()` that returned only a backend; it returns (TempDir, LocalBackend) so the directory
  outlives the connection.

Task 6: complete (commit 2b02aebb). session.rs (NIP-42 + REQ/EOSE + CLOSE), Subscriptions fan-out registry,
  Sockets::register/start/send/unregister extracted from the command bodies, local_connect returns Native and registers
  before returning, subscription mirroring on every frame.
  cargo test --lib local_backend -> 29 passed; federated_identity::socket -> 8 passed; ::assertion -> 28 passed.
  Release profile compiles (cargo check --release --all-targets) - the test profile had hidden two errors:
    - `Subscriptions` was not Clone because it held a bare Mutex; it now holds an Arc<Mutex<..>> with `handle()`.
    - `#[allow(dead_code)]` on the module masked nothing here, but the release build was the first to type-check the
      spawned task's ownership, which needed `Sockets(sockets.0.clone())` rather than a borrow.
  `rand` is not a dependency; the challenge uses the existing `getrandom 0.3`. `new_challenge` returns Option and the
  caller refuses the connection rather than signing with an all-zero challenge.

  EIGHTH SEAM FOUND BY LAUNCHING (not in the plan or the design's seven): `federated_identity::discovery` builds its own
  `https://<relay>/info` request and never reaches `send()`. The first launch showed "Federated community discovery
  failed". It now answers `Ok(false)` for a local origin before constructing a request. Task 1's note that "/info is
  never requested once seam 1 sits before evidence()" was true only for `evidence()`; discovery is separate.

  Launch check (fresh profile, BUZZ_DEFAULT_COMMUNITY_URL=https://loop.localhost): PASS on the five observable items -
  no language screen, no welcome/account screen, no community/relay-address screen, shell renders, community named
  내 워크스페이스. The webview connects and its /query traffic reaches SQLite (seen_kinds records 0,10100,13534,20001,
  24200,30030,30078,30177,30300,30315,44100,44101 - a CLOSED-before-auth REQ would record none).
  NOT yet true: "the shell appears with an empty channel list". There is no channel, so the opened page shows App.tsx's
  unavailable state. Task 8 creates the channel; until then this item cannot pass.
  Also fixed: NOT_A_COMMUNITY_ERROR still said "Buzz community ... wss://communities.buzz.xyz" - a rename survivor the
  launch surfaced. It now names loop and wss://loop.localhost.

Task 7: complete (commit c70345f6). Five relay-authored constructors in event.rs: metadata (39000),
  admins (39001), roster (39002), community_roster (13534), notice (40099). Every constructors refuses the
  input the client's parser throws on or silently hides UI for, because both outcomes are invisible from
  the relay's side:
    - 39000: exactly one bare `public`/`private`; a second flag makes channelVisibility answer undefined
      and channel settings refuse to open. The type goes in the FIRST `t` (channelIdentity reads it there;
      later `t` tags are labels). name/about always present. Body repeats name/about so a reader of
      content.name and a reader of the tag cannot disagree.
    - 39001: exactly [p, pubkey, role] with role owner|admin, no duplicate. lifecycleSettings throws on any
      other shape and that throw takes archive/delete/settings with it.
    - 39002: NIP-29 [p, pubkey, "", role] - the empty third slot is the relay hint, which puts the role
      fourth, where discovery.rs reads it. The viewer MUST be on it: canAccess opens from public metadata but
      canParticipate requires hasTag(roster,"p",viewer), so a missing entry is a visible, unwritable channel.
    - 13534: [member, pubkey, role] with no `d`, so it is replaceable. Without it readRoster answers null,
      the role is undefined, and every owner/admin action vanishes with no error.
    - 40099: exactly one `h`; member_left omits `target` (the client rejects a departure whose target
      differs from its actor, so naming one reads as a forgery).
  Channel ids are checked against the client's own lowercase-UUID rule at the constructor.
  cargo test --lib local_backend -> 37 passed.

Task 8: complete (commit 24519fe1). seed.rs creates one writable channel on first run. Writability is TWO
  facts: a bare `public` tag on the 39000 (canAccess) AND the viewer's own `p` in the 39002
  (canParticipate). Getting only the first right produces a channel that lists, opens, and refuses every
  message - which reads as a broken composer, not a permissions problem. ensure_seed is idempotent twice
  over: seed.channel records the id, and a changed key is appended to the roster plus a member_joined
  notice instead of a second channel. created_at for a rewrite is max(now, previous+1) or NIP-01
  replacement discards it. Called from lib.rs inside the first-run task, before the frontend's first
  discovery pass.
  cargo test --lib local_backend -> 41 passed.

Task 9: complete (commit 66b5510a). window.rs answers a NIP-CW window with exactly one relay-signed 39006:
  `d` = <channel>:head or <channel>:<until>:<before_id>, body {has_more, next_cursor} with has_more equal
  to next_cursor !== null. Zero bounds, two, a contradiction, or a non-advancing cursor all throw, and a
  throw here is a channel that spins forever with nothing on screen - which is exactly what the launch
  showed before this landed ("This page isn't available" on every discovered channel). The page asks the
  store for one row more than it serves; the extra is dropped so the cursor never points past a row the
  client never displayed. Only `top_level` marks a window: a 39006 in a discovery/notice/profile read is
  parsed as a row.
  cargo test --lib local_backend -> 47 passed; relay::tests -> 105 passed, 1 ignored.

Task 10: complete (commit ef7cb992 + f45dd2bd). Delivery is wired at the single write door, so a future
  write path cannot forget it: write() stores then fans out, record() is the relay's own door for state it
  signs (seed channel, roster, notices). The outbound channel is deliberately NOT Sockets::send - those
  queues carry frames FROM the client into the session's incoming, so a live event pushed there would be
  read back as client input. OUTBOUND holds the same renderer Channel the session answers its replay on.
  Window bounds are stored but not delivered (a bound answers one request; a live sub would count it as a
  row).
  DEFECT FOUND BY RUNNING THE TESTS: the sink was one global slot, so a second registration replaced the
  first. Production has exactly one transport and never noticed; two tests in one binary did, and the loser
  observed a fan-out that "worked" and delivered nothing. Now keyed by owner, and the sink answers
  Option<bool> - Some(true) took it, Some(false) owns the socket but the renderer is gone, None is not its
  socket - because closing on a plain false would let one transport close another's live socket.
  cargo test --lib local_backend -> 54 passed; federated_identity -> 159 passed.

Task 11: complete (commit 4d9316cc). roster.rs applies 9000/9001/9021/9022 by rewriting the 39002 and
  appending a 40099. Without it an agent added to a channel is a member of nothing: canParticipate reads
  the roster, not the command, and relay_http lets 9000 through unblocked. Four properties: authority is
  the roster as it stands (a stranger's command changes nothing AND stores nothing, because a stored
  command that did not apply reads back as a row); a command that would empty the channel is refused (an
  empty roster makes the channel unopenable and nothing in the client can rebuild one); a target already in
  the requested state is a success with no write (two devices adding the same agent both succeed); and
  created_at advances past the stored version.
  DELIBERATE: a channel command does NOT rewrite the 13534. It gates the owner/admin menus, and a channel
  member is not a community officer - growing it on every join would hand the officer list to anyone who
  joined a channel. (My first draft did sync it; a test caught the difference and the test was right.)
  Two agent seams: app_agent_query and app_agent_publish answer from this machine's store when the relay is
  local, because state.signer loads a key and evidence for a remote relay this community has no record of.
  cargo test --lib local_backend -> 63 passed.

REMAINING: Task 12 (acceptance + docs/loop-local-backend.md). Tasks 9-11 have unit coverage but have NOT
  been verified in the built app yet - the last launch check ran a build that predated them. The build
  started at 00:05 is the first one containing all of 9/10/11.
