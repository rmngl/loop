# Loop adapter protocol

Adapters receive **one line** of JSON (`HeartbeatIn`) on stdin or HTTP POST body, and return **one line** of JSON (`HeartbeatOut`).

## HeartbeatIn

```json
{
  "company_id": "uuid",
  "agent_id": "uuid",
  "role": "CEO",
  "context": {
    "mission": "…",
    "project": "Project name — goal",
    "agent_goal": null,
    "heartbeat_mode": "review",
    "loopd_url": "http://127.0.0.1:7841",
    "ticket": { "ticket_id": "uuid", "title": "…", "description": "…" }
  },
  "budget_remaining_usd": 42.5
}
```

`heartbeat_mode: "review"` is set when the designated **reviewer agent** is woken for a ticket in `in_review` (Paperclip-style review stage). The board still approves completion in the Loop UI.

`loopd_url` is the base URL for the local **tool gateway** (`POST …/tools/evaluate`, `request-use`, `invoke`, `consume`). Process and Hermes adapters also receive `LOOPD_URL`, `LOOP_COMPANY_ID`, and `LOOP_AGENT_ID` in the environment.

### Tool calls from adapters

Before calling MCP or other external tools, adapters should use the gateway (see [TOOL_GATEWAY.md](TOOL_GATEWAY.md)):

1. `POST {loopd_url}/v1/companies/{company_id}/tools/invoke` with `{ "tool": "mcp:…", "agent_id": "…", "input": {…} }` — policy-gated stub in v1 (consumes one-shot grants after ask approval).
2. Or call **evaluate** → **request-use** (board Approvals) → **invoke** → grant auto-consumed on invoke.

Rust in-repo client: `loop_adapters::GatewayClient`. Mock adapter: set `LOOP_MOCK_TOOL=mcp:mock:echo` to exercise invoke on each heartbeat.

## HeartbeatOut

`status` is usually `"ok"`. To enter a **Paperclip-style review gate**, return one of:

- `ready_for_review`
- `awaiting_review`
- `in_review`

When the assigned ticket is `in_progress`, Loop moves it to `in_review` and appends an audit event. The board completes the ticket from the UI.

```json
{
  "status": "ok",
  "messages": ["summary for ticket thread"],
  "cost": { "input_tokens": 100, "output_tokens": 50, "usd": 0.25 },
  "trace_events": [
    { "name": "tool", "detail_json": {}, "at": "2026-01-01T00:00:00Z" }
  ]
}
```

## Built-in kinds

| Kind | `adapter_config` |
|------|------------------|
| `mock` | `{}` |
| `hermes` | `{ "hermes_bin": "hermes" }` + `LOOP_*` env |
| `process` | `{ "command": "/path/bin", "args": [] }` |
| `webhook` | `{ "url": "https://…" }` POST JSON, response body = HeartbeatOut |

Test fixture: `crates/loop-adapters/tests/fixtures/echo_adapter.rs`