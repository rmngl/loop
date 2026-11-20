# Loop ↔ Paperclip feature map

Loop follows the same mental model as [Paperclip](https://paperclip.ing/): *execution runtimes are employees; Loop is the company.* We do **not** embed Paperclip; we align **product behavior** on a local-first Rust core.

Reference: [Paperclip key concepts](https://docs.paperclip.ing/guides/welcome/key-concepts/) · [GitHub README](https://github.com/paperclipai/paperclip)

## Pillar mapping

| Paperclip pillar | Loop (local v1 / v1.1) |
|----------------|------------------------|
| **Agentic task manager** — tasks, owners, review gates, threads | Tickets, single assignee, board thread + trace, **review gate** (`in_review` → board approve) |
| **Org chart for agents** — roles, reporting, governance | Hire + approvals, **`parent_agent_id` / reports-to**, budgets per agent |
| **Goal alignment** | Company mission → project goal → ticket context in `HeartbeatIn` |
| **Heartbeats** | Cron tick + assign wake + manual heartbeat via adapters |
| **Cost control** | Per-agent cap + **company monthly ceiling** (80% warn / 100% stop heartbeats) |
| **Multi-organization** | Multi-company SQLite + switcher |
| **Governance** | Hire, strategy ticket, budget increase approvals |
| **Audit** | Append-only audit log |

## Implemented in v1.1 (Paperclip-aligned)

- **Reports-to on org chart** — hire with `parent_agent_id`; API + Org UI.
- **Task review gate** — agent or board submits work → `in_review`; board **Approve done** or **Request changes**; adapter may set `HeartbeatOut.status` to `ready_for_review`.
- **Dashboard** — KPI for tickets awaiting review; **Tickets** nav badge when `in_review` > 0.
- **Company monthly budget** — `companies.monthly_budget_usd`, Budgets UI, heartbeat block when org cap exhausted.
- **Ticket reviewer** — `reviewer_agent_id`, default manager on submit-review, review heartbeat mode, assign-time override.
- **Tool gateway** — `tool_policies`, evaluate + **ask → Approvals → one-shot grant** (`tool_gateway_ask_flow` test); Governance UI.
- **Ticket reviewer** — `reviewer_agent_id`; defaults to assignee’s **Reports to** on submit; reviewer heartbeat with `context.heartbeat_mode: "review"`.
- **API tests** — `ticket_review_gate` (submit → approve done; request changes).

## Deferred (intentionally local / post-cloud)

| Paperclip | Loop stance |
|-----------|-------------|
| Tool gateway MCP proxy | Policies + evaluate + ask approvals/grants; **no MCP proxy** yet ([TOOL_GATEWAY.md](TOOL_GATEWAY.md)) |
| Skill Studio / shared skills | Adapter `skills_ref` in protocol; no studio UI |
| Sandboxed runs / secrets vault | Process adapters + OS keychain (design spec) |
| SSO / multi-human RBAC | Single local board user |
| Ready-made teams / mobile | Desktop + browser ops UI first |
| Company-wide budget beyond monthly rollup | Approval flows for org-wide cap increase (future) |

## Daily workflow (Paperclip-style)

1. **Company** — mission on Dashboard.
2. **Hire CEO** (or lead) → **Approvals** → active agent.
3. **Projects** — initiatives with goals.
4. **Tickets** — one owner (assignee), thread + trace on the work.
5. Agent heartbeat; when output is ready, **Submit for review** or adapter `ready_for_review`.
6. Board **Approvals** + ticket **Approve done** closes the loop.

See [GETTING_STARTED.md](GETTING_STARTED.md), [HERMES_E2E.md](HERMES_E2E.md), [ADAPTERS.md](ADAPTERS.md).