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
{ "disposition": "block", "matched_pattern": "mcp:secrets:*", "allowed": false }
```

`ask` and `block` append `tool_gateway_evaluate` to the audit log. Adapters should call **evaluate** before invoking a tool (Hermes / process wrappers).

See [PAPERCLIP_PARITY.md](PAPERCLIP_PARITY.md).