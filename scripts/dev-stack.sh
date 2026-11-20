#!/usr/bin/env bash
# Start loopd and the Vite UI (browser workflow). Run from repo root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.rustup/toolchains/stable-aarch64-apple-darwin/bin:${HOME}/.rustup/toolchains/1.98.1-aarch64-apple-darwin/bin:${PATH:-}"
export LISTEN_ADDR="${LISTEN_ADDR:-127.0.0.1:7841}"

cd "$ROOT"
if ! cargo build -q -p loopd; then
  echo "loopd build failed"
  exit 1
fi

HEALTH="http://${LISTEN_ADDR}/health"
if ! curl -sf "$HEALTH" >/dev/null 2>&1; then
  cargo run -q -p loopd &
  LOOPD_PID=$!
  trap 'kill "$LOOPD_PID" 2>/dev/null || true' EXIT
  for _ in {1..40}; do
    if curl -sf "$HEALTH" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
fi

cd "$ROOT/apps/loop-ui"
npm run dev