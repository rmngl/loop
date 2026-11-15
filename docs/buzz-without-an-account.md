# Buzz without an account

Status: patch written, tested, and built into a running desktop app.
App under test: `block/buzz-app` @ `4a87b5cc` (Buzz 1.0.2, Windows x64).

## The question

loop's first requirement is that a person can start working with an agent on
their own machine. Buzz 1.0.2 asked for a Builderlab account first. The goal was
to find the smallest change that removes that requirement without pretending the
rest of Buzz's setup went away.

## The patch

Two files, and what is in them matters less than what was already true:

**`ConnectChoice.tsx`** — "Create a new key" beside "Use an existing key", with
`onCreate` wired in `Welcome.tsx` to `setup.start([createKey(identity)])`.

**`KeyImport.tsx`** — an optional `onCreate` link, passed only when there is no
account, so the account-free lane stops being a dead end.

`identity_create` itself needed no change: it has always written a key to secure
storage with no network call and no account record.

Three things turned out not to be the blocker:

1. **The native layer never needed an account.** `identity_create` in
   `src-tauri/src/identity.rs` writes a key to secure storage and returns
   nothing else. No network call, no account record, no relay. `identity_import`
   is the same shape. Both are reachable without signing in.
2. **The account is already optional in the UI.** `Welcome.tsx` renders its
   Builderlab buttons under `{connect && …}`, and `connect` only exists when the
   build sets `VITE_BUZZ_FEDERATED_IDENTITY=1`. A build without that flag draws
   no account button at all — and then the only route to a key was **"Use an
   existing key"**, which requires having one already.
3. **The key path is not a stub.** `createKey` (`src/features/identity/setup.ts`)
   reuses an old Buzz key if one is on the device and otherwise makes a new one;
   failures fall back to a new key rather than blocking setup.

So the gate was a missing button, not a missing capability. That is why the fix
is small.

## What the built app proved

`corepack pnpm tauri build --no-bundle` produced `target/release/Buzz.exe`
(142 MB). Launched, its landing page shows exactly `Create account`, `Sign in`,
`Other options` — unchanged, as intended. Driving it with UI Automation: "Other
options" opens the community address field; a found community leads to the key
screen, which is where the new button lives.

The test suite is the stronger evidence here, because a real community address
would need a live relay, and there is none on this machine.

## Where the account-free route now lives

**Two places, because there are two first-run paths, and the first attempt only
covered one.**

The landing page is a deliberate three-button screen — `Create account`,
`Sign in`, `Other options` — and four tests pin that exact list. Adding a fourth
button there was wrong: it changed a product decision to satisfy a requirement
that belongs one step later. So the landing is untouched.

The key is created on the screens `Other options` already leads to:

1. **`ConnectChoice`** (`Connect to your community`) — shown when a typed
   community address resolves and this build's Builderlab does not host it. It
   already offered "Use an existing key"; it now also offers **"Create a new
   key"**, which calls `identity_create` and goes straight on. `onConnect` stays
   first, so an account remains the prominent path where one exists.
2. **`KeyImport`** (`Enter your private key`) — shown when the build has *no*
   Builderlab at all. This was a genuine dead end: it asked only for a key the
   user already had. It now offers **"I don't have a key — make one on this
   device"**, but only on the account-free lane, because with an account the key
   this page wants is that account's and a different one would be refused.

Tests: **230 pass** in `identity.test.tsx` (226 before this work). The new ones
prove the button exists, that clicking it creates the key, that it reaches
`Join Community`, and that no sign-in or import ran. `pnpm typecheck` passes.

## What this does not fix

**A key is not a community.** After the key exists, Buzz's first run still asks
for a relay, and `src/features/solo/workspace.ts` ties even the personal space to
`RelaySession`. `CommunityLanding` has no local-only path. So "no account" is
true after this patch, while "no server" is still false.

**The relay is not in the app.** Buzz's desktop build stages three binaries into
`src-tauri/resources/bin/`: `buzz.exe` (13.9 MB), `buzz-agent-command.exe`
(1.4 MB) and `goose-acp.exe` (19.1 MB). Reading `buzz.exe --help` settles what it
is: every one of its subcommands talks to a relay, and the only local one is
`pack` (persona packs). There is no `serve`, no `relay`, no `start`. It is a
client. `block/buzz` ships the relay as `docker-compose.yml` (Postgres + Redis)
and nothing else.

So a solo workspace would need a real relay on the user's machine, or a fourth
kind of storage that is not a Nostr event log. Both are much larger than a
button, and the second one contradicts how Buzz works: the relay is the sole
source of truth, and a signed event log is what makes approvals auditable.

## Where the fork lives

The app is 4,221 files / 63.5 MB (378k frontend lines, 61k Rust lines). Putting
it in the `loop` repo would bury loop's own 74 tests and its plugin under someone
else's tree, and `loop` would then track upstream Buzz releases, which move fast
(843 commits in 14 days when measured).

Recommended shape:

- **The fork is its own repo**, a true fork of `block/buzz-app`, carrying this
  patch as a commit on top of the release tag.
- **`loop` carries the patch file** (`docs/buzz-without-an-account.patch`,
  17 KB, applying to `4a87b5cc`) and this note. If the patch ever grows past a
  screenful, that is the signal to stop patching and keep the fork.
- **`loop.skills` stays in `loop`** and stays installable into stock Buzz, since
  it needs no Buzz source change at all.

## Building it

Three toolchain gaps on this machine, all now filled:

- Rust 1.98.1 (rustup) + MSVC BuildTools 2022, via winget.
- **CMake** — `opusic-sys` needs it to build Opus, and its absence fails the
  build with `failed to execute command: program not found`. `winget install
  Kitware.CMake` puts the binary under
  `%LOCALAPPDATA%\Microsoft\WinGet\Packages\…\cmake-4.4.4-windows-x86_64\bin`,
  which is **not on PATH** — it must be added, or cargo will not find it.
- **pnpm via corepack.** `C:\Users\grey\AppData\Local\Author Software\nvm\.nodejs\pnpm.exe`
  is a zero-byte stub that resolves first on PATH and answers `CommandNotFound`,
  which breaks Buzz's `beforeBuildCommand` chain (`node … && pnpm build`). A
  two-line `pnpm.cmd` shim calling `corepack pnpm %*`, placed first on PATH,
  fixes it without touching the repo.

Build with `corepack pnpm tauri build --no-bundle`. Building the crate with
plain `cargo build` looks like it works and produces an exe, but it skips Tauri's
release wiring, so the app tries to load the **dev** URL and shows
`ERR_CONNECTION_REFUSED` for `localhost:1430`. The `tauri` CLI is not optional.
