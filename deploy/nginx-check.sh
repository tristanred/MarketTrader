#!/usr/bin/env bash
#
# Reports location blocks defined in the repo's nginx site that are missing
# from the installed one.
#
#   deploy/nginx-check.sh
#
# Why this exists: provision.sh deliberately never overwrites an existing site
# file (certbot rewrites it in place), and deploy.sh only warns about systemd
# unit drift. So an edit to deploy/nginx/markettrader.conf reaches production
# only when someone hand-applies it, and nothing otherwise notices that it
# hasn't been. A missing `location /docs` went unspotted exactly this way.
#
# Deliberately compares location directives rather than diffing whole files:
# certbot legitimately rewrites listeners, adds certificate paths and appends
# a redirect server block, so a raw diff is noise. A location present in the
# repo and absent on disk is unambiguous.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_SITE="${SCRIPT_DIR}/nginx/markettrader.conf"
INSTALLED="${1:-/etc/nginx/sites-available/markettrader}"

[ -f "$REPO_SITE" ] || { echo "repo site not found: $REPO_SITE" >&2; exit 1; }
[ -f "$INSTALLED" ] || { echo "installed site not found: $INSTALLED" >&2; exit 1; }

locations() {
  grep -oE '^[[:space:]]*location[[:space:]]+[^{]*' "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

missing=0
while IFS= read -r loc; do
  [ -n "$loc" ] || continue
  if ! locations "$INSTALLED" | grep -qxF "$loc"; then
    echo "MISSING from $INSTALLED: $loc"
    missing=$((missing + 1))
  fi
done < <(locations "$REPO_SITE")

if [ "$missing" -gt 0 ]; then
  echo
  echo "$missing location block(s) not installed."
  echo "Apply them by hand — see 'Changing the nginx site' in docs/deployment-selfhost.md."
  exit 1
fi

echo "installed site has every location block defined in the repo"
