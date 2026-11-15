# loop Local Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** loop opens straight into a channel with no community screen and no identity screen, keeping everything in one SQLite file on this PC, while the client code stays identical to a real-relay build.

**Architecture:** One new Rust module in the Tauri host. It answers the relay contract from SQLite at the seams the host already has. No socket is opened, no port is bound, no process is spawned: the HTTP seam returns the same `RelayResponse` its caller already builds, and the websocket seam feeds the same `Channel<SocketEvent>` the real socket feeds.

**Tech Stack:** Rust, existing crates only (`rusqlite 0.40`, `nostr 0.45.5`, `secp256k1`, `sha2`, `uuid`, `serde_json`, `tokio`), SQLite, Tauri 2.12.4 commands.

**Spec:** `docs/superpowers/specs/2026-11-15-loop-local-backend-design.md` (rev 2)

## Scope

Covers the spec's **M0, M0b, M1, M2** — the line the spec calls "loop가 된다". Working directory is `C:/workspaces/_scratch-buzz-app` unless a step says otherwise.

**Two deviations from the spec, both deliberate:**

1. **Media seams 3a/3b are not in this plan.** They move to the M3 plan. M2's deliverable is a text answer from an agent, and no step in this plan fetches an image blob. Building media before anything consumes it is work whose correctness cannot be observed.
2. **Seams are intercepted inside `send()` and `relay_info()`, not at each command.** Same insertion points the spec names. They are reached through a process-global `OnceLock`, because the seam functions take no `AppHandle` and adding one to each would change every caller. `socket.rs` and `relay.rs` already keep process globals this way (`refusals()`, `client()`).

M3 (reactions, edits, threads, upload, media) and M4 (channel creation) get their own plan: M2's `seen_kinds` measurement is the input that decides M3's scope.

## Global Constraints

From the spec. Every task's requirements include these.

- **Local origin is exactly `https://loop.localhost`** (and its `wss:` sibling). `.localhost` is reserved by RFC 6761, so a missed seam fails instantly at 127.0.0.1 rather than leaking to the internet.
- **No new crate, no `hyper`, no listening socket, no new process, no Docker, no Postgres, no Redis, no S3, no TLS certificate.**
- **The frontend is not edited.** The community seed arrives through the existing build variable `BUZZ_DEFAULT_COMMUNITY_URL` (`vite.config.ts:136-142` → `VITE_BUZZ_OPEN_RELAY` → `services.ts:124`). Never add a runtime seed path.
- **DB path:** `app_data_dir()/local-backend/loop.sqlite3`, or `local-backend-debug/` in a debug build — the rule `archive/mod.rs:52-61` uses.
- **Relay key:** 32 bytes, created once, stored in `state`, never rotated. A rotated key silently invalidates every channel, because the client checks `pubkey === relayAuthor`.
- **NIP-11 in v0** carries `name` and `self` only. No `supported_nips: [29]`, no `supported_extensions`, no `artifacts`, no `federated_identity`, no `read_state_snapshot`, no `admin_api`, no `public_profile`, no `limitation`. Adding any one of them turns a feature on.
- **Receipt shape:** `{"accepted":true,"event_id":"<id>","message":"<string>"}`. `message` must be a **string**; omit it and the client throws `Relay returned an invalid delivery receipt` (`transport.ts:1697-1710`).
- **Channel ids are lowercase UUIDs** (`channel_writes.rs:5-11`).
- **Seed channel name is `일반`**; community display name is `내 워크스페이스`, served as NIP-11 `name`.
- **Every path under the local origin that is not implemented answers `404` with a JSON body.** Nothing under that origin may reach `reqwest`.
- **`LICENSE` and `NOTICE.md` stay.** The product name is `loop`.
- **One commit per task**, message `feat(local-backend): …`.
- **`cargo test --lib` in this crate takes minutes** and `cargo check --all-targets` longer. Run them detached and poll the terminal file; a 30 s tool timeout is not a failure.

## Review Focus

The spec's silence on these is not permission for them to break the program. Each line names the condition, the behaviour a reasonable person expects, and the task whose tests pin it.

1. **A message posted while the socket is open must appear without a reload.** Publish and delivery are different code paths here; a fan-out that misses looks perfect in every test that only reloads. → Task 10.
2. **Two sockets open at once** (a reload racing its predecessor, or a second window) must both receive a new event. A fan-out keyed on one global subscriber silently starves the second. → Task 10.
3. **A page request at the end of history** must answer `has_more:false` with `next_cursor:null`. Answering `has_more:true` with no cursor makes the channel page forever and never finish loading. → Task 9.
4. **Two messages in the same second** must be neither skipped nor repeated by the composite cursor. Timestamps are second-granular, so any real burst hits this. → Task 4, Task 9.
5. **A window request naming channel A must never return a row from channel B.** The `#h` predicate that prevents it is one forgotten `WHERE` away, and the result is a cross-channel leak, not a visible error. → Task 4.

---

## File Structure

```
src-tauri/src/local_backend/
  mod.rs      LocalBackend, install, ensure_seed, current, is_local, http
  nip11.rs    the NIP-11 document
  store.rs    SQLite open, schema, insert, replacement, query
  event.rs    event::Event, signing, and every relay-authored constructor
  filter.rs   ReadFilter parse, matches, SQL translation
  seed.rs     the first-run channel and its roster
  window.rs   NIP-CW page assembly and its kind 39006 bound
  session.rs  one socket's frame protocol, with no tauri types
  tests.rs    every unit test in this plan
```

`mod.rs` is the only file other modules call. `store.rs` never builds relay-authored content; `event.rs` never touches SQL; `session.rs` never touches tauri, which is what makes it testable.

**One file, one signing function.** `event::sign` is introduced in Task 3 because tasks 5, 6, 7, 8, 9 and 11 all sign something, and a per-task signing helper would drift. The relay-authored constructors (39000, 39001, 39002, 13534, 40099) are added in Task 7, all built on that one function.

**Files outside the module, each touched once:**

| File | Why |
|---|---|
| `src-tauri/src/lib.rs` | `mod local_backend;`, installation in `setup` |
| `src-tauri/src/relay.rs` | seam in `send()` and `relay_info()`, `impl From<local_backend::Reply> for RelayResponse` |
| `src-tauri/src/federated_identity/socket.rs` | seam in `relay_socket_connect`, `Sockets::register` |
| `src-tauri/src/identity.rs` | `IdentityHost::create_if_missing` |
| `src-tauri/src/app_agents.rs` | seams in `app_agent_query`, `app_agent_publish` |

---

## Task 1: The module, its database, and the NIP-11 contract

**Files:**
- Create: `src-tauri/src/local_backend/mod.rs`
- Create: `src-tauri/src/local_backend/nip11.rs`
- Create: `src-tauri/src/local_backend/store.rs`
- Create: `src-tauri/src/local_backend/tests.rs`
- Modify: `src-tauri/src/lib.rs` (module list near line 71, `setup` before `relay::set_user_agent` at line 1017)
- Modify: `src-tauri/src/relay.rs` (`send()` at :1030, `relay_info()` at :836, `RelayResponse` at :747)

**Interfaces:**
- Produces: `local_backend::ORIGIN: &str = "https://loop.localhost"`.
- Produces: `local_backend::is_local(community: &str) -> bool` — true for `https:`/`wss:` on host `loop.localhost` with no port, path, query, credentials or fragment.
- Produces: `local_backend::open(path: PathBuf) -> Result<LocalBackend, String>`.
- Produces: `local_backend::install(app: &tauri::AppHandle) -> Result<(), String>` — resolves the app-data path, calls `open`, stores the instance in a module `OnceLock`, and prints (never fails on) a duplicate install.
- Produces: `local_backend::current() -> Option<&'static LocalBackend>`.
- Produces: `local_backend::Reply { pub status: u16, pub headers: BTreeMap<String, String>, pub body: String }` — the local answer's own type, so tests can read it. `relay.rs` wraps it into its private `RelayResponse`; that struct's fields stay private.
- Produces: `LocalBackend::http(&self, viewer: &str, path: &str, method: &str, body: Option<&str>) -> Result<Reply, String>`.
- Produces: `nip11::document(self_hex: &str) -> serde_json::Value`.
- Produces: `store::Store::open(path: PathBuf) -> Result<Store, String>`, `Store::state(&self, key) -> Result<Option<String>, String>`, `Store::set_state(&self, key, value) -> Result<(), String>`.
- Produces: `LocalBackend::store(&self) -> &Store`, `LocalBackend::relay_pubkey(&self) -> String`, `LocalBackend::relay_keys(&self) -> &nostr::Keys`.

- [ ] **Step 1: Write the failing origin test**

```rust
// src-tauri/src/local_backend/tests.rs
use super::*;

#[test]
fn only_the_local_origin_is_ours() {
    for yes in [
        "https://loop.localhost",
        "https://loop.localhost/",
        "wss://loop.localhost",
    ] {
        assert!(is_local(yes), "{yes}");
    }
    for no in [
        "https://loop.localhost.example.com",
        "https://localhost",
        "http://loop.localhost",
        "https://loop.localhost:8443",
        "https://loop.localhost/path",
        "https://user:pass@loop.localhost",
        "https://other.localhost",
    ] {
        assert!(!is_local(no), "{no}");
    }
}

#[test]
fn the_nip11_document_advertises_only_what_v0_serves() {
    let doc = nip11::document(&"a".repeat(64));
    assert_eq!(doc["self"].as_str().map(str::len), Some(64));
    assert_eq!(doc["name"], "내 워크스페이스");
    for absent in [
        "supported_nips",
        "supported_extensions",
        "artifacts",
        "federated_identity",
        "read_state_snapshot",
        "admin_api",
        "public_profile",
        "limitation",
    ] {
        assert!(doc.get(absent).is_none(), "{absent} must stay absent");
    }
}

#[test]
fn the_relay_key_survives_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("loop.sqlite3");
    let first = open(path.clone()).unwrap();
    let viewer = first.relay_pubkey();
    drop(first);
    let second = open(path).unwrap();
    assert_eq!(second.relay_pubkey(), viewer);
    assert_eq!(viewer.len(), 64);
}
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: compile error — `is_local`, `nip11`, `open` do not exist.

- [ ] **Step 3: Write `nip11.rs`**

`document` returns exactly two keys. `name` is the literal `내 워크스페이스`. Write it as a `serde_json::json!` object; do not add `description`, `pubkey`, `contact`, or `software`, none of which the client reads.

- [ ] **Step 4: Write `store.rs` — schema and state only**

```sql
PRAGMA user_version = 1;
CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

