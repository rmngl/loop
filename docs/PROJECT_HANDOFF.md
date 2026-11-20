# Loop — project handoff (local v1.1)

**Last updated:** 2026-11-20  
**Repo:** `https://github.com/rmngl/loop.git`  
**Branch:** `main` (latest: see `git log -5`)

이 문서는 다른 PC에서 이어서 작업하기 위한 **현황·결정·다음 작업** 요약입니다.

---

## Product goal

**Loop** = local-first **agent company OS** (Rust core + React/Tauri UI).

- Paperclip을 **임베드하지 않고** 동작·거버넌스를 **로컬에서** 맞춤 ([PAPERCLIP_PARITY.md](PAPERCLIP_PARITY.md)).
- **Hermes** 등 실행 런타임은 adapter로 붙임 (v1에서 Rust로 Hermes 재구현 안 함).
- **Multi-company MVP**부터 (`company_id` 격리).
- **Cloud / sync / Postgres**는 로컬 기능이 충분해질 때까지 **의도적 보류** (사용자 합의).

---

## Stack & run (다른 PC)

### Prerequisites

- Rust (see `rust-toolchain.toml`; Makefile uses stable aarch64 on macOS)
- Node 18+

### Clone & verify

```bash
git clone https://github.com/rmngl/loop.git
cd loop
git pull origin main
make verify          # workspace Rust tests + UI test + UI build
```

### Dev

```bash
make dev-stack       # loopd 127.0.0.1:7841 + UI http://localhost:5173
# or
cargo run -p loopd
cd apps/loop-ui && npm install && npm run dev
```

### Env (optional)

| Variable | Default |
|----------|---------|
| `LISTEN_ADDR` | `127.0.0.1:7841` |
| `LOOP_DB_PATH` | platform data dir |
| `LOOPD_URL` | `http://127.0.0.1:7841` (scheduler → heartbeat) |
| `LOOP_MOCK_TOOL` | mock adapter가 heartbeat마다 `tools/invoke` 시도 |

### Paths

- Migrations: `migrations/001_init.sql` … **`005_tool_use_grants.sql`**
- CI: `.github/workflows/ci.yml` → `make verify`

---

## Architecture snapshot

| Layer | Crates / apps |
|-------|----------------|
| Core | `loop-core` (domain, adapter JSON protocol) |
| Store | `loop-store` (SQLite, repos) |
| Policy | `loop-policy` (`ToolGateway`, gates) |
| Scheduler | `loop-scheduler` (cron, wake, budget/company cap) |
| Adapters | `loop-adapters` (`GatewayClient`, mock/process/hermes/webhook) |
| API | `loopd` (Axum, loopback only) |
| UI | `apps/loop-ui`, `apps/loop-desktop` (Tauri 2) |

**Approach A:** Rust OS + adapters; governance/UI/API는 Loop, 실행은 Hermes/process.

---

## Completed work (summary)

### v1.0.0 (tag `v1.0.0`)

- Multi-company `loopd`, projects/tickets/org/budgets/approvals/audit UI
- Tauri desktop, adapters (mock/process/hermes/webhook)
- `make verify`, `make dev-stack`, Hermes stand-in smoke

### v1.1 Paperclip-aligned (main, post-1.0.0)

| Area | What |
|------|------|
| **Boardroom UI** | tokens, PageHeader, KPI, grouped nav, approval/review badges |
| **Org** | `parent_agent_id` (reports-to); hire → **Approvals** (no auto-approve) |
| **Tickets** | `in_review`, submit-review / approve-done / request-changes; `reviewer_agent_id`, review heartbeat |
| **Budget** | company `monthly_budget_usd`, scheduler org cap; agent 80%/100% caps |
| **Company cap governance** | **상향만** Approvals (`increase_company_budget`); PATCH로 하향/초기화 즉시 |
| **Tool gateway** | policies allow/ask/block; evaluate; ask → `tool_use` Approvals → **one-shot grant** |
| **Tool invoke** | `POST …/tools/invoke` **stub** (실 MCP 없음); grant consume on invoke |
| **Adapters** | `HeartbeatContext.loopd_url`; `LOOPD_URL` / company·agent env; `GatewayClient` |
| **Docs** | `TOOL_GATEWAY`, `GOVERNANCE_DOGFOOD`, `PAPERCLIP_PARITY`, `ADAPTERS` |
| **UI** | Tools: Evaluate / Request use / Consume / **Invoke (stub)**; Approvals payload formatting |

