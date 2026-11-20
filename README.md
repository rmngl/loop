# Loop

Local-first **agent company operating system** (Rust): missions, projects, org chart, tickets, budgets, governance, heartbeats, and audit. External agents connect via adapters (mock, process, Hermes, webhook).

**v1.0 (local desktop)** — multi-company SQLite `loopd`, React ops UI, Tauri shell, hire/strategy/budget approvals, projects + ticket threads, dashboard, cron + manual heartbeats.

## Docs

- [Paperclip parity map](docs/PAPERCLIP_PARITY.md) (feature reference)
- [Getting started](docs/GETTING_STARTED.md)
- [Adapter protocol](docs/ADAPTERS.md)
- [Design spec](docs/superpowers/specs/2026-11-20-loop-agent-company-os-design.md)
- [MVP plan](docs/superpowers/plans/2026-11-20-loop-mvp.md)

## Quick start

```bash
make build && cargo run -p loopd
# another terminal:
cd apps/loop-ui && npm install && npm run dev   # http://localhost:5173
```

Desktop: `make build && cd apps/loop-desktop && npm install && npm run dev`

Dev stack (loopd + UI): `make dev-stack`

Hermes live run: [docs/HERMES_E2E.md](docs/HERMES_E2E.md)

Desktop release smoke: `make desktop-build`

## Tests

```bash
make verify
```

CI runs `make verify` on push/PR to `main`. Hermes stand-in API smoke (loopd running): `make hermes-smoke`

## Workspace layout

| Path | Role |
|------|------|
| `crates/loopd` | Localhost REST API (`127.0.0.1:7841`) |
| `crates/loop-store` | SQLite, company-scoped data |
| `crates/loop-scheduler` | Cron + ticket wakes |
| `crates/loop-adapters` | mock / process / hermes / webhook |
| `apps/loop-ui` | React operations UI |
| `apps/loop-desktop` | Tauri + `loopd` lifecycle |

## Environment

| Variable | Default |
|----------|---------|
| `LISTEN_ADDR` | `127.0.0.1:7841` |
| `LOOP_DB_PATH` | `~/.local/share/loop/loop.db` (platform-dependent) |
| `LOOPD_BIN` | `target/debug/loopd` (desktop) |
| `LOOP_HEALTH_URL` | for `scripts/health-check.sh` |