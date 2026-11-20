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
    "ticket": { "ticket_id": "uuid", "title": "…", "description": "…" }
  },
  "budget_remaining_usd": 42.5
}
```

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