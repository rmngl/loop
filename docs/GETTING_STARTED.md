# Getting started with Loop

Loop is a **local agent company OS**: you run companies of AI agents with missions, projects, org chart, tickets, budgets, approvals, and audit—all on your machine.

## Prerequisites

- Rust (rustup stable)
- Node.js 18+ (for the UI)
- Optional: Hermes or any adapter that speaks the [adapter protocol](ADAPTERS.md)

## Quick start (browser)

```bash
# From repo root
cargo build -p loopd
cargo run -p loopd
# In another terminal
cd apps/loop-ui && npm install && npm run dev
# Open http://localhost:5173
```

One-shot dev (builds loopd, starts daemon, opens UI):

```bash
make dev-stack
```

Health: `curl http://127.0.0.1:7841/health` → `{"ok":true}`

## Quick start (desktop)

```bash
cargo build -p loopd
cd apps/loop-desktop && npm install && npm run dev
```

Tauri starts Vite on port 5173 and spawns `loopd` (or reuses one already listening on `7841`).

Data directory default: `~/Library/Application Support/loop/` (macOS) via `dirs::data_dir()/loop`.

Override with `LOOP_DB_PATH`, `LOOP_DATA_DIR`, `LOOPD_BIN`, `LISTEN_ADDR`.

## First company (UI walkthrough)

1. **Mission** — Create a company with a mission statement. Dashboard shows agents, budget alerts, pending approvals, open tickets.
2. **Projects** — Add initiatives; link tickets to projects so heartbeats include project goal context.
3. **Org chart** — Hire an agent (mock for testing; hermes/process/webhook for real runs). Approve the hire under **Approvals** (required; Org does not auto-approve). Hermes live steps: [HERMES_E2E.md](HERMES_E2E.md).
4. **Tickets** — Create work items, optionally tag **strategy** (requires approval before assign). Assign to an active agent; post **Board** messages; inspect **Trace** after heartbeat.
5. **Budgets** — Monthly caps per agent; 80% warn, 100% hard stop. Request a cap increase → approve on **Approvals**.
6. **Audit** — Append-only log of governance and system events.

## Heartbeats

- **Cron** — Set per agent (e.g. `0 */4 * * *`). `loopd` runs a 60s scheduler tick.
- **Manual** — Org chart → **Heartbeat** on an active agent.
- **Ticket assign** — Wakes assignee (30s debounce).

## Adapters

| Kind | Use case |
|------|----------|
| `mock` | Local testing ($0.25 fake spend per beat) |
| `process` | Any stdin/stdout JSON script |
| `hermes` | Hermes CLI with `LOOP_*` env |
| `webhook` | HTTP POST JSON to your URL |

See [ADAPTERS.md](ADAPTERS.md) for wire format.

## Multi-company

Use the **company switcher** in the sidebar. Companies are isolated in SQLite (data, agents, secrets workspaces under `companies/{id}/workspace`).

## Verification

```bash
make test          # cargo test --workspace (12 integration tests)
cd apps/loop-ui && npm test && npm run build
make health        # loopd health script
```

## What's not in v1

Cloud sync, Postgres, team RBAC, mobile—see approved [design spec](superpowers/specs/2026-11-20-loop-agent-company-os-design.md) non-goals.