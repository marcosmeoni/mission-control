#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${1:-http://127.0.0.1:8787}"

systemctl is-active --quiet mission-control

OPENCLAW_STATUS=$(curl -fsS "$BASE_URL/api/openclaw/status")
CONNECTED=$(python3 - <<'PY'
import json,sys
obj=json.loads(sys.stdin.read())
print('true' if obj.get('connected') else 'false')
PY
<<<"$OPENCLAW_STATUS")

if [[ "$CONNECTED" != "true" ]]; then
  echo "FAIL: mission-control up but OpenClaw disconnected"
  exit 1
fi

echo "OK: mission-control service active + OpenClaw connected"
