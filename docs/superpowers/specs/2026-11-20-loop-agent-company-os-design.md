# Loop — Agent Company Operating System

**Date:** 2026-11-20  
**Status:** Approved (2026-11-20)  
**Repo:** `/Users/giljaejoo/workspaces/loop`

## Intent and why

**Loop** is a **local-first desktop application** for running a *company* of AI agents: goals, org chart, tickets, budgets, governance, heartbeats, and audit—not a single chat window.

The mental model matches Paperclip: *“OpenClaw is an employee; Loop is the company.”* Execution engines (Hermes, Claude Code, Cursor, Codex, shell, HTTP) are **hired** via adapters; Loop owns **company state and policy**.

Hermes contributes the *pattern* of durable execution (skills, memory, gateway, subagents, cron, MCP) but **v1 does not reimplement Hermes in Rust**. Hermes and peers are **external runtimes** connected through a stable adapter contract.

**Why now:** Operators already run many agent sessions in parallel and lose alignment on mission, cost, and accountability. A Rust core prioritizes reliability, single-binary deployment, and a path to hosted “Loop Cloud” without rewriting the product model.

## Goals

- Run **multiple companies** locally from MVP with **strict isolation** (data, agents, secrets, workspaces); no cloud account required for core use.
- **Goal → project → agent goal → ticket** hierarchy with full traceability.
- **Org chart:** roles, reporting, delegation, board approval gates (e.g. hire agent, strategy).
- **Heartbeats:** schedule wakes; task assignment and @-mentions wake agents via adapters.
- **Budgets:** per-agent monthly caps; hard stop at 100%; warn at 80%.
- **Immutable audit log** for tickets, tool traces, governance actions.
- **Bring-your-own-agent:** pluggable adapters; Hermes as first-class reference adapter.
- **Rust** implementation for core daemon + desktop shell (see constraints).
- Architecture that allows **optional sync / hosted control plane** later (paid tier).

## Non-goals (v1)

- Full Hermes feature parity (learning loop, Honcho, all messaging platforms, all terminal backends).
- Replacing Jira/Linear as generic PM; tickets are agent-centric with traces, not generic issue tracking.
- Multi-tenant SaaS implementation in v1 (only **design hooks**).
- Mobile-first UX (desktop first; responsive web UI inside shell is fine).

## Anti-goals

- Becoming “yet another agent CLI” without org, budget, and governance.
- Embedding a specific LLM vendor as the only runtime.
- Silent cross-company data leakage in multi-company mode.
- Unbounded agent spend without board-visible enforcement.

## Constraints

- **Local desktop first:** macOS primary; Linux second; Windows as stretch unless Tauri path is trivial.
- **Rust** for: persistence, scheduler, policy engine, adapter host, API server, audit.
- **UI:** Tauri 2 + web frontend (recommended for Linear-like ops UX velocity). Builder may adjust component library if documented.
- **Storage:** embedded SQL (SQLite) for v1; migration path to Postgres for cloud/multi-user.
- **Secrets:** OS keychain where available; scoped per company/agent.
- **License:** MIT (matches repo).

## Approaches considered

| Approach | Summary | Why not (or why yes) |
|----------|---------|----------------------|
| **A — Rust core OS + adapters** | Loop owns company model; agents are external via heartbeat/API | **Chosen:** matches product identity and Rust requirement |
| B — Rust shell + embed Paperclip/Hermes | Faster parity, thinner Rust | Rejected: weak “Rust product” story, fork debt |
| C — Full Rust reimplementation incl. agent runtime | Single binary, max control | Rejected for v1: multi-quarter scope, distracts from “company OS” |

**User decisions (2026-11-20):**

- Approach **A** — Rust core OS + adapters.
- **Multi-company in MVP** — multiple isolated companies from day one (separate DB namespaces, workspace roots, secrets, budgets; company switcher in UI).

## High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Loop Desktop (Tauri)                                       │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Web UI: missions, org, tickets, budgets, audit     │  │
│  └──────────────────────────┬──────────────────────────┘  │
└─────────────────────────────┼──────────────────────────────┘
                              │ local IPC / HTTP (127.0.0.1)
┌─────────────────────────────▼──────────────────────────────┐
│  loopd (Rust) — Company OS core                             │
│  • Company / org / ticket / budget / governance stores      │
│  • Heartbeat scheduler + wake queue                         │
│  • Policy engine (approvals, spend caps, RBAC)              │
│  • Adapter registry + heartbeat dispatcher                │
│  • Cost ingestion (token $ from adapter reports)            │
│  • Audit append-only log                                    │
└─────────────────────────────┬──────────────────────────────┘
                              │ adapter protocol
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   Hermes adapter      Cursor/CLI adapter    HTTP webhook adapter
   (subprocess)         (subprocess)            (optional)