### Recent commits (reference)

```
c840dfd Governance dogfood + Tools invoke probe
2239410 Tool invoke stub + GatewayClient wiring
37e49f2 Company monthly budget increase gate
2ce7ced Tool gateway ask → Approvals → grants
890481e Ticket reviewer + tool gateway policies
```

### Integration tests (loopd)

- `mvp_happy_path`, `strategy_gate`, `ticket_review_gate`, `ticket_reviewer`
- `tool_gateway`, `tool_gateway_ask_flow`, `tool_invoke_proxy`
- `company_budget_increase_gate`

---

## API cheat sheet (governance / tools)

Base: `http://127.0.0.1:7841/v1/companies/{company_id}`

- Approvals: `GET …/approvals`, `POST …/approvals/{id}/approve`
- Agent budget increase: `POST …/agents/{agent_id}/budget-increase`
- **Company cap increase:** `POST …/company-budget-increase` (PATCH company로 상향 불가)
- Tools: `…/tool-policies`, `…/tools/evaluate`, `request-use`, `consume`, **`invoke`**

Manual walkthrough: [GOVERNANCE_DOGFOOD.md](GOVERNANCE_DOGFOOD.md).

---

## Known gaps / non-goals (current)

**Not built yet**

1. **Real MCP proxy** — invoke returns stub JSON only
2. **Approval reject** — approve only; no reject/deny API in UI
3. **Hermes live** — documented in `HERMES_E2E.md`; stand-in in `scripts/hermes-e2e-smoke.sh`
4. **macOS DMG** — `Loop.app` builds; DMG/`hdiutil` may need retry on some machines
5. **Cloud**, Postgres, multi-human RBAC, Skill Studio, secrets vault

**Minor / tech debt**

- `ApprovalStatus` unused warning in `loop-store`
- `PAPERCLIP_PARITY.md` has duplicate “ticket reviewer” bullets (cosmetic)

---

## Recommended next work (priority)

User preference: assistant **sequences and implements** unless directed otherwise.

| Priority | Task | Rationale |
|----------|------|-----------|
| **P1** | Wire **real MCP** (or configurable backend) behind `tools/invoke` | Closes execution loop; stub is done |
| **P2** | **Reject approval** API + Approvals UI | Completes board queue |
| **P3** | Hermes **live** path + extend `make hermes-smoke` with tool gateway | Dogfood with real agent |
| **P4** | CI **Loop.app** artifact / fix DMG packaging | Release hygiene |
| **P5** | Optional: v1.1 **git tag** + GitHub Release notes aggregating CHANGELOG Unreleased | Shipping marker |

**Intentionally later:** cloud sync, SSO, skill studio, company-wide budget beyond monthly rollup (parity doc “future”).

---

## Key decisions (do not regress)

1. Hire/strategy/budget/tool_use/company cap **increase** → **Approvals** required
2. Company archive exposed in API; switcher hides archived
3. Tool **ask**: one unused grant per (company, tool, optional agent); consumed on **invoke** or explicit **consume**
4. `loopd` **loopback only** for v1
5. Commits/push only when requested (this handoff doc pushed per user request)

---

## Where to read more

- [GETTING_STARTED.md](GETTING_STARTED.md)
- [PAPERCLIP_PARITY.md](PAPERCLIP_PARITY.md)
- [TOOL_GATEWAY.md](TOOL_GATEWAY.md)
- [ADAPTERS.md](ADAPTERS.md)
- Design: [specs/2026-11-20-loop-agent-company-os-design.md](superpowers/specs/2026-11-20-loop-agent-company-os-design.md)

---

## Session checklist (new machine)

```bash
git pull origin main
rustup show
make verify
make dev-stack
# Open GOVERNANCE_DOGFOOD.md and run sections 2–3 once
```

Questions or drift: update **this file** + `CHANGELOG.md` on the next meaningful milestone.