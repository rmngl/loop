# Loop Desktop (Tauri)

## Prerequisites

- Rust (`rustup`)
- Node 18+ (`npm`)
- Build `loopd` once from repo root: `cargo build -p loopd`

## Development

```bash
# Repo root: build daemon
cargo build -p loopd

# Desktop shell (starts loop-ui Vite + spawns loopd)
cd apps/loop-desktop
npm install
npm run dev
```

`loopd` is spawned automatically. Override binary with `LOOPD_BIN` or data dir with `LOOP_DATA_DIR`.

## UI only (browser)

```bash
cargo run -p loopd
cd apps/loop-ui && npm install && npm run dev
# open http://localhost:5173
```

## Health

`GET http://127.0.0.1:7841/health` → `{ "ok": true }`