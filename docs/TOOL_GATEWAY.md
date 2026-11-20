# Tool gateway (stub)

Paperclip-style **allow / ask / block** for external tools (MCP, APIs). v1 stores policies, **evaluates** requests, and exposes a policy-gated **invoke stub** (no real MCP server yet).

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

## Invoke stub (adapter entry point)

```http
POST /v1/companies/{company_id}/tools/invoke
     { "tool": "mcp:deploy:prod", "agent_id": "<optional>", "input": {} }
```

When policy allows (including unused grant after ask approval), returns:

```json
{
  "status": "invoked",
  "tool": "mcp:deploy:prod",
  "disposition": "ask",
  "grant_consumed": true,
  "result": { "stub": true, "message": "MCP proxy stub — no external MCP server called" }
}
```

Denied calls return **403** (`policy denied`). Ask without grant/approval includes `approval_or_grant_required` in the error payload.

Adapters: use `loop_adapters::GatewayClient` or raw HTTP; Hermes/process get `LOOPD_URL` + company/agent ids. See [ADAPTERS.md](ADAPTERS.md). In the UI, **Governance → Tool gateway → Invoke (stub)** after Evaluate shows `allowed=true`.

`ask` and `block` append `tool_gateway_evaluate` to the audit log. Successful invokes append `tool_invoke_stub`; grants are consumed on invoke when applicable.

See [PAPERCLIP_PARITY.md](PAPERCLIP_PARITY.md).