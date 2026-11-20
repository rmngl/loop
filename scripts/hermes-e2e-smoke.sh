#!/usr/bin/env bash
# API smoke: hire Hermes stand-in agent, approve, manual heartbeat. Requires loopd on LISTEN_ADDR.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STANDIN="$ROOT/scripts/hermes-standin.sh"
BASE="${LOOP_API:-http://127.0.0.1:7841}"

if [[ ! -x "$STANDIN" ]]; then
  chmod +x "$STANDIN"
fi

if ! curl -sf "$BASE/health" >/dev/null; then
  echo "loopd not healthy at $BASE — start with: cargo run -p loopd" >&2
  exit 1
fi

json_field() {
  python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"
}

company="$(curl -sf -X POST "$BASE/v1/companies" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Hermes smoke","mission":"E2E"}')"
company_id="$(echo "$company" | json_field id)"

standin_json="$(python3 -c "import json; print(json.dumps('$STANDIN'))")"
hire="$(curl -sf -X POST "$BASE/v1/companies/$company_id/agents" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Hermes bot\",\"adapter_kind\":\"hermes\",\"cron\":\"0 0 1 1 *\",\"monthly_budget_usd\":10,\"adapter_config\":{\"hermes_bin\":$standin_json}}")"
approval_id="$(echo "$hire" | json_field approval_id)"
agent_id="$(echo "$hire" | json_field agent_id)"

if [[ -z "$approval_id" ]]; then
  echo "hire failed: $hire" >&2
  exit 1
fi

curl -sf -X POST "$BASE/v1/companies/$company_id/approvals/$approval_id/approve" >/dev/null

curl -sf -X POST "$BASE/v1/companies/$company_id/agents/$agent_id/heartbeat" >/dev/null

echo "hermes-e2e-smoke ok (company=$company_id agent=$agent_id)"