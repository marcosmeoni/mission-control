#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${1:-http://127.0.0.1:80}"
AUTH_USER="${MC_BASIC_AUTH_USER:-}"
AUTH_PASS="${MC_BASIC_AUTH_PASS:-}"
COOKIE_JAR="/tmp/mission-control-healthcheck.cookies"

if [[ ( -z "$AUTH_USER" || -z "$AUTH_PASS" ) && -f /root/.openclaw/workspace/projects/personal/mission-control/.env.production.local ]]; then
  # shellcheck disable=SC1091
  source /root/.openclaw/workspace/projects/personal/mission-control/.env.production.local
  AUTH_USER="${AUTH_USER:-${MC_BASIC_AUTH_USER:-}}"
  AUTH_PASS="${AUTH_PASS:-${MC_BASIC_AUTH_PASS:-}}"
fi

systemctl is-active --quiet mission-control

rm -f "$COOKIE_JAR"
if [[ -n "$AUTH_USER" && -n "$AUTH_PASS" ]]; then
  curl -fsS -c "$COOKIE_JAR" -H 'content-type: application/json' \
    -X POST "$BASE_URL/api/auth/login" \
    -d "{\"username\":\"$AUTH_USER\",\"password\":\"$AUTH_PASS\"}" >/dev/null
fi

OPENCLAW_STATUS=$(curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/openclaw/status")
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
