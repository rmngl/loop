#!/usr/bin/env bash
# Hermes-compatible stand-in: <bin> loop-heartbeat, one HeartbeatIn line on stdin, one HeartbeatOut on stdout.
set -euo pipefail

if [[ "${1:-}" != "loop-heartbeat" ]]; then
  echo "usage: $0 loop-heartbeat" >&2
  exit 2
fi

read -r _in

printf '%s\n' '{"status":"ok","messages":["hermes-standin"],"cost":{"input_tokens":1,"output_tokens":1,"usd":0.01},"trace_events":[{"name":"hermes-standin","detail_json":{},"at":"2026-01-01T00:00:00Z"}]}'