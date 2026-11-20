# Tool gateway (stub)

Paperclip-style **allow / ask / block** for external tools (MCP, APIs). v1 stores policies and **evaluates** requests; it does not proxy tool calls yet.

## Patterns

- Exact: `mcp:github:create_pr`
- Prefix wildcard: `mcp:secrets:*` matches any tool name starting with that prefix
- No matching policy → **allow**

When multiple patterns match, **block** beats **ask** beats **allow**; longer patterns break ties.

## API

```http
GET  /v1/companies/{company_id}/tool-policies
POST /v1/companies/{company_id}/tool-policies
     { "tool_pattern": "mcp:secrets:*", "disposition": "block" }
POST /v1/companies/{company_id}/tool-policies/remove
     { "tool_pattern": "mcp:secrets:*" }
POST /v1/companies/{company_id}/tools/evaluate
     { "tool": "mcp:secrets:read", "agent_id": "<optional>" }
```

Evaluate response:

```json
{
  "disposition": "ask",
  "matched_pattern": "mcp:deploy:*",
  "allowed": false,
  "grant_id": null,
  "pending_approval_id": null
}
```

For **`ask`**: `allowed` is true only when an unused **grant** exists (after board approval). Otherwise `pending_approval_id` is set when a request is already in the Approvals queue.

## Ask → Approvals → one-shot grant

```http
POST /v1/companies/{company_id}/tools/request-use
     { "tool": "mcp:deploy:prod", "agent_id": "<optional>" }
```

Response: `{ "status": "pending", "approval_id": "..." }` (or `already_granted` / `allowed`).

Board approves via `POST .../approvals/{approval_id}/approve` → creates a row in `tool_use_grants`.

Re-evaluate → `allowed: true` with `grant_id`. After the tool runs:

```http
POST /v1/companies/{company_id}/tools/consume
     { "grant_id": "..." }
```

`ask` and `block` append `tool_gateway_evaluate` to the audit log. Adapters should call **evaluate** before invoking a tool, **request-use** when `ask` and not allowed, and **consume** after a successful invocation.

See [PAPERCLIP_PARITY.md](PAPERCLIP_PARITY.md).