`Store::open`: create the parent directory, `Connection::open`, `busy_timeout(2s)`, then `PRAGMA journal_mode=WAL`, `PRAGMA secure_delete=ON`, `PRAGMA user_version` check (a version above 1 is an error), and the schema batch if 0. Hold the connection in `Mutex<Connection>`; take the lock with `unwrap_or_else(PoisonError::into_inner)`, as `Sockets` does.

`LocalBackend::open` then reads `relay_key` from `state`; when absent it generates 32 bytes from `getrandom`, hex-encodes them for storage, and writes them once. Expose `relay_pubkey(&self) -> String` and the parsed `nostr::Keys` behind a crate-visible accessor.

- [ ] **Step 5: Write `mod.rs` — origin, install, http skeleton**

`is_local` parses with `url::Url` and compares scheme (`https` or `wss`), `host_str() == Some("loop.localhost")`, `port().is_none()`, empty username and password, path `/`, no query, no fragment. Do not string-match; `https://loop.localhost.example.com` must fail.

`http()` in this task answers `GET /` and `GET /info` with the NIP-11 body, and everything else with status 404 and body `{"error":"not found"}`. Set `content-type: application/json` in `headers`.

- [ ] **Step 6: Insert the two seams**

In `relay.rs::send()`, before `evidence()`: resolve the viewer with `host.viewer().await?`, and when `local_backend::is_local(url.as_str())` and a backend is installed, return `RelayResponse { status, headers, body }` built from the local `Reply`.

In `relay.rs::relay_info()`, before `client()`: when `local_backend::is_local(community)`, parse the local `GET /` answer's body as JSON and return it.

Add a `impl From<local_backend::Reply> for RelayResponse`. Do not widen `RelayResponse`'s fields.

- [ ] **Step 7: Install in `setup`**

In `lib.rs`'s `setup` closure, before `relay::set_user_agent`: `if let Err(error) = local_backend::install(app.handle()) { eprintln!("Could not start the local backend: {error}") }`. A failure must leave the app usable against real relays, so it is never fatal.

- [ ] **Step 8: Run the tests, then the whole crate build**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: PASS — the three tests added in step 1.

Run: `cd src-tauri && cargo check --all-targets`
Expected: no errors. Run detached and poll.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/local_backend src-tauri/src/lib.rs src-tauri/src/relay.rs
git commit -m "feat(local-backend): module, sqlite store, nip-11 contract"
```

---

## Task 2: First run has no community screen and no identity screen

**Files:**
- Modify: `src-tauri/src/identity.rs` (add `create_if_missing` on `impl IdentityHost`, near `saved_viewer` at :867)
- Modify: `src-tauri/src/lib.rs` (`setup`, after `local_backend::install`)
- Create: `scripts/local-backend-env.mjs` (writes the two env vars for a build)

**Interfaces:**
- Consumes: `local_backend::current()`. This task does not create the channel; Task 8 does.
- Produces: `IdentityHost::create_if_missing(&self) -> Result<Option<String>, String>` — `Ok(None)` when a key is already saved, `Ok(Some(viewer))` when it created one.

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/identity.rs, in its existing #[cfg(test)] mod tests
#[tokio::test]
async fn first_run_never_replaces_a_saved_key() {
    let host = IdentityHost::fixture();
    let before = host.saved_viewer().await.unwrap();
    assert_eq!(host.create_if_missing().await.unwrap(), None);
    assert_eq!(host.saved_viewer().await.unwrap(), before);
}

#[tokio::test]
async fn first_run_creates_a_key_only_when_the_store_is_readable_and_empty() {
    // A readable store with no key: the one case that may generate.
    let host = IdentityHost::fixture_without_key(true);
    let created = host.create_if_missing().await.unwrap().expect("a key was created");
    assert_eq!(created.len(), 64);
    assert_eq!(host.saved_viewer().await.unwrap().as_deref(), Some(created.as_str()));
    // Closed is not empty: a signing-out host must never have a key minted over it.
    let closed = IdentityHost::fixture_without_key(false);
    assert!(closed.create_if_missing().await.is_err());
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd src-tauri && cargo test --lib first_run_never_replaces_a_saved_key`
Expected: compile error, no method `create_if_missing`.

- [ ] **Step 3: Implement `create_if_missing`**

Inside `with_identity`: call `identity.restore()?`; if it returned `Some`, return `Ok(None)`; otherwise `identity.save(None).map(Some)`. This never generates a key over an unreadable store, because `restore` reports that as an error, not as absence.

- [ ] **Step 4: Call it from `setup`, local backend only**

```rust
if local_backend::current().is_some() {
    let identity = app.state::<IdentityHost>().inner().clone();
    let backup = app.state::<NsecBackupHost>().inner().clone();
    tauri::async_runtime::spawn(async move {
        match identity.clone().create_if_missing().await {
            // Mirror `identity_create`: the existing backup prompt still reaches the user.
            Ok(Some(_)) => {
                let (backup, identity) = (backup.clone(), identity.clone());
                let _ = tauri::async_runtime::spawn_blocking(move || backup.local_key_installed(identity)).await;
            }
            Ok(None) => {}
            Err(error) => eprintln!("Could not create the first-run key: {error}"),
        }
    });
}
```

Never print or log the key. A failure here must not be fatal: the user still lands on the normal welcome screen and can make a key by hand.

- [ ] **Step 5: Add the build seed script**

`scripts/local-backend-env.mjs` prints the two settings a build needs, so nobody types them wrong:

```
BUZZ_DEFAULT_COMMUNITY_URL=https://loop.localhost
```

and, for a dev server, `BUZZ_RELAY_URL=https://loop.localhost` with `BUZZ_DEV_OPEN_RELAY=1`. The script takes `build` or `dev` as its only argument and prints shell-ready `$env:` lines on Windows and `export` lines elsewhere. Its "test" is the assertion in Step 6.

- [ ] **Step 6: Verify the seed path reaches the frontend**

Run: `node scripts/local-backend-env.mjs build`
Expected output contains `BUZZ_DEFAULT_COMMUNITY_URL=https://loop.localhost`.

Then confirm the chain still holds: `vite.config.ts:136-142` reads it only when `command === "build"`, and `vite.config.ts:228` turns it into `VITE_BUZZ_OPEN_RELAY`, which `services.ts:124` passes to `createCommunities`, whose `service.ts:320-327` branch seeds a membership when nothing is stored. Do not add a second seed path.

- [ ] **Step 7: Run the crate tests and commit**

Run: `cd src-tauri && cargo test --lib identity::`
Expected: passes, including the existing identity tests.

```bash
git add src-tauri/src/identity.rs src-tauri/src/lib.rs scripts/local-backend-env.mjs
git commit -m "feat(local-backend): first-run key and community seed"
```

**Do not claim the two screens are gone yet.** They are only observable once the socket is local (Task 6). The unit test above proves a saved key is never replaced; the writing branch is proven by Task 6's launch check.

---

## Task 3: Insert, replacement, signing, and the tag index

**Files:**
- Create: `src-tauri/src/local_backend/event.rs`
- Modify: `src-tauri/src/local_backend/store.rs`
- Modify: `src-tauri/src/local_backend/tests.rs`

**Interfaces:**
- Produces: `event::Event` — `{ id: String, pubkey: String, created_at: u64, kind: u16, tags: Vec<Vec<String>>, content: String, sig: String }`, `Serialize + Deserialize + Clone + PartialEq + Debug`.
- Produces: `event::sign(keys: &nostr::Keys, kind: u16, created_at: u64, tags: Vec<Vec<String>>, content: String) -> Result<Event, String>` — the only place this crate creates a signed event. Every later task uses it.
- Produces: `event::addressable(kind) -> bool` (30000..40000), `event::replaceable(kind) -> bool` (0, 3, 10000..20000), `event::d_tag(&self) -> Option<&str>`.
- Produces: `Store::insert(&self, event: &event::Event) -> Result<bool, String>` — `true` when this row is new, `false` when it duplicated or lost to an existing version.
- Produces: `Store::count(&self, kind: u16) -> Result<i64, String>`, `Store::tag_rows(&self, event_id: &str) -> Result<Vec<Vec<String>>, String>`.
- Produces: `Store::get_kind(&self, channel: &str, kind: u16) -> Result<Option<event::Event>, String>` — the current version of a `d`-addressed event.
- Produces: `Store::get_latest(&self, kind: u16) -> Result<Option<event::Event>, String>` — the newest of a kind with no `d`.
- Produces: `Store::seen_kinds(&self) -> Result<Vec<u16>, String>` — every kind written or queried, ascending.
Schema additions:

```sql
CREATE TABLE events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,
  pubkey     TEXT NOT NULL,
  kind       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  d_tag      TEXT,
  tags       TEXT NOT NULL,
  content    TEXT NOT NULL,
  sig        TEXT NOT NULL
);
CREATE INDEX events_kind_time ON events(kind, created_at DESC, id);
CREATE INDEX events_author    ON events(pubkey, kind, created_at DESC, id);
CREATE INDEX events_address   ON events(kind, pubkey, d_tag);

CREATE TABLE event_tags (
  seq   INTEGER NOT NULL,
  name  TEXT NOT NULL,
  value TEXT NOT NULL,
  pos   INTEGER NOT NULL,
  extra TEXT,
  PRIMARY KEY (seq, pos)
);
CREATE INDEX event_tags_lookup ON event_tags(name, value, seq);

CREATE TABLE seen_kinds (kind INTEGER PRIMARY KEY, first_seen INTEGER NOT NULL);
```

- [ ] **Step 1: Write the failing tests**

