#!/usr/bin/env sh
# Smoke test for a deployed MarketTrader instance.
# Usage: SMOKE_BASE_URL=https://your-domain ./scripts/smoke.sh
#
# Verifies, in order:
#   1. /api/health reports status=ok
#   2. /api/auth/register issues an access token
#   3. /api/games returns a list with that token

set -eu

BASE=${SMOKE_BASE_URL:-http://localhost}

echo "→ $BASE/api/health"
HEALTH=$(curl -fsS "$BASE/api/health")
# The endpoint returns {"status":"ok","timestamp":...} — see routes/health.ts.
# This asserted '"ok":true', a shape the server has never produced, so the
# script failed at step 1 against every deployment.
printf '%s' "$HEALTH" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"' || {
  echo "health check failed: $HEALTH"
  exit 1
}

USER="smoke-$(date +%s)-$$"
PASS="smoke-test-password-1234"

echo "→ register $USER"
REGISTER=$(curl -fsS -X POST "$BASE/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}")

# Deliberately jq-free: this runs from whatever machine is at hand, and jq is
# not reliably installed (notably Git Bash on Windows). Depending on it made a
# missing jq look like a server-side "register returned no token" failure.
TOKEN=$(printf '%s' "$REGISTER" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "register returned no token: $REGISTER"
  exit 1
fi

echo "→ GET /api/games as $USER"
curl -fsS "$BASE/api/games" -H "Authorization: Bearer $TOKEN" >/dev/null

echo "smoke OK"
