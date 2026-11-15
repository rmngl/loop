# Buzz without an account

Status: patch written and tested; desktop build in progress.
App under test: `block/buzz-app` @ `4a87b5cc` (Buzz 1.0.2, Windows x64).

## The question

loop's first requirement is that a person can start working with an agent on
their own machine. Buzz 1.0.2 asked for a Builderlab account first. The goal was
to find the smallest change that removes that requirement without pretending the
rest of Buzz's setup went away.

## What was already true

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

So the gate was a missing button, not a missing capability. That is the whole
reason this is a 14-line patch.

## The patch

`src/features/identity/Welcome.tsx`, one block, rendered only when the build has
no account to offer and no key is already present:

```tsx
{!connect && !keyLanding && (
  <Button
    data-first-run-local-key
    variant="prominent"
    size="lg"
    onClick={() => void setup.start([createKey(identity)])}
  >
    Continue without an account
  </Button>
)}
```

Two tests, both passing:

- **A build with no Builderlab** shows the button; clicking it calls
  `identity_create`, lifts the identity gate, and rests at "Connect to a
  community". Reaching that page is the proof: only a saved key leaves Welcome.
- **A build with Builderlab** keeps its account landing and hides the button, so
  nobody signs up by accident and skips their backup.

`identity.test.tsx`: 228 tests pass (226 existing + 2 new). `pnpm typecheck`
passes.

## What this does not fix

**A key is not a community.** After the key exists, Buzz's first run still asks
for a relay, and `src/features/solo/workspace.ts` ties even the personal space to
`RelaySession`. `CommunityLanding` has no local-only path. So "no account" is
true after this patch, while "no server" is still false.

That is a bigger change than a button: a solo workspace would need storage that
is not a relay channel, and every feature that reads from `client.memberships`
would need a local case. It is not in this patch and should not be smuggled in.

## Where the fork lives

The app is 4,221 files / 63.5 MB (378k frontend lines, 61k Rust lines). Putting
it in the `loop` repo would bury loop's own 74 tests and its plugin under someone
else's tree, and `loop` would then track upstream Buzz releases, which move fast
(843 commits in 14 days when measured).

Recommended shape:

- **The fork is its own repo**, a true fork of `block/buzz-app`, carrying this
  patch as a commit on top of the release tag.
- **`loop` carries the patch file** (`.scratch-buzz-no-account.patch` today) and
  a note saying which upstream commit it applies to. If the patch ever grows
  past a screenful, that is the signal to stop patching and keep the fork.
- **`loop.skills` stays in `loop`** and stays installable into stock Buzz, since
  it needs no Buzz source change at all.

## Building it

Two toolchain gaps on this machine, both now filled:

- Rust 1.98.1 + MSVC BuildTools 2022 via winget.
- pnpm via corepack. Note: `C:\Users\grey\AppData\Local\Author Software\nvm\.nodejs\pnpm.exe`
  is a zero-byte stub that resolves first on PATH and answers `CommandNotFound`,
  which breaks Buzz's `beforeBuildCommand` chain. Use `corepack pnpm …`, and call
  `vite build` directly rather than through the `pnpm build` script.