```rust
/// An unsigned-looking row: enough shape for storage tests, never verified.
fn bare(kind: u16, created_at: u64, id_seed: u8, tags: Vec<Vec<String>>) -> event::Event {
    event::Event {
        id: format!("{id_seed:02x}").repeat(32),
        pubkey: "ab".repeat(32),
        created_at,
        kind,
        tags,
        content: format!("content-{id_seed}"),
        sig: "00".repeat(64),
    }
}

#[test]
fn every_signed_event_verifies_and_round_trips_through_json() {
    let keys = nostr::Keys::generate();
    let signed = event::sign(
        &keys,
        9,
        1_700_000_000,
        vec![vec!["h".into(), "alpha".into()]],
        "hello".into(),
    )
    .unwrap();
    assert_eq!(signed.pubkey, keys.public_key().to_hex());
    assert_eq!(signed.id.len(), 64);
    assert_eq!(signed.sig.len(), 128);
    let parsed: nostr::event::Event =
        serde_json::from_value(serde_json::to_value(&signed).unwrap()).unwrap();
    parsed.verify().unwrap();
    // The client reads `tags` as arrays of arrays, never as objects.
    let as_json = serde_json::to_value(&signed).unwrap();
    assert_eq!(as_json["tags"][0][0], "h");
}

#[test]
fn a_duplicate_id_is_not_inserted_twice() {
    let dir = tempfile::tempdir().unwrap();
    let store = store::Store::open(dir.path().join("db.sqlite3")).unwrap();
    let one = bare(9, 100, 1, vec![vec!["h".into(), "chan".into()]]);
    assert!(store.insert(&one).unwrap());
    assert!(!store.insert(&one).unwrap());
    assert_eq!(store.count(9).unwrap(), 1);
}

#[test]
fn an_addressable_event_keeps_only_the_newest_version() {
    let dir = tempfile::tempdir().unwrap();
    let store = store::Store::open(dir.path().join("db.sqlite3")).unwrap();
    let d = vec![vec!["d".to_owned(), "chan".to_owned()]];
    assert!(store.insert(&bare(39000, 100, 1, d.clone())).unwrap());
    assert!(store.insert(&bare(39000, 200, 2, d.clone())).unwrap());
    assert_eq!(store.count(39000).unwrap(), 1, "one version survives");
    // An older version that arrives late is refused, not written over the newer one.
    assert!(!store.insert(&bare(39000, 150, 3, d.clone())).unwrap());
    assert_eq!(store.count(39000).unwrap(), 1);
}

#[test]
fn the_same_second_keeps_the_lowest_id() {
    let dir = tempfile::tempdir().unwrap();
    let store = store::Store::open(dir.path().join("db.sqlite3")).unwrap();
    let d = vec![vec!["d".to_owned(), "chan".to_owned()]];
    assert!(store.insert(&bare(39000, 100, 0x20, d.clone())).unwrap());
    assert!(store.insert(&bare(39000, 100, 0x10, d.clone())).unwrap());
    assert_eq!(store.count(39000).unwrap(), 1, "NIP-01 keeps the lowest id");
}

#[test]
fn every_single_letter_tag_is_indexed_not_just_the_first() {
    let dir = tempfile::tempdir().unwrap();
    let store = store::Store::open(dir.path().join("db.sqlite3")).unwrap();
    let mut roster = bare(39002, 100, 1, Vec::new());
    roster.tags = vec![
        vec!["d".into(), "chan".into()],
        vec!["p".into(), "aa".repeat(32)],
        vec!["p".into(), "bb".repeat(32), String::new(), "member".into()],
    ];
    store.insert(&roster).unwrap();
    assert_eq!(store.tag_rows(&roster.id).unwrap().len(), 4);
}
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: compile errors for `event::Event`, `event::sign`, `insert`, `count`, `tag_rows`.

- [ ] **Step 3: Write `event.rs`**

`sign` builds a `nostr::EventBuilder::new(Kind::Custom(kind), content).tags(tags.iter().map(Tag::parse…)).custom_created_at(Timestamp::from(created_at)).finalize(keys)`. Check the exact tag constructor against `nostr 0.45.5`: `Tag::from(vec![String])` accepts any string vector and is what `pairing/tests.rs` already uses. Convert the resulting `Event` to `Event` via `serde_json`.

`addressable` is `(30000..40000).contains(&kind)`, `replaceable` is `kind == 0 || kind == 3 || (10000..20000).contains(&kind)`. `d_tag` returns the first `d` tag whose length is exactly 2.

Never hand-build an `id` or a `sig`.

- [ ] **Step 4: Implement `insert`**

One `TRANSACTION IMMEDIATE`. In order: `INSERT OR IGNORE INTO events` — if it inserted nothing, roll back and return `Ok(false)`. Then, for an addressable kind, `SELECT seq, created_at, id FROM events WHERE kind=? AND pubkey=? AND d_tag IS ?`; if an existing row is newer by `(created_at, id reversed)` — NIP-01 keeps the greatest `created_at` and, on a tie, the **lowest** `id` — delete the old row and its tag rows, otherwise delete the row just written and return `Ok(false)`. `replaceable` does the same without `d_tag`. Finally insert one `event_tags` row per tag whose name is exactly one character, keeping the 4th element in `extra` when present, and `INSERT OR IGNORE INTO seen_kinds VALUES (kind, strftime('%s','now'))`.

`d_tag` is the first `d` tag's value, `NULL` when absent.

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: PASS — the five tests added in step 1.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/local_backend
git commit -m "feat(local-backend): event storage, replacement, tag index"
```

---

## Task 4: Filters, queries, and `/query`

**Files:**
- Create: `src-tauri/src/local_backend/filter.rs`
- Modify: `src-tauri/src/local_backend/store.rs` (add `query`)
- Modify: `src-tauri/src/local_backend/mod.rs` (`http` gains `POST /query`)
- Modify: `src-tauri/src/local_backend/tests.rs`

**Interfaces:**
- Produces: `filter::Filter { kinds: Vec<u16>, ids: Vec<String>, authors: Vec<String>, tags: Vec<(char, Vec<String>)>, limit: usize, since: Option<u64>, until: Option<u64>, before_id: Option<String>, top_level: bool }`.
- Produces: `filter::parse(body: &str) -> Result<Vec<Filter>, String>` — a JSON array of 1..=8 filters; unknown fields are ignored; `limit` is clamped to 500 and defaults to 500.
- Produces: `Filter::matches(&self, event: &event::Event) -> bool` — the in-memory twin of the SQL, used by the socket fan-out.
- Produces: `Store::query(&self, filters: &[Filter]) -> Result<Vec<event::Event>, String>` — one query per filter with its own `limit`, unioned by id, ordered `created_at DESC, id ASC`.
- Produces: `mod.rs::http` answering `POST /query`.

**Semantics that must be exact:**
- `since` is inclusive `created_at >= n`; `until` alone is inclusive `created_at <= n`.
- `before_id` **requires** `until` and means `created_at < until OR (created_at = until AND id > before_id)` — the composite keyset `window.ts:91-98` enforces.
- `top_level: true` excludes any event carrying an `e` tag whose 4th element is `"root"` or `"reply"`.
- Absent `kinds` means every kind. `ids`, `authors` and each tag list are ORs within themselves; the fields are ANDs against each other.

- [ ] **Step 1: Write the failing tests**

```rust
fn message(channel: &str, created_at: u64, id_seed: u8) -> event::Event {
    bare(9, created_at, id_seed, vec![
        vec!["h".into(), channel.into()],
        vec!["p".into(), "cc".repeat(32)],
    ])
}

#[test]
fn a_filter_for_one_channel_never_returns_another_channels_rows() {
    let dir = tempfile::tempdir().unwrap();
    let store = store::Store::open(dir.path().join("db.sqlite3")).unwrap();
    store.insert(&message("alpha", 100, 1)).unwrap();
    store.insert(&message("beta", 100, 2)).unwrap();
    let f = filter::parse(r#"[{"kinds":[9],"#h":["alpha"],"limit":50}]"#).unwrap();
    let got = store.query(&f).unwrap();
    assert_eq!(got.len(), 1);
    assert!(got[0].tags.iter().any(|t| t == &["h".to_owned(), "alpha".to_owned()]));
}

#[test]
fn a_before_id_cursor_neither_skips_nor_repeats_rows_in_one_second() {
    let dir = tempfile::tempdir().unwrap();
    let store = store::Store::open(dir.path().join("db.sqlite3")).unwrap();
    for seed in 0x10..0x14 {
        store.insert(&message("alpha", 100, seed)).unwrap();
    }
    let mut seen: Vec<String> = Vec::new();
    let mut cursor: Option<(u64, String)> = None;
    for _ in 0..8 {
        let body = match &cursor {
            None => r#"[{"kinds":[9],"#h":["alpha"],"limit":2}]"#.to_owned(),
            Some((at, id)) => format!(
                r#"[{{"kinds":[9],"#h":["alpha"],"limit":2,"until":{at},"before_id":"{id}"}}]"#
            ),
        };
        let page = store.query(&filter::parse(&body).unwrap()).unwrap();
        if page.is_empty() {
            break;
        }
        let last = page.last().unwrap();
        assert!(seen.iter().all(|id| !page.iter().any(|e| &e.id == id)), "a page repeated a row");
        seen.extend(page.iter().map(|e| e.id.clone()));
        cursor = Some((last.created_at, last.id.clone()));
    }
    assert_eq!(seen.len(), 4, "every row exactly once");
}

#[test]
fn a_reply_is_not_a_top_level_row() {
    let dir = tempfile::tempdir().unwrap();
    let store = store::Store::open(dir.path().join("db.sqlite3")).unwrap();
    store.insert(&message("alpha", 100, 1)).unwrap();
    let mut reply = message("alpha", 101, 2);
    reply.tags.push(vec!["e".into(), "dd".repeat(32), String::new(), "reply".into()]);
    store.insert(&reply).unwrap();
    let f = filter::parse(r#"[{"kinds":[9],"#h":["alpha"],"top_level":true,"limit":50}]"#).unwrap();
    assert_eq!(store.query(&f).unwrap().len(), 1);
    let all = filter::parse(r#"[{"kinds":[9],"#h":["alpha"],"limit":50}]"#).unwrap();
    assert_eq!(store.query(&all).unwrap().len(), 2);
}

#[test]
fn query_answers_an_event_array_newest_first() {
    // Exercises the seam, not just the store.
    let backend = backend_fixture();
    let viewer = "ab".repeat(32);
    backend.write(&viewer, &message("alpha", 100, 1)).unwrap();
    backend.write(&viewer, &message("alpha", 200, 2)).unwrap();
    let reply = backend
        .http(&viewer, "/query", "POST", Some(r#"[{"kinds":[9],"#h":["alpha"],"limit":10}]"#))
        .await
        .unwrap();
    assert_eq!(reply.status, 200);
    let body: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
    let rows = body.as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["created_at"], 200);
    assert_eq!(rows[0]["kind"], 9);
}
```

`backend_fixture()` builds a `LocalBackend` over a `tempfile::tempdir()` whose path it keeps alive; add it to `tests.rs` in this task and reuse it in later tasks. `write` refuses an event whose `pubkey` is not the viewer, which is why this test passes `"ab".repeat(32)` — the pubkey `message()` stamps.

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: compile errors for `filter`, `query`, `write`, `backend_fixture`.

