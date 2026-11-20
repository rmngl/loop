# Changelog

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

### Fixed
- Hire flow no longer auto-approves in UI (board must use Approvals)
- API returns archived state on company resources; PATCH uses shared response mapper