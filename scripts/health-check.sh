#!/usr/bin/env bash
set -euo pipefail
HOST="${LOOP_HEALTH_URL:-http://127.0.0.1:7841/health}"
curl -sf "$HOST" | grep -q '"ok"' && echo "loopd healthy"