- [ ] **Step 3: Write `filter.rs`**

`parse` reads the array, builds each `Filter`, and rejects a body that is not an array or is empty. Tag filters are the keys starting with `#` and exactly two characters long; any other unknown key is ignored, which is what makes `search`, `search_sort`, `artifact` and `thread_*` harmless — they are never advertised, so they never arrive.

`matches` checks kinds/ids/authors/since/until/tag lists and `top_level` in that order, and ignores `limit` and `before_id` (both are query-shaping, not matching).

- [ ] **Step 4: Add `Store::query` and `Store::tag_rows`**

Build the SQL with bound parameters only — never string-interpolate a value. Tag predicates become `EXISTS (SELECT 1 FROM event_tags g WHERE g.seq = events.seq AND g.name = ?n AND g.value IN (…))`, one per tag filter. `top_level` adds `AND NOT EXISTS (SELECT 1 FROM event_tags g WHERE g.seq = events.seq AND g.name = 'e' AND g.extra IN ('root','reply'))`.

Union: run each filter, take up to its `limit`, collect into a `BTreeMap` keyed by id, then sort the values by `(created_at DESC, id ASC)`.

Note every requested kind in `seen_kinds` as `query` runs.

- [ ] **Step 5: Add `POST /query` to `http`, and `LocalBackend::write`**

`http` parses `filter::parse(body)`, queries, and answers 200 with `serde_json::to_string(&events)`: each event's `tags` serialize as arrays of arrays, which is what `eventsDto` verifies. A malformed body is 400 with `{"error":"…"}`.

`LocalBackend::write(viewer, event)` checks `event.pubkey == viewer` and inserts; it returns `Result<bool, String>` and is the single write door used by tests, `/events` and the socket.

- [ ] **Step 6: Run the tests**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: PASS — the four tests added in step 1.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/local_backend
git commit -m "feat(local-backend): filters, keyset paging, /query"
```

---

## Task 5: The write path and its receipt

**Files:**
- Modify: `src-tauri/src/local_backend/mod.rs`
- Modify: `src-tauri/src/local_backend/tests.rs`

**Interfaces:**
- Produces: `LocalBackend::publish(&self, viewer: &str, body: &str) -> (u16, String)` — the status and JSON body `/events` answers with.

**A test key, defined once here and reused by every later task.** `"aa".repeat(32)` is not a valid secp256k1 point, so any test that needs a real signature must use a real key:

```rust
fn viewer_keys() -> nostr::Keys {
    nostr::Keys::parse("0000000000000000000000000000000000000000000000000000000000000003").unwrap()
}

/// A signed kind 9 in `channel`, as `keys`.
fn signed_message(keys: &nostr::Keys, created_at: u64, channel: &str, text: &str) -> event::Event {
    event::sign(
        keys,
        9,
        created_at,
        vec![
            vec!["h".into(), channel.into()],
            vec!["p".into(), keys.public_key().to_hex()],
        ],
        text.into(),
    )
    .unwrap()
}
```

Tasks 6, 9 and 11 reuse both helpers unchanged.

- [ ] **Step 1: Write the failing tests**

```rust
#[tokio::test]
async fn the_write_receipt_carries_a_string_message_and_the_same_id() {
    let backend = backend_fixture();
    let keys = viewer_keys();
    let viewer = keys.public_key().to_hex();
    let signed = signed_message(&keys, 1_700_000_000, "alpha", "hello");
    let body = serde_json::to_string(&signed).unwrap();
    let reply = backend.http(&viewer, "/events", "POST", Some(&body)).await.unwrap();
    assert_eq!(reply.status, 200);
    let receipt: serde_json::Value = serde_json::from_str(&reply.body).unwrap();
    assert_eq!(receipt["accepted"], true);
    assert_eq!(receipt["event_id"], signed.id);
    assert_eq!(receipt["message"].as_str(), Some(""));
}

#[tokio::test]
async fn an_event_signed_by_someone_else_is_refused() {
    let backend = backend_fixture();
    let viewer = viewer_keys().public_key().to_hex();
    let other = nostr::Keys::generate();
    let body = serde_json::to_string(&signed_message(&other, 1_700_000_000, "alpha", "not yours")).unwrap();
    let reply = backend.http(&viewer, "/events", "POST", Some(&body)).await.unwrap();
    assert_eq!(reply.status, 403, "only the viewer's own signature is accepted here");
    assert_eq!(backend.store().count(9).unwrap(), 0);
}

#[tokio::test]
async fn a_body_whose_id_does_not_hash_is_refused() {
    let backend = backend_fixture();
    let keys = viewer_keys();
    let viewer = keys.public_key().to_hex();
    let mut tampered = signed_message(&keys, 1_700_000_000, "alpha", "hello");
    tampered.content = "tampered".into();
    let body = serde_json::to_string(&tampered).unwrap();
    let reply = backend.http(&viewer, "/events", "POST", Some(&body)).await.unwrap();
    assert_eq!(reply.status, 400, "the id must hash the event it travels with");
    assert_eq!(backend.store().count(9).unwrap(), 0);
}

#[tokio::test]
async fn an_unimplemented_path_answers_404_and_does_not_reach_the_network() {
    let backend = backend_fixture();
    let reply = backend.http(&viewer_keys().public_key().to_hex(), "/upload", "PUT", Some("{}")).await.unwrap();
    assert_eq!(reply.status, 404);
    assert!(reply.body.contains("not found"));
}
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: `/events` currently answers 404, so the first two fail.

- [ ] **Step 3: Implement `publish`**

Parse the body into `event::Event`; reject a body that is not a single event object. Verify: `nostr::event::Event` from the same JSON, then `.verify()`. Reject `pubkey != viewer` with 403. Reject `id` that does not hash the event — `.verify()` already covers this.

Then `write`. Answer 200 with the receipt. A duplicate is still `accepted:true`: the client re-sends after an ambiguous transport failure and must be able to confirm.

- [ ] **Step 4: Wire `/events` in `http`**

`POST /events` → `publish`. Everything else stays 404. `GET /api/join-policy` answers 200 `{"policy":null}`.

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: PASS — the four tests added in step 1.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/local_backend
git commit -m "feat(local-backend): /events with a relay receipt"
```

---

## Task 6: The socket, and the first launch

**Files:**
- Create: `src-tauri/src/local_backend/session.rs`
- Modify: `src-tauri/src/local_backend/mod.rs` (socket entry point, subscription registry)
- Modify: `src-tauri/src/federated_identity/socket.rs` (seam at :65, `Sockets::register`)
- Modify: `src-tauri/src/local_backend/tests.rs`

**Interfaces:**
- Produces: `session::Session::new(id: String, challenge: String) -> Session`.
- Produces: `Session::greeting(&self) -> String` — `["AUTH","<challenge>"]`.
- Produces: `Session::receive(&mut self, frame: &str, query: &dyn Fn(&[filter::Filter]) -> Vec<event::Event>) -> Vec<String>` — the frames to send back, in order. Takes the query as a closure so the protocol is testable without a database and without tauri.
- Produces: `Session::viewer(&self) -> Option<&str>` — the authenticated pubkey.
- Produces: `Sockets::register(&self, id: String, stop: CancellationToken) -> Result<mpsc::Receiver<String>, String>` — inserts `Connection { stop, sender, start: Some(oneshot) }` and returns the receiving end, so a local socket is indistinguishable from a real one. Also `Sockets::start(&self, id) -> Result<(), String>`, `Sockets::send(&self, id, data) -> Result<(), String>` and `Sockets::unregister(&self, id)`: the existing `#[tauri::command]` bodies move here so the commands and the tests share one implementation.
- Produces: `local_backend::Subscriptions`, a process-wide registry with `open(&self, socket_id: &str) -> mpsc::UnboundedReceiver<String>`, `close(&self, socket_id: &str)`, `add(&self, socket_id: &str, sub_id: &str, filters: Vec<Filter>)`, `remove(&self, socket_id: &str, sub_id: &str)`, and `dispatch(&self, event: &event::Event)` — the fan-out that builds one `["EVENT", sub, …]` frame per matching subscription.

`dispatch` is what Task 10's `LocalBackend::deliver` calls; keeping it on `Subscriptions` is why the socket and the write path need no shared lock ordering.

**The trap this task exists to avoid:** if `relay_socket_connect` returns `SocketMode::Public`, `native-socket.ts:48-50` opens a real `new WebSocket("wss://loop.localhost")` in the webview and every connection fails a TLS handshake. It must return `Native`, and it must have registered in `Sockets` **before** returning, or `relay_socket_start` answers `Native socket retired` (`socket.rs:213-217`).

- [ ] **Step 1: Write the failing protocol tests**

The socket-registry test goes in `federated_identity/socket.rs`'s existing test module; the session tests go in `local_backend/tests.rs`. Rename `relay_socket_start`/`relay_socket_send`'s bodies into `Sockets::start`/`Sockets::send` so both the commands and the test use one implementation.

```rust
// src-tauri/src/federated_identity/socket.rs, in its #[cfg(test)] mod tests
#[test]
fn a_registered_local_socket_answers_start_and_send_like_a_real_one() {
    // `relay_socket_start` and `relay_socket_send` read this map. A seam that only
    // returns `Native` without registering leaves the first one answering
    // "Native socket retired" and the channel never loads.
    let sockets = Sockets::default();
    let stop = CancellationToken::new();
    let id = "4f0c1e6e-0000-4000-8000-000000000001";
    let mut frames = sockets.register(id.into(), stop).unwrap();
    assert!(sockets.start(id).is_ok());
    assert!(sockets.start(id).is_err(), "start is consumed once");
    sockets.send(id, r#"["REQ","a",{}]"#.into()).unwrap();
    assert_eq!(frames.try_recv().unwrap(), r#"["REQ","a",{}]"#);
    sockets.unregister(id);
    assert!(sockets.send(id, "[]".into()).is_err(), "a closed socket is gone");
}
```

The session protocol tests, in `local_backend/tests.rs`:

