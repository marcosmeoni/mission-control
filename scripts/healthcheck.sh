#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${1:-http://127.0.0.1:8787}"

systemctl is-active --quiet mission-control

OPENCLAW_STATUS=$(curl -fsS "$BASE_URL/api/openclaw/status")
CONNECTED=$(OPENCLAW_STATUS="$OPENCLAW_STATUS" python3 - <<'PY'
import json,os
obj=json.loads(os.environ['OPENCLAW_STATUS'])
print('true' if obj.get('connected') else 'false')
PY
)

if [[ "$CONNECTED" != "true" ]]; then
  echo "FAIL: mission-control up but OpenClaw disconnected"
  exit 1
fi

echo "OK: mission-control service active + OpenClaw connected"
