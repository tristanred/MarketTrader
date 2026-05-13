#!/usr/bin/env sh
# Smoke test for a deployed MarketTrader instance.
# Usage: SMOKE_BASE_URL=https://your-domain ./scripts/smoke.sh
#
# Verifies, in order:
#   1. /api/health returns ok=true
#   2. /api/auth/register issues an access token
#   3. /api/games returns a list with that token

set -eu

BASE=${SMOKE_BASE_URL:-http://localhost}

echo "→ $BASE/api/health"
HEALTH=$(curl -fsS "$BASE/api/health")
echo "$HEALTH" | grep -q '"ok":true' || { echo "health check failed: $HEALTH"; exit 1; }

USER="smoke-$(date +%s)-$$"
PASS="smoke-test-password-1234"

echo "→ register $USER"
REGISTER=$(curl -fsS -X POST "$BASE/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}")

TOKEN=$(echo "$REGISTER" | jq -r '.token')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "register returned no token: $REGISTER"
  exit 1
fi

echo "→ GET /api/games as $USER"
curl -fsS "$BASE/api/games" -H "Authorization: Bearer $TOKEN" >/dev/null

echo "smoke OK"
