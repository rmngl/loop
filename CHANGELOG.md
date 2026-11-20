# Changelog

## Unreleased

### Added
- **Ticket reviewer agent** (`reviewer_agent_id`, reviewer wake + `heartbeat_mode: review`)
- **Company monthly budget ceiling** (Paperclip org cap): migration, scheduler block, Budgets + Dashboard UI
- **Ticket reviewer** agent (`reviewer_agent_id`, review heartbeat, UI)
- **Tool gateway stub** (allow/ask/block policies, evaluate API, Tools UI)
- Boardroom UI (design tokens, PageHeader, KPI tiles, grouped nav)
- Paperclip-aligned org **reports-to**, ticket **review gate** (`in_review`), adapter `ready_for_review` signals
- [PAPERCLIP_PARITY.md](docs/PAPERCLIP_PARITY.md)

## 1.0.0 — 2026-11-20 (local desktop)

### Added
- Multi-company SQLite `loopd` with localhost REST API
- React ops UI: mission dashboard, projects, org, tickets (thread + trace), budgets, approvals, audit
- Tauri desktop shell with automatic `loopd` lifecycle
- Adapters: mock, process, Hermes (env), webhook (HTTP)
- Governance: hire, strategy ticket, and budget increase approvals
- Cron heartbeats (60s tick), ticket assign wake (30s debounce), monthly budget hard stop
- Company archive, mission PATCH, dashboard stats
- Docs: GETTING_STARTED, ADAPTERS, HERMES_E2E; `make verify`, `make dev-stack`, `make desktop-build`
- GitHub Actions CI (`make verify`); `scripts/hermes-standin.sh` + `make hermes-smoke`

### Fixed
- Hire flow no longer auto-approves in UI (board must use Approvals)
- API returns archived state on company resources; PATCH uses shared response mapper