```rust
fn req(sub: &str, filter: serde_json::Value) -> String {
    format!(r#"["REQ","{sub}",{filter}]"#)
}

fn session_with_auth(keys: &nostr::Keys, id: &str) -> (session::Session, String) {
    let challenge = "cd".repeat(32);
    let mut session = session::Session::new(id.to_owned(), challenge.clone());
    let auth = event::sign(keys, 22242, 10, vec![
        vec!["relay".into(), "wss://loop.localhost".into()],
        vec!["challenge".into(), challenge],
    ], String::new()).unwrap();
    let replies = session.receive(
        &format!("[\"AUTH\",{}]", serde_json::to_string(&auth).unwrap()),
        &|_| Vec::new(),
    );
    let ok: serde_json::Value = serde_json::from_str(&replies[0]).unwrap();
    assert_eq!(ok[0], "OK");
    assert_eq!(ok[2], true, "the challenge must be accepted");
    (session, auth.id)
}

#[test]
fn a_request_before_auth_is_closed_not_answered() {
    let mut session = session::Session::new("s1".into(), "cd".repeat(32));
    let replies = session.receive(&req("a", serde_json::json!({"kinds":[9],"limit":1})), &|_| Vec::new());
    assert_eq!(replies.len(), 1);
    let frame: serde_json::Value = serde_json::from_str(&replies[0]).unwrap();
    assert_eq!(frame[0], "CLOSED");
    assert_eq!(frame[1], "a");
}

#[test]
fn a_wrong_challenge_is_refused() {
    let keys = nostr::Keys::generate();
    let auth = event::sign(&keys, 22242, 10, vec![
        vec!["relay".into(), "wss://loop.localhost".into()],
        vec!["challenge".into(), "ff".repeat(32)],
    ], String::new()).unwrap();
    let mut session = session::Session::new("s1".into(), "cd".repeat(32));
    let replies = session.receive(&format!("[\"AUTH\",{}]", serde_json::to_string(&auth).unwrap()), &|_| Vec::new());
    let ok: serde_json::Value = serde_json::from_str(&replies[0]).unwrap();
    assert_eq!(ok[2], false, "a challenge from another connection is not ours");
    assert!(session.viewer().is_none());
}

#[test]
fn a_request_is_answered_with_its_rows_then_eose() {
    let keys = nostr::Keys::generate();
    let (mut session, _) = session_with_auth(&keys, "s1");
    let row = message("alpha", 100, 1);
    let replies = session.receive(
        &req("a", serde_json::json!({"kinds":[9],"#h":["alpha"],"limit":50})),
        &|filters| {
            assert_eq!(filters.len(), 1);
            assert_eq!(filters[0].tags, vec![('h', vec!["alpha".to_owned()])]);
            vec![row.clone()]
        },
    );
    assert_eq!(replies.len(), 2);
    let first: serde_json::Value = serde_json::from_str(&replies[0]).unwrap();
    assert_eq!(first[0], "EVENT");
    assert_eq!(first[1], "a");
    assert_eq!(first[2]["id"], row.id);
    assert_eq!(replies[1], r#"["EOSE","a"]"#);
}

#[test]
fn a_limit_of_zero_still_ends_with_eose() {
    let keys = nostr::Keys::generate();
    let (mut session, _) = session_with_auth(&keys, "s1");
    let replies = session.receive(
        &req("probe", serde_json::json!({"kinds":[44100],"#p":["aa".repeat(32)],"limit":0})),
        &|_| Vec::new(),
    );
    assert_eq!(replies, vec![r#"["EOSE","probe"]"#.to_owned()], "live.ts needs EOSE even for an empty probe");
}
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: compile errors for `session::Session`.

- [ ] **Step 3: Write `session.rs`**

`receive` matches `frame[0]`:
- `"AUTH"` → when already authenticated or the event is not kind 22242, not signed by its own `pubkey`, does not carry exactly one `relay` tag equal to `wss://loop.localhost`, or does not carry exactly one `challenge` tag equal to ours, answer `["OK", id, false, "auth-required: invalid authentication"]`. Otherwise store the viewer and answer `["OK", id, true, ""]`.
- `"REQ"` with at least one filter and an unauthenticated session → `["CLOSED", sub, "auth-required: authenticate first"]`.
- `"REQ"` authenticated → keep `(sub, filters)` in `self.subs`, run the query closure, emit one `["EVENT", sub, <event>]` per row in the order given, then `["EOSE", sub]`.
- `"EVENT"` → ignore; publishes arrive over HTTP.
- `"CLOSE"` → forget `sub`, emit nothing.
- Anything else → emit nothing. Never panic on a client frame.

- [ ] **Step 4: Wire `relay_socket_connect`**

First statement, before `canonical_relay`: when `local_backend::is_local(&relay)` and a backend is installed, take `let mut frames = sockets.register(id.clone(), stop.clone())?` and return `Ok(SocketMode::Native)` after spawning the connection task. Validate `id` as a UUID, and enforce the same 16-socket cap.

The task, in this order:
1. `let mut receiver = subscriptions.open(&id)` — the frame channel the write path fans out into.
2. Await the oneshot with the same 10 s bound the real path uses; on timeout send `SocketEvent::Closed` and stop.
3. Send `SocketEvent::Text { data: greeting }` — the `["AUTH", challenge]` frame.
4. Loop on `tokio::select!` over `receiver.recv()` and `stop.cancelled()`. For each inbound client frame, build the session's replies, and **mirror the subscription bookkeeping into `subscriptions`**: a `REQ` calls `subscriptions.add(&id, sub, filters)`, a `CLOSE` calls `subscriptions.remove(&id, sub)`. Forward every reply as `SocketEvent::Text`.
5. On exit: `subscriptions.close(&id)`, `sockets.unregister(&id)`, `SocketEvent::Closed { code: None, reason: None }`.

Step 4's mirroring is what Task 10 delivers into. A session that kept its subscriptions only in `Session` would answer the initial replay and then never hear a new message — the socket would look alive and be silently dead.

On cancellation send `SocketEvent::Closed`, never `Refused`: a refusal starts a sign-in flow that does not exist locally.

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: PASS — the five tests added in step 1.

- [ ] **Step 6: Launch, and confirm both gates are gone**

Build detached with the seed set:

```powershell
$env:BUZZ_DEFAULT_COMMUNITY_URL="https://loop.localhost"
pnpm run tauri build --no-bundle
```

Then launch `target/release/Buzz.exe` with a fresh profile (rename `%APPDATA%\xyz.block.buzz.desktop` aside first, and restore it after).

Expected, in this order:
1. No language or welcome screen asking for an account.
2. No "Join a community" screen, and no relay address field anywhere.
3. The shell appears with an empty channel list.
4. The sidebar does not show "Live connection stopped answering" after 90 s, which is the symptom of a socket that never authenticated.
5. In the settings community list, the community is named **내 워크스페이스**, not `loop.localhost` — if it shows the host name, the NIP-11 `name` never arrived and Task 1's document is wrong.

Record what actually happened. A step that only passes after a fix belongs in the commit message.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/local_backend src-tauri/src/federated_identity/socket.rs
git commit -m "feat(local-backend): native socket, nip-42 auth, eose"
```

---

## Task 7: Relay-authored channel state

**Files:**
- Modify: `src-tauri/src/local_backend/event.rs`
- Modify: `src-tauri/src/local_backend/tests.rs`

**Interfaces:**
- Consumes: `event::sign` from Task 3. These constructors only assemble tags and content.
- Produces: `event::metadata(keys, channel_id, name, about, public, created_at) -> Result<event::Event, String>` — kind 39000.
- Produces: `event::admins(keys, channel_id, owners: &[(String, &str)], created_at) -> Result<event::Event, String>` — kind 39001, tags `["d", id]` then `["p", pubkey, "owner"|"admin"]`.
- Produces: `event::roster(keys, channel_id, members: &[(String, &str)], created_at) -> Result<event::Event, String>` — kind 39002, tags `["d", id]` then `["p", pubkey, "", role]`.
- Produces: `event::community_roster(keys, members: &[(String, &str)], created_at) -> Result<event::Event, String>` — kind 13534, tags `["member", pubkey, role]`.
- Produces: `event::notice(keys, channel_id, kind: &str, actor, target, created_at) -> Result<event::Event, String>` — kind 40099, tag `["h", id]`, content `{"type":…,"actor":…,"target":…}`.

Tag order matters and is fixed. 39000 is `d`, `t`, `name`, `about`, then one bare `public` or `private` tag. 40099's content omits `target` for `member_left`, because `membership.ts:23-43` rejects a `member_left` whose target differs from its actor.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn every_relay_authored_event_verifies_against_the_relay_key() {
    let keys = nostr::Keys::generate();
    let channel = "0f6c1f0e-0f1e-4a5b-9c3d-2b1a0f9e8d7c";
    let viewer = "aa".repeat(32);
    let events = vec![
        event::metadata(&keys, channel, "일반", "", true, 100).unwrap(),
        event::admins(&keys, channel, &[(viewer.clone(), "owner")], 100).unwrap(),
        event::roster(&keys, channel, &[(viewer.clone(), "member")], 100).unwrap(),
        event::community_roster(&keys, &[(viewer.clone(), "owner")], 100).unwrap(),
        event::notice(&keys, channel, "member_joined", &viewer, &viewer, 100).unwrap(),
    ];
    let relay = keys.public_key().to_hex();
    for event in &events {
        assert_eq!(event.pubkey, relay, "kind {} must be relay-signed", event.kind);
        let parsed: nostr::event::Event = serde_json::from_value(serde_json::to_value(event).unwrap()).unwrap();
        parsed.verify().unwrap();
    }
}

#[test]
fn the_roster_carries_its_roles_in_the_fourth_slot() {
    let keys = nostr::Keys::generate();
    let channel = "0f6c1f0e-0f1e-4a5b-9c3d-2b1a0f9e8d7c";
    let owner = "aa".repeat(32);
    let member = "bb".repeat(32);
    let roster = event::roster(&keys, channel, &[(owner.clone(), "owner"), (member.clone(), "member")], 100).unwrap();
    assert_eq!(roster.tags[0], vec!["d", channel]);
    assert_eq!(roster.tags[1], vec!["p", owner.as_str(), "", "owner"]);
    assert_eq!(roster.tags[2], vec!["p", member.as_str(), "", "member"]);
}

#[test]
fn public_metadata_says_public_with_one_bare_tag() {
    let keys = nostr::Keys::generate();
    let channel = "0f6c1f0e-0f1e-4a5b-9c3d-2b1a0f9e8d7c";
    let open = event::metadata(&keys, channel, "일반", "", true, 100).unwrap();
    assert!(open.tags.contains(&vec!["public".to_owned()]));
    assert!(!open.tags.iter().any(|t| t[0] == "private"));
    assert_eq!(open.tags.iter().find(|t| t[0] == "t").unwrap()[1], "stream");
}
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: compile errors for `event::metadata` and friends.

- [ ] **Step 3: Add the constructors to `event.rs`**

Each one assembles `Vec<Vec<String>>` tags in the fixed order above and calls `event::sign`. 39000's `t` tag is `stream`; the bare `public` tag is what `openMetadata` (`discovery.ts:54-60`) reads. 39001's role values are `owner` or `admin` only; 39002's fourth element is the role hint.

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: PASS, including the three added here.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/local_backend
git commit -m "feat(local-backend): relay-signed channel metadata and rosters"
```

