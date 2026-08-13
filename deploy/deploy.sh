#!/usr/bin/env bash
#
# Server-side deploy. Invoked over SSH by scripts/ship.mjs (`pnpm ship`).
#
#   deploy/deploy.sh [git-ref]      # default: origin/main
#
# Runs as the login user, who is a member of the `markettrader` group. Only
# two privileged operations are needed, both covered by a narrow NOPASSWD
# sudoers rule installed by provision.sh: restarting the unit, and running the
# backup as the service user.

set -euo pipefail

REF="${1:-origin/main}"
APP_DIR="${MARKETTRADER_APP_DIR:-/opt/markettrader}"
WEB_ROOT="${MARKETTRADER_WEB_ROOT:-/var/www/markettrader}"
SERVICE=markettrader
HEALTH_URL=http://127.0.0.1:3000/health
HEALTH_TIMEOUT=30

log() { echo "[deploy] $*"; }
die() { echo "[deploy] ERROR: $*" >&2; exit 1; }

cd "$APP_DIR" || die "app directory not found: $APP_DIR"

# pnpm skips devDependencies when NODE_ENV=production, and tsup/vite/typescript
# are all devDependencies — the build would fail with a confusing "command not
# found". Only the systemd unit sets NODE_ENV=production, for the runtime.
unset NODE_ENV

# systemd units are installed by provision.sh, never by a deploy, so editing
# them in the repo has no effect until provision.sh is re-run. A stale unit
# also can't be fixed by the automatic rollback below, since the unit is
# identical at every commit — surface the drift instead of leaving someone to
# infer it from a crash loop.
warn_on_unit_drift() {
  local unit
  for unit in markettrader.service markettrader-backup.service markettrader-backup.timer; do
    if [ -f "/etc/systemd/system/$unit" ] &&
       ! cmp -s "$APP_DIR/deploy/systemd/$unit" "/etc/systemd/system/$unit"; then
      log "WARNING: $unit differs from the installed copy"
      log "         re-run provision.sh to apply it"
    fi
  done
}

wait_for_health() {
  for _ in $(seq 1 "$HEALTH_TIMEOUT"); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

build_and_restart() {
  log "installing dependencies"
  pnpm install --frozen-lockfile

  log "building"
  pnpm build:shared
  pnpm --filter server build
  pnpm --filter frontend build

  # Publish the SPA only after a successful build, and in one rsync pass, so
  # nginx never serves a half-written bundle.
  log "publishing frontend to $WEB_ROOT"
  rsync -a --delete packages/frontend/dist/ "$WEB_ROOT/"

  log "restarting $SERVICE"
  sudo systemctl restart "$SERVICE"
}

PREVIOUS_SHA="$(git rev-parse HEAD)"
log "currently deployed: $PREVIOUS_SHA"

log "fetching $REF"
git fetch --all --tags --prune
git checkout --detach "$REF"
TARGET_SHA="$(git rev-parse HEAD)"
log "deploying $TARGET_SHA ($(git log -1 --pretty=%s))"

# The safety net for a bad migration. Taken as the service user so the DB and
# its WAL keep consistent ownership.
#
# Deliberately after the checkout: nothing before the restart touches the
# database (migrations run at boot), so the snapshot is still taken before
# anything can damage it. Running it beforehand meant the OLD backup.sh
# executed, so a bug in that script blocked every future deploy including the
# one carrying its fix.
warn_on_unit_drift

log "taking pre-deploy backup"
sudo -u markettrader "$APP_DIR/deploy/backup.sh" predeploy "${PREVIOUS_SHA:0:7}"

if [ "$TARGET_SHA" = "$PREVIOUS_SHA" ]; then
  log "note: target matches what's already deployed; rebuilding anyway"
fi

# Migrations run automatically at boot via runMigrations() in
# packages/server/src/index.ts, so the restart below applies them.
if build_and_restart && wait_for_health; then
  log "deployed $TARGET_SHA — healthy"
  exit 0
fi

# ── Failure path ────────────────────────────────────────────────────────────
log "deploy FAILED — rolling back code to $PREVIOUS_SHA"
git checkout --detach "$PREVIOUS_SHA"

if build_and_restart && wait_for_health; then
  log "rolled back to $PREVIOUS_SHA — healthy"
else
  log "ROLLBACK ALSO FAILED — the service is down"
  log "inspect with: journalctl -u $SERVICE -n 100 --no-pager"
fi

# The database is deliberately left untouched. Migrations here are additive, so
# reverting the code is normally enough, and an unattended data rollback would
# discard any trades made after the snapshot. Restore explicitly if the failure
# turns out to be a destructive migration.
cat >&2 <<EOF

[deploy] The database was NOT rolled back.
[deploy] If this release ran a destructive migration, restore the pre-deploy
[deploy] snapshot manually:
[deploy]
[deploy]   ls -t /var/backups/markettrader/predeploy/ | head
[deploy]   sudo $APP_DIR/deploy/restore.sh /var/backups/markettrader/predeploy/<snapshot>
EOF

exit 1