```

### Process model

- **One `loopd` per user session** (auto-started by desktop app).
- Adapters run as **managed child processes** or **user-configured commands**; Loop never executes arbitrary shell without policy + allowlist.
- **Companies** are isolated namespaces in DB + filesystem roots for agent workspaces.

## Domain model (v1)

| Entity | Purpose |
|--------|---------|
| **Company** | Top-level tenant; mission statement; board user |
| **Goal** | Company mission KPI (e.g. MRR target) — informational + alignment |
| **Project** | Scoped initiative under company |
| **Role / Agent** | Org chart node; adapter type, model config ref, budget, heartbeat cron |
| **Ticket** | Unit of work; status; assignee agent; threaded messages |
| **TraceEvent** | Tool calls, adapter events, linked to ticket |
| **BudgetPeriod** | Monthly cap per agent; usage rollup |
| **Approval** | Pending board actions (hire, strategy, budget override) |
| **AuditEntry** | Append-only governance + system events |

**Alignment chain:** Company mission → Project goal → Agent goal (optional) → Ticket title/description injected into adapter wake payload.

## Adapter protocol (v1 sketch)

Adapters implement a **small JSON contract** over stdin/stdout or local HTTP:

1. **HeartbeatIn:** `{ company_id, agent_id, role, context: { mission, project, ticket? }, budget_remaining_usd, skills_ref? }`
2. **HeartbeatOut:** `{ status, messages[], cost: { input_tokens, output_tokens, usd }, trace_events[] }`
3. **Capabilities:** `heartbeat`, `assign_ticket`, `shutdown`

Loop ships:

- **`adapter-hermes`:** invokes `hermes` CLI or documented RPC with env + cwd; maps traces to `TraceEvent`.
- **`adapter-process`:** generic wrapper for `command + args` (Codex, claude, custom script).

Discovery: agents stored in DB with `adapter_kind` + `adapter_config` (JSON).

## Heartbeat and wake rules

- **Cron** per agent (e.g. `0 */4 * * *`) enqueues heartbeat jobs.
- **Ticket assigned** or **board message** wakes assignee immediately (coalesced within debounce window, e.g. 30s).
- **Budget exhausted:** skip wake; surface board notification; optional override approval type.
- **Delegation:** agent may request sub-ticket creation via structured out-message; Loop validates against role permissions (v1: board-only or template roles).

## Governance (v1 minimum)

- Board is local OS user (single-user desktop); no multi-human RBAC in v1.
- Default gates: **create agent**, **increase budget**, **execute “strategy” class tickets** (tag-based).
- All gate resolutions → `AuditEntry`.

## UI (v1 screens)

1. **Home / Mission** — **company switcher** (create/rename/archive company), mission, health (agents paused, budget alerts). No cross-company agent or ticket views in v1.
2. **Org chart** — hire wizard (adapter pick, budget, heartbeat).
3. **Tickets** — list/board; detail with thread + trace sidebar.
4. **Budgets** — per-agent and total.
5. **Audit** — read-only stream with filters.

## Cloud / monetization hooks (design only)

- **Local authoritative** data; optional `loop sync` later pushes encrypted backups or replicas to hosted project.
- Paid tier concepts: hosted `loopd`, team RBAC, shared companies, managed adapters, usage billing—not implemented in v1.
- API boundaries (`loopd` REST/gRPC on localhost) kept stable for future remote proxy.

## Security

- Bind services to `127.0.0.1` only in v1.
- Adapter commands from allowlisted templates; user custom commands flagged “trusted installer” in settings.
- No telemetry by default; opt-in diagnostics later.

## Success criteria (MVP)

- User can:create company → set mission → hire Hermes-backed CEO → create ticket → heartbeat runs → ticket updates with trace → budget decrements → agent pauses at cap.
- Second company runs with **no shared agent state**.
- Audit log reconstructs a ticket’s decision path.

## What's left to the builder

- Exact crate layout (`loop-core`, `loopd`, `loop-desktop`, `loop-adapters`).
- SQL schema migrations tool (`sqlx` / `refinery`).
- Frontend stack choice (React vs Svelte) inside Tauri.
- Hermes adapter mapping details (read Hermes docs for stable invoke surface).
- Windows support timeline.
- Icon/branding.

## Builder check (self-review)

Questions that would change the plan if guessed wrong:

1. **Multi-company in MVP?** — **Resolved: yes** (partner, 2026-11-20).
2. **Tauri + web vs native UI only?** — Design assumes Tauri + web (builder call unless partner overrides).
3. **Is Hermes the only v1 adapter?** — Plan assumes Hermes + generic process adapter (builder call unless partner overrides).

## Approval

Approved 2026-11-20 (Approach A, multi-company MVP, Tauri + web, Hermes + process adapters). Implementation plan: `docs/superpowers/plans/2026-11-20-loop-mvp.md`.