---

## Task 8: The seed channel that a person can write in

**Files:**
- Create: `src-tauri/src/local_backend/seed.rs`
- Modify: `src-tauri/src/local_backend/mod.rs` (`ensure_seed`)
- Modify: `src-tauri/src/lib.rs` (call `ensure_seed` once the first-run key exists)
- Modify: `src-tauri/src/local_backend/tests.rs`

**Interfaces:**
- Produces: `LocalBackend::ensure_seed(&self, viewer: &str) -> Result<(), String>` — idempotent; creates the channel once, and afterwards only guarantees `viewer` is in its roster.
- Produces: `LocalBackend::seed_channel_id(&self) -> Option<String>` — the channel id from `state`, for tests and later tasks.
- Produces: `store::state` keys `seed.channel` and `seed.viewer`.
- Consumes: `Store::state`, `Store::set_state`, and the constructors from Task 7.

**Why the roster must contain the viewer:** `discovery.ts:295-308` lets anyone read a channel whose 39000 carries the bare `public` tag, but `discovery.ts:311-321` `canParticipate` requires `hasTag(roster, "p", viewer)`. Without it the channel is visible and unwritable — a failure that looks like a broken composer, not a permissions problem.

- [ ] **Step 1: Write the failing tests**

`viewer_keys()` and `signed_message()` come from Task 5; the seed only needs a real pubkey string, so these tests may use `viewer_keys().public_key().to_hex()` where a signature is not required.

