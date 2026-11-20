# Governance dogfood playbook

Step-through of **Paperclip-style governance** on a local Loop stack. Assumes `make dev-stack` (loopd on `127.0.0.1:7841`, UI on `http://localhost:5173`).

## 1. Boot

```bash
make verify   # optional, before you start
make dev-stack
```

Pick or create a company in the sidebar switcher.

## 2. Tool gateway — ask → Approvals → invoke

**Governance → Tool gateway**

1. Add policy: pattern `mcp:deploy:*`, disposition **ask**.
2. In **Probe**, tool name `mcp:deploy:prod` → **Evaluate** → `ask`, `allowed=false`.
3. **Request use** → note the approval id in the alert.
4. **Governance → Approvals** → approve the `tool_use` row.
5. Back on **Tool gateway** → **Evaluate** → `allowed=true`, grant id shown.
6. **Invoke (stub)** → stub JSON; grant consumed on invoke for ask policies.
7. **Evaluate** again → blocked until you request/approve again.

Adapters: set `LOOP_MOCK_TOOL=mcp:deploy:prod` with a mock agent to hit invoke on heartbeat (see [ADAPTERS.md](ADAPTERS.md)).

API reference: [TOOL_GATEWAY.md](TOOL_GATEWAY.md).

## 3. Company monthly cap — increase via Approvals

**Governance → Budgets → Company monthly ceiling**

1. Set a cap (e.g. `100`) if none — first set may apply immediately when raising from zero.
2. Enter a **higher** cap (e.g. `500`) → **Save** → alert with approval id (no immediate raise).
3. **Approvals** → approve `increase_company_budget`.
4. Refresh Budgets — cap shows the new value.
5. **Lower** or clear the cap → saves immediately (no approval).

Per-agent cap increases still use **Request budget increase** on the Budgets page (`increase_budget` approvals).

## 4. Hire and org

**Work → Org**

1. Hire an agent → stays **pending** until **Approvals** approves `create_agent`.
2. Optional **Reports to** (`parent_agent_id`) for review routing.

## 5. Ticket review gate

**Work → Tickets**

1. Assignee works ticket; adapter or board submits **Submit for review** → status `in_review`.
2. Default **reviewer** is assignee’s reports-to manager.
3. Board **Approve done** or **Request changes** from Tickets UI.
4. Reviewer may get a heartbeat with `heartbeat_mode: "review"`.

## 6. Strategy tickets

Create a ticket with strategy flag (if exposed in UI) or via API — execution blocked until a matching **strategy** approval exists (`strategy_gate` test documents API behavior).

## 7. Audit

**Governance → Audit** — look for `tool_use_requested`, `tool_use_granted`, `tool_invoke_stub`, `company_budget_increase_requested`, approval resolutions.

## 8. CI parity

```bash
make verify
```

Integration coverage: `tool_gateway_ask_flow`, `tool_invoke_proxy`, `company_budget_increase_gate`, `ticket_review_gate`, `mvp_happy_path`.

## See also

- [PAPERCLIP_PARITY.md](PAPERCLIP_PARITY.md)
- [GETTING_STARTED.md](GETTING_STARTED.md)
- [HERMES_E2E.md](HERMES_E2E.md)