# Hermes adapter — live E2E checklist

Use this after Loop v1 is running (`make dev-stack` or desktop). Hermes is **not** bundled; you need a Hermes-compatible binary on `PATH` or an absolute path in hire config.

## Prerequisites

- [ ] `loopd` healthy: `curl -sf http://127.0.0.1:7841/health`
- [ ] Hermes (or stand-in) installed; note full path if not on `PATH`
- [ ] Stand-in implements: argv `loop-heartbeat`, reads **one** NDJSON `HeartbeatIn` line on stdin, writes **one** `HeartbeatOut` line on stdout (same as [ADAPTERS.md](ADAPTERS.md))

## Environment (set by Loop)

On each heartbeat, Hermes adapter runs roughly:

```text
<hermes_bin> loop-heartbeat
```

With env:

| Variable | Content |
|----------|---------|
| `LOOP_AGENT` | `1` |
| `LOOP_COMPANY_ID` | UUID |
| `LOOP_AGENT_ID` | UUID |
| `LOOP_TICKET_CONTEXT` | JSON heartbeat context (when present) |

Stdin is the full `HeartbeatIn` JSON (one line).

## UI flow

1. [ ] Create company (Mission → **Create company**)
2. [ ] **Org chart** → hire agent:
   - Adapter: `hermes`
   - Hermes binary: e.g. `hermes` or `/opt/homebrew/bin/hermes`
   - Cron: `*/5 * * * *` (or manual heartbeat only)
3. [ ] **Approvals** → approve **create_agent** (Org no longer auto-approves)
4. [ ] Confirm agent status **active** on Org chart
5. [ ] Create ticket → assign to Hermes agent
6. [ ] **Heartbeat** (manual) or wait for cron tick (~60s scheduler)
7. [ ] **Tickets** → **Trace** shows adapter output / spend
8. [ ] **Audit** contains heartbeat-related events

## API smoke (optional)

```bash
COMPANY_ID=<uuid>
# After hire + approve, get AGENT_ID from GET /v1/companies/$COMPANY_ID/agents
curl -s -X POST "http://127.0.0.1:7841/v1/companies/$COMPANY_ID/agents/$AGENT_ID/heartbeat"
```

Expect HTTP 200 and trace persisted (check ticket trace in UI or store).

## Stand-in for CI / no Hermes install

Use the echo fixture pattern from `crates/loop-adapters/tests/fixtures/echo_adapter.rs` as a `process` adapter, or wrap it in a shell script named `hermes` that handles `loop-heartbeat`.

## Failure modes

| Symptom | Check |
|---------|--------|
| Hire stuck pending | Approvals tab |
| Heartbeat 4xx/5xx | Agent paused (budget?), archived company, adapter exit code |
| Empty trace | stdout not valid `HeartbeatOut` JSON |
| Binary not found | `hermes_bin` path in hire `adapter_config` |