```rust
#[test]
fn the_seed_channel_is_created_once_and_is_writable_by_the_viewer() {
    let backend = backend_fixture();
    let viewer = viewer_keys().public_key().to_hex();
    backend.ensure_seed(&viewer).unwrap();
    backend.ensure_seed(&viewer).unwrap();
    let id = backend.seed_channel_id().expect("a seed channel exists");
    assert_eq!(backend.store().count(39000).unwrap(), 1, "no second channel");
    assert_eq!(backend.store().count(39002).unwrap(), 1, "no second roster");
    let roster = backend.store().get_kind(&id, 39002).unwrap().unwrap();
    assert!(roster.tags.iter().any(|t| t == &vec!["p".to_owned(), viewer.clone(), String::new(), "member".to_owned()]));
    let metadata = backend.store().get_kind(&id, 39000).unwrap().unwrap();
    assert_eq!(metadata.tags.iter().find(|t| t[0] == "name").unwrap()[1], "일반");
    assert!(metadata.tags.iter().any(|t| t == &vec!["public".to_owned()]));
}

#[test]
fn a_changed_key_is_added_to_the_roster_instead_of_locking_the_channel() {
    let backend = backend_fixture();
    backend.ensure_seed(&viewer_keys().public_key().to_hex()).unwrap();
    let id = backend.seed_channel_id().unwrap();
    let second = nostr::Keys::generate().public_key().to_hex();
    backend.ensure_seed(&second).unwrap();
    let roster = backend.store().get_kind(&id, 39002).unwrap().unwrap();
    assert!(roster.tags.iter().any(|t| t[1] == second), "the new key can write");
    assert_eq!(backend.store().count(39002).unwrap(), 1, "one roster, replaced");
}

#[test]
fn a_community_roster_lets_the_owner_menus_resolve() {
    let backend = backend_fixture();
    let viewer = viewer_keys().public_key().to_hex();
    backend.ensure_seed(&viewer).unwrap();
    let roster = backend.store().get_latest(13534).unwrap().unwrap();
    assert_eq!(roster.pubkey, backend.relay_pubkey(), "13534 is relay-signed");
    assert!(roster.tags.iter().any(|t| t == &vec!["member".to_owned(), viewer.clone(), "owner".to_owned()]));
}
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: compile errors for `ensure_seed`, `seed_channel_id`.

- [ ] **Step 3: Implement `ensure_seed`**

Read `seed.channel`. When absent: generate a lowercase UUID v4 with `uuid::Uuid::new_v4()`, write 39000 (`일반`, `public`, type `stream`), 39001 (`viewer` as `owner`), 39002 (`viewer` as `member`) and 13534 (`viewer` as `owner`), then set `seed.channel`. When present: load the roster, and if `viewer` is absent, write a new 39002 with the viewer appended as `member` and a fresh `created_at` of `now`, plus a 40099 `member_joined`.

`created_at` must strictly increase across successive writes of the same addressable event, or the replacement rule in Task 3 discards the newer write. Use `max(now, previous.created_at + 1)`.

- [ ] **Step 4: Call it where the viewer is first known**

Extend the first-run task from Task 2 rather than adding a second spawn: after the key exists, resolve the viewer (from `create_if_missing`'s `Some`, or `identity.saved_viewer()`'s `Some`) and call `ensure_seed(&viewer)`. Ordering matters — a seed that races the first discovery pass leaves the sidebar empty until the next one.

```rust
Ok(Some(created)) => { backup.local_key_installed(identity.clone()); seed(&created); }
Ok(None) => { if let Ok(Some(viewer)) = identity.saved_viewer().await { seed(&viewer); } }
```

`seed` is a local closure that calls `local_backend::current()` and `ensure_seed`, logging a failure and continuing.

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: PASS — the three tests added in step 1.

- [ ] **Step 6: Launch, and confirm the channel exists**

Rebuild with the seed env var and launch on a fresh profile.

Expected: the sidebar lists **일반** under **내 워크스페이스**, and the composer is available. If the channel is listed but the composer is disabled, the roster does not carry the viewer's `p` tag — that is the exact failure `canParticipate` produces. If the list is empty, the `#p` roster query returned nothing: check that `event_tags` holds one row per `p`, not only the first.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/local_backend src-tauri/src/lib.rs
git commit -m "feat(local-backend): seed channel with the viewer on its roster"
```

---

## Task 9: Window pages, their bound, and a persistent message

**Files:**
- Create: `src-tauri/src/local_backend/window.rs`
- Modify: `src-tauri/src/local_backend/mod.rs` (`POST /query` gains the window branch)
- Modify: `src-tauri/src/local_backend/store.rs`
- Modify: `src-tauri/src/local_backend/tests.rs`

**Interfaces:**
- Produces: `window::wants_bound(filter: &filter::Filter) -> bool` — `top_level == true`.
- Produces: `window::bound_suffix(channel: &str, cursor: Option<(u64, &str)>) -> String` — `<channel>:head` or `<channel>:<created_at>:<id>`.
- Produces: `window::answer(backend: &LocalBackend, channel: &str, filter: &filter::Filter) -> Result<Vec<event::Event>, String>` — the rows plus exactly one 39006.
- Produces: `Store::get_kind(&self, channel: &str, kind: u16) -> Result<Option<event::Event>, String>`, `Store::get_latest(&self, kind: u16) -> Result<Option<event::Event>, String>`.

**The bound's contract, from `window.ts:52-105`, all of which is enforced:** exactly one 39006 whose `pubkey` is the relay's, carrying `h` = the channel and `d` = the suffix, with body `{"has_more":bool,"next_cursor":{"created_at":n,"id":"<64 hex>"}|null}`. `has_more` must equal `next_cursor !== null`. A second page at the same timestamp must move to a strictly greater id, or the client throws `Channel history cursor does not advance`.

- [ ] **Step 1: Write the failing tests**

```rust
fn window_request(channel: &str, cursor: Option<(u64, &str)>) -> String {
    match cursor {
        None => format!(r#"[{{"kinds":[9,40002,40008,48100,48103],"#h":["{channel}"],"limit":3,"top_level":true,"include_aux":true,"include_summaries":true}}]"#),
        Some((at, id)) => format!(r#"[{{"kinds":[9,40002,40008,48100,48103],"#h":["{channel}"],"limit":3,"top_level":true,"include_aux":true,"include_summaries":true,"until":{at},"before_id":"{id}"}}]"#),
    }
}

#[tokio::test]
async fn a_window_page_carries_exactly_one_bound_and_the_rows() {
    let backend = backend_fixture();
    let keys = viewer_keys();
    let viewer = keys.public_key().to_hex();
    backend.ensure_seed(&viewer).unwrap();
    let channel = backend.seed_channel_id().unwrap();
    for (n, seed) in (0x10..0x14).enumerate() {
        let signed = signed_message(&keys, 1_700_000_100 + n as u64, &channel, &format!("m{seed}"));
        backend.write(&viewer, &signed).unwrap();
    }
    let reply = backend.http(&viewer, "/query", "POST", Some(&window_request(&channel, None))).await.unwrap();
    let rows: Vec<serde_json::Value> = serde_json::from_str(&reply.body).unwrap();
    let bounds: Vec<_> = rows.iter().filter(|r| r["kind"] == 39006).collect();
    assert_eq!(bounds.len(), 1, "parseWindow rejects zero or two bounds");
    let body: serde_json::Value = serde_json::from_str(bounds[0]["content"].as_str().unwrap()).unwrap();
    assert_eq!(body["has_more"], true);
    assert_eq!(body["next_cursor"]["id"].as_str().map(str::len), Some(64));
    assert_eq!(rows.len(), 4, "three rows and their bound");
}

#[tokio::test]
async fn the_end_of_history_answers_no_more_with_no_cursor() {
    let backend = backend_fixture();
    let keys = viewer_keys();
    let viewer = keys.public_key().to_hex();
    backend.ensure_seed(&viewer).unwrap();
    let channel = backend.seed_channel_id().unwrap();
    let signed = signed_message(&keys, 1_700_000_100, &channel, "only");
    backend.write(&viewer, &signed).unwrap();
    let reply = backend.http(&viewer, "/query", "POST", Some(&window_request(&channel, None))).await.unwrap();
    let rows: Vec<serde_json::Value> = serde_json::from_str(&reply.body).unwrap();
    let bound = rows.iter().find(|r| r["kind"] == 39006).unwrap();
    let body: serde_json::Value = serde_json::from_str(bound["content"].as_str().unwrap()).unwrap();
    assert_eq!(body["has_more"], false);
    assert!(body["next_cursor"].is_null(), "has_more and next_cursor must agree");
}

#[tokio::test]
async fn paging_a_burst_in_one_second_neither_repeats_nor_skips() {
    let backend = backend_fixture();
    let keys = viewer_keys();
    let viewer = keys.public_key().to_hex();
    backend.ensure_seed(&viewer).unwrap();
    let channel = backend.seed_channel_id().unwrap();
    // Six messages sharing one `created_at`: the case a naive cursor skips or repeats.
    for seed in 0x10..0x16 {
        let signed = signed_message(&keys, 1_700_000_200, &channel, &format!("burst{seed}"));
        backend.write(&viewer, &signed).unwrap();
    }
    assert_eq!(backend.store().count(9).unwrap(), 6, "all six were stored, not deduplicated");
    let mut seen: Vec<String> = Vec::new();
    let mut cursor: Option<(u64, String)> = None;
    for _ in 0..10 {
        let request = window_request(&channel, cursor.as_ref().map(|(at, id)| (*at, id.as_str())));
        let reply = backend.http(&viewer, "/query", "POST", Some(&request)).await.unwrap();
        let rows: Vec<serde_json::Value> = serde_json::from_str(&reply.body).unwrap();
        let bound = rows.iter().find(|r| r["kind"] == 39006).unwrap();
        let body: serde_json::Value = serde_json::from_str(bound["content"].as_str().unwrap()).unwrap();
        for row in rows.iter().filter(|r| r["kind"] != 39006) {
            let id = row["id"].as_str().unwrap().to_owned();
            assert!(!seen.contains(&id), "a row was served twice");
            seen.push(id);
        }
        if !body["has_more"].as_bool().unwrap() { break; }
        let next = &body["next_cursor"];
        let at = next["created_at"].as_u64().unwrap();
        let id = next["id"].as_str().unwrap().to_owned();
        if let Some((prev_at, prev_id)) = &cursor {
            assert!(at < *prev_at || (at == *prev_at && id > *prev_id), "cursor must advance");
        }
        cursor = Some((at, id));
    }
    assert_eq!(seen.len(), 6, "every message exactly once");
}
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: no 39006 is ever produced, so every assertion about the bound fails.

- [ ] **Step 3: Write `window.rs`**

`answer` runs the row query with `limit + 1`; if it got `limit + 1` rows, drop the extra, `has_more = true`, and `next_cursor` is the **last kept** row's `(created_at, id)`; otherwise `has_more = false` and `next_cursor` is `null`. Then sign a 39006 with `d = bound_suffix(channel, cursor)` and body exactly `{"has_more":…,"next_cursor":…}` with `next_cursor` written as `null` when absent. Append it after the rows.

`created_at` for the bound: `now`, or `previous + 1` if a bound with the same `d` already exists, so successive identical requests still replace rather than collide.

- [ ] **Step 4: Wire the branch in `http`**

In `POST /query`, for each filter where `window::wants_bound` is true, replace its rows with `window::answer`. Filters that are not windows are unchanged, so the same command serves discovery paging and history paging.

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: PASS, including the three added here.

- [ ] **Step 6: Launch, and confirm the channel loads and a post persists**

Rebuild and launch on a fresh profile.

Expected: opening **일반** shows a message list that stops loading and does not spin. Post one message — it appears immediately. Quit, relaunch: the message is still there, and scrolling up does not fetch forever. If the channel spins forever, the bound is wrong: either zero or two 39006 arrived, or `has_more` disagreed with `next_cursor`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/local_backend
git commit -m "feat(local-backend): nip-cw window pages with signed bounds"
```

---

## Task 10: Live delivery

**Files:**
- Modify: `src-tauri/src/local_backend/mod.rs` (fan-out on every write)
- Modify: `src-tauri/src/local_backend/tests.rs`

**Interfaces:**
- Consumes: `Subscriptions` from Task 6, `Filter::matches` from Task 4.
- Produces: `LocalBackend::deliver(&self, event: &event::Event)` — calls `Subscriptions::dispatch` so every open socket's every matching subscription gets one `["EVENT", sub, <event>]`.

- [ ] **Step 1: Write the failing tests**

Test harness, added in this task: `sub(backend, "s1", filter)` registers a socket whose frames land in a shared buffer, and returns a handle exposing `frames()` and `close()`.

```rust
#[test]
fn one_write_reaches_every_socket_that_asked_for_it() {
    let backend = backend_fixture();
    let live = filter::parse(r#"[{"kinds":[9],"#h":["alpha"],"limit":0}]"#).unwrap();
    let one = sub(&backend, "s1", &live);
    let two = sub(&backend, "s2", &live);
    backend.deliver(&message("alpha", 100, 1));
    assert_eq!(one.frames().len(), 1, "the first socket got the event");
    assert_eq!(two.frames().len(), 1, "and so did the second");
    assert!(one.frames()[0].contains(r#""EVENT""#));
    assert!(one.frames()[0].contains("alpha"));
}

#[test]
fn a_subscription_for_another_channel_is_not_woken() {
    let backend = backend_fixture();
    let beta = filter::parse(r#"[{"kinds":[9],"#h":["beta"],"limit":0}]"#).unwrap();
    let socket = sub(&backend, "s1", &beta);
    backend.deliver(&message("alpha", 100, 1));
    assert!(socket.frames().is_empty());
}

#[test]
fn a_closed_socket_stops_receiving_and_does_not_block_the_rest() {
    let backend = backend_fixture();
    let all = filter::parse(r#"[{"kinds":[9],"limit":0}]"#).unwrap();
    let closed = sub(&backend, "s1", &all);
    let open = sub(&backend, "s2", &all);
    closed.close();
    backend.deliver(&message("alpha", 100, 1));
    assert_eq!(open.frames().len(), 1, "one dead socket must not starve the others");
    assert!(closed.frames().is_empty(), "a closed socket receives nothing more");
}

#[test]
fn the_same_socket_with_two_matching_subscriptions_gets_one_frame_per_subscription() {
    let backend = backend_fixture();
    let socket = sub(&backend, "s1", &filter::parse(r#"[{"kinds":[9],"limit":0}]"#).unwrap());
    socket.add("second", &filter::parse(r#"[{"kinds":[9],"#h":["alpha"],"limit":0}]"#).unwrap());
    backend.deliver(&message("alpha", 100, 1));
    assert_eq!(socket.frames().len(), 2, "each subscription is answered by its own id");
}
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: compile errors for `deliver` and `Subscriptions`; nothing is delivered yet.

- [ ] **Step 3: Implement `deliver`**

`deliver` is one line: `self.subscriptions.dispatch(event)`. `dispatch` does the work — copy the `(sub_id, filters)` pairs for each socket out of the registry while the lock is held, then `try_send` outside it. A full or closed receiver removes that socket from the registry; it must not abort the loop or drop the event for others. A socket with two matching subscriptions gets two frames, one per subscription id, because the client demultiplexes by the second array element.

`Subscriptions` is a process-global like the backend itself, because `relay_socket_connect` and `send()` both reach it without an `AppHandle`. Make `dispatch` a free function taking `&event::Event` if that is simpler than method plumbing; the tests only need the observable behaviour.

- [ ] **Step 4: Call `deliver` from the single write door**

Every insert path — `/events`, the socket's own `EVENT` (unused in v0 but present) and `ensure_seed`'s roster rewrite — goes through `LocalBackend::write`. Put the fan-out there, so a future write path cannot forget it.

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: PASS — the four tests added in step 1.

- [ ] **Step 6: Launch, and confirm a live message arrives**

Rebuild and launch on a fresh profile. Open **일반**, post a message, and watch it appear without a reload. Then, in the same window, post a second one: the first must not be lost, and no duplicate may appear. If a message only shows after a reload, delivery is not wired; if it shows twice, the same event is being delivered by both the window's replay and the fan-out and the subscription is being replayed when it should be live.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/local_backend
git commit -m "feat(local-backend): deliver writes to every open subscription"
```

---

## Task 11: An agent answers in the channel

**Files:**
- Modify: `src-tauri/src/local_backend/mod.rs` (roster commands)
- Modify: `src-tauri/src/app_agents.rs` (seams in `app_agent_query` at :1078, `app_agent_publish` at :999)
- Modify: `src-tauri/src/local_backend/tests.rs`

**Interfaces:**
- Consumes: `LocalBackend::publish`, `Store::query`, `filter::parse`, `event::sign`.
- Produces: `LocalBackend::command(&self, actor: &str, event: &event::Event) -> Result<(), String>` — applies 9000 (add member), 9001 (remove member), 9021 (join), 9022 (leave) by rewriting the 39002 roster and appending a 40099 notice. Any other kind is stored as-is. `actor` is the event's signer; the command changes state only when `event.pubkey == actor` and `actor` is already on the roster.

**Why the roster commands are here:** the client adds an agent to a channel by publishing kind 9000, which `relay_http` does not block (`relay.rs:944-946` blocks 9002/9008/9021/9022/41012/9035/9036 only). Without 9000 the agent is never in the roster, never passes `canParticipate`, and never sees the message.

- [ ] **Step 1: Write the failing tests**

`viewer_keys()` and `signed_message()` already exist from Task 5; reuse them unchanged.

```rust
#[test]
fn adding_a_member_rewrites_the_roster_and_announces_it() {
    let backend = backend_fixture();
    let keys = viewer_keys();
    let viewer = keys.public_key().to_hex();
    backend.ensure_seed(&viewer).unwrap();
    let channel = backend.seed_channel_id().unwrap();
    let agent = "ee".repeat(32);
    let command = event::sign(&keys, 9000, 200, vec![
        vec!["h".into(), channel.clone()],
        vec!["p".into(), agent.clone()],
    ], String::new()).unwrap();
    backend.command(&viewer, &command).unwrap();
    let roster = backend.store().get_kind(&channel, 39002).unwrap().unwrap();
    assert!(roster.tags.iter().any(|t| t[1] == agent), "the agent is on the roster");
    assert!(roster.tags.iter().any(|t| t[1] == viewer), "and so is the viewer");
    let notice = backend.store().get_latest(40099).unwrap().unwrap();
    let body: serde_json::Value = serde_json::from_str(&notice.content).unwrap();
    assert_eq!(body["type"], "member_joined");
    assert_eq!(body["target"], agent);
}

#[test]
fn a_removal_keeps_the_roster_consistent() {
    let backend = backend_fixture();
    let keys = viewer_keys();
    let viewer = keys.public_key().to_hex();
    backend.ensure_seed(&viewer).unwrap();
    let channel = backend.seed_channel_id().unwrap();
    let agent = "ee".repeat(32);
    for (kind, at) in [(9000, 200), (9001, 300)] {
        let command = event::sign(&keys, kind, at, vec![
            vec!["h".into(), channel.clone()],
            vec!["p".into(), agent.clone()],
        ], String::new()).unwrap();
        backend.command(&viewer, &command).unwrap();
    }
    let roster = backend.store().get_kind(&channel, 39002).unwrap().unwrap();
    assert!(!roster.tags.iter().any(|t| t[1] == agent), "the agent is gone");
    assert!(roster.tags.iter().any(|t| t[1] == viewer), "the viewer stays");
}

#[test]
fn a_command_from_someone_off_the_roster_changes_nothing() {
    let backend = backend_fixture();
    let owner = viewer_keys();
    let owner_pubkey = owner.public_key().to_hex();
    backend.ensure_seed(&owner_pubkey).unwrap();
    let channel = backend.seed_channel_id().unwrap();
    let stranger = nostr::Keys::generate();
    let command = event::sign(&stranger, 9000, 200, vec![
        vec!["h".into(), channel.clone()],
        vec!["p".into(), "ee".repeat(32)],
    ], String::new()).unwrap();
    assert!(backend.command(&stranger.public_key().to_hex(), &command).is_err());
    let roster = backend.store().get_kind(&channel, 39002).unwrap().unwrap();
    assert!(!roster.tags.iter().any(|t| t[1] == "ee".repeat(32)), "a stranger added nobody");
}

#[tokio::test]
async fn an_agents_signed_read_is_answered_locally() {
    let backend = backend_fixture();
    let agent_keys = nostr::Keys::generate();
    let viewer = viewer_keys().public_key().to_hex();
    backend.ensure_seed(&viewer).unwrap();
    let channel = backend.seed_channel_id().unwrap();
    let row = signed_message(&agent_keys, 1_700_000_100, &channel, "hi");
    backend.store().insert(&row).unwrap();
    let reply = backend
        .agent_query(&format!(r#"[{{"kinds":[9],"#h":["{channel}"],"limit":10}}]"#))
        .await
        .unwrap();
    let rows: Vec<serde_json::Value> = serde_json::from_str(&reply).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["content"], "hi");
}

#[tokio::test]
async fn an_agents_publish_is_stored_and_delivered() {
    let backend = backend_fixture();
    let agent_keys = nostr::Keys::generate();
    let agent = agent_keys.public_key().to_hex();
    let signed = signed_message(&agent_keys, 1_700_000_200, "alpha", "on it");
    let reply = backend.agent_publish(&agent, &signed).await.unwrap();
    assert_eq!(reply, signed.id);
    assert_eq!(backend.store().count(9).unwrap(), 1);
}

#[tokio::test]
async fn an_agents_publish_signed_for_a_different_key_is_refused() {
    let backend = backend_fixture();
    let signed = signed_message(&nostr::Keys::generate(), 1_700_000_200, "alpha", "spoof");
    let other = nostr::Keys::generate().public_key().to_hex();
    assert!(backend.agent_publish(&other, &signed).await.is_err());
    assert_eq!(backend.store().count(9).unwrap(), 0);
}
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: compile errors for `command`, `agent_query`, `agent_publish`.

- [ ] **Step 3: Implement the roster commands**

Read the current roster (or start from the seed's members), add or remove the `p` entry, sign a new 39002 at `max(now, previous + 1)`, and append the matching 40099. 9001 on a channel that would lose its last member is refused with `Err("A channel needs a member")` — an empty roster makes the channel unopenable, and nothing else can restore it.

- [ ] **Step 4: Wire the two agent seams**

`app_agent_query`: before `state.signer`, when `local_backend::is_local(&relay)`, parse the filters and return the local query's rows as JSON. Keep the existing 1..=8 filter bound and its message.

`app_agent_publish`: before `state.signer`, when local, verify the event (`nostr::event::Event::from` + `.verify()`), require `event.pubkey == pubkey`, route it through `LocalBackend::command` so a roster command is applied rather than merely stored, and return the event id — the same `String` the remote path returns.

`app_agent_query` and `app_agent_publish` are `#[tauri::command]`s whose first statement is `state.signer(...)`, so both guards go above it. That call is what loads the agent key; a guard below it would still fail for a local community.

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test --lib local_backend`
Expected: PASS — the six tests added in step 1.

Run: `cd src-tauri && cargo test --lib app_agents`
Expected: unchanged from before this task, proving the remote path still compiles and behaves.

- [ ] **Step 6: Launch, and confirm an agent answers**

Rebuild and launch on a fresh profile. Create an agent, add it to **일반**, and mention it in a message.

Expected: the agent's reply arrives in the channel. Then read the measurement the spec asks for:

```powershell
# with the profile kept, so the store is intact
$db = Join-Path $env:APPDATA "xyz.block.buzz.desktop\local-backend\loop.sqlite3"
```

Query `seen_kinds` with any SQLite client, or add a temporary `eprintln!` at socket close. **Record the list in the commit message** — it is the input that decides the M3 plan's scope, and it is the first time this project knows what a turn actually uses.

- [ ] **Step 7: Commit**

Include the observed `seen_kinds` list in the message body.

```bash
git add src-tauri/src/local_backend src-tauri/src/app_agents.rs
git commit -m "feat(local-backend): agent reads, writes, and channel membership"
```

---

## Task 12: Acceptance

**Files:**
- Modify: `docs/loop-local-backend.md` (create — what runs locally, what does not)
- No production code unless a step fails.

**Interfaces:** none. This task runs the spec's measurements and records them.

- [ ] **Step 1: Clean-slate launch**

Move `%APPDATA%\xyz.block.buzz.desktop` and `%LOCALAPPDATA%\xyz.block.buzz.desktop` aside. Build with `BUZZ_DEFAULT_COMMUNITY_URL=https://loop.localhost` and launch.

Record, each as a yes/no:
1. Community screen appearances: **0**.
2. Identity screen appearances: **0**.
3. Sidebar community name: **내 워크스페이스**.
4. Channel list contains exactly one channel, **일반**.
5. Composer available without any permission dialog.

- [ ] **Step 2: Restart persistence**

Post three messages, quit fully, relaunch.

Record: all three present, in order, without a reload. Then scroll to the top of the list — the loading indicator must stop and stay stopped.

- [ ] **Step 3: Socket mode**

In the developer tools console, or by instrumenting `relay_socket_connect` temporarily, confirm every connection returned `native`. A single `public` means the webview opened a real `wss://` socket; that path must never be taken.

- [ ] **Step 4: Contract parity**

Capture one real-relay answer and one local answer for the same filter, and compare shapes rather than contents. `loop.localhost` resolves to loopback but nothing listens on 443, so a shell HTTP client cannot reach it: do this in a `#[tokio::test]` against `LocalBackend::http` on one side and a live community on the other, marked `#[ignore]` so it is run deliberately rather than in CI.

Every row must carry exactly `id`, `pubkey`, `created_at`, `kind`, `tags`, `content`, `sig`, with `tags` as arrays of arrays. A field the local backend adds is invisible today and breaks the client the day it validates strictly; a field it omits fails `eventsDto` immediately.

- [ ] **Step 5: Write `docs/loop-local-backend.md`**

State plainly: what runs locally (the four HTTP paths, the socket, the two agent paths), where the data lives, that the relay key sits in the same SQLite file and is the community's key rather than the user's, that nothing leaves the machine, and exactly which features are absent (uploads, media, threads, reactions, edits, search, Git, DMs, Huddles, channel creation, deletion).

Also state the one thing a reader will otherwise assume: **there is no account**, and the key created on first run is a normal Nostr key that can be backed up and later used against a real relay.

- [ ] **Step 6: Full crate verification**

Run detached, poll until done:

```powershell
cd src-tauri; cargo test --lib; cargo check --all-targets
```

Expected: every test passes. A failure that also fails on the base commit is pre-existing — confirm by stashing, and say so rather than "fixing" it.

- [ ] **Step 7: Commit**

```bash
git add docs/loop-local-backend.md
git commit -m "docs(local-backend): what runs locally and what does not"
```

---

## Self-Review

**Spec coverage.** §1 goal — Task 8 and Task 12. §2's seven seams — 1 (Tasks 1, 4, 5), 2 (out of scope, M3), 3a/3b (out of scope, M3), 4 (Task 1), 5 (Task 6), 6 (Task 11). §6.1 origin and name — Task 1. §6.2 entry points — Task 1. §6.3 HTTP contract — Tasks 1, 4, 5. §6.4 socket frames — Task 6. §6.5 relay-signed kinds — Task 7, seeded in Task 8, bounded in Task 9. §6.6 command semantics — Task 11 (v0 subset: 9000, 9001, 9021, 9022). §6.7 two first-run gates — Task 2 and Task 6's launch check. §6.8 schema — Tasks 1 and 3. §6.9 failure loudly — Task 5's 404 and tampered-body tests. §6.10 `Native` + `Sockets` — Task 6, tested directly. §6.11 out-of-contract traffic — unchanged, documented in Task 12. §7 M0 — Tasks 1–6; M0b — Task 2; M1 — Tasks 3–9; M2 — Tasks 10–11. §8 measurements — Task 11 step 6, Task 12.

Gaps, all deliberate and listed in Scope: media seams 3a/3b, upload, channel creation, deletion. §6.8's `deleted` flag is not built: kind 5 is M3, and an unused column decides nothing.

**Type consistency.** `event::Event` is the only event type crossing module lines. `filter::Filter` is the only filter type. `local_backend::Reply` is the only response type crossing into `relay.rs`, and the conversion is one `From` impl. `LocalBackend::write` is the only write door, and `deliver` rides inside it. `event::sign` keeps one signature from Task 3 through Task 11. `viewer_keys()` and `signed_message()` are defined once in Task 5 and reused unchanged in Tasks 6, 8, 9 and 11. `Session::receive` takes the query as a closure, so Task 6 does not depend on `store`.

**Line numbers.** The spec's line numbers were verified against the fork at `a58af0c6`. Re-read each site before inserting; `relay.rs` is 2,600 lines and shifts.

**Proportion.** The spec is 34 KB; this plan is 84 KB and the code it describes is roughly 3,000–4,000 lines of Rust plus its tests, so the plan is shorter than the code. Most of its bulk is test bodies, which the spec's exact values make unambiguous, and each is written once and reused.
