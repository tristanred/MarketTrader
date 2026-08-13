#!/usr/bin/env bash
#
# Restore the MarketTrader database from a snapshot.
#
#   deploy/restore.sh --list                      # what can I restore?
#   sudo deploy/restore.sh --dry-run <snapshot>   # verify only, change nothing
#   sudo deploy/restore.sh <snapshot>
#
# Stops the service, snapshots the CURRENT database first (so a mistaken
# restore is itself reversible), swaps the file in, and starts back up.

set -euo pipefail

BACKUP_ROOT="${MARKETTRADER_BACKUP_ROOT:-/var/backups/markettrader}"
DB_RAW="${DATABASE_URL:-/var/lib/markettrader/app.db}"
DB="${DB_RAW#file:}"
SERVICE=markettrader

log() { echo "[restore] $*"; }
die() { echo "[restore] ERROR: $*" >&2; exit 1; }

# Sorted by mtime rather than filename: the tiers use different naming schemes
# (timestamp, date, ISO week), so a lexical sort would interleave them wrongly.
list_snapshots() {
  local found
  found=$(find "$BACKUP_ROOT" -name '*.db.gz' \
    -printf '%T@ %TY-%Tm-%Td %TH:%TM %8s  %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-)
  if [ -z "$found" ]; then
    echo "  (no snapshots yet)"
  else
    echo "$found"
  fi
}

if [ "${1:-}" = "--list" ]; then
  echo "Available snapshots, newest first:"
  list_snapshots
  exit 0
fi

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
  shift
fi

SNAPSHOT="${1:-}"

# Not knowing the filename is the normal state when you need this script, so
# answer that question here instead of printing a bare usage line.
if [ -z "$SNAPSHOT" ]; then
  {
    echo "usage: restore.sh [--dry-run] <snapshot.db.gz>"
    echo "       restore.sh --list"
    echo ""
    echo "Available snapshots, newest first:"
    list_snapshots
  } >&2
  exit 1
fi

[ -f "$SNAPSHOT" ] || die "snapshot not found: $SNAPSHOT"

# Verify the snapshot BEFORE stopping anything. A bad archive should cost zero
# downtime.
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
log "verifying $SNAPSHOT"
gunzip -c "$SNAPSHOT" > "$staging/app.db"
check="$(sqlite3 "$staging/app.db" 'PRAGMA integrity_check;')"
[ "$check" = "ok" ] || die "snapshot is corrupt: $check"

games="$(sqlite3 "$staging/app.db" 'SELECT COUNT(*) FROM games;' 2>/dev/null || echo '?')"
trades="$(sqlite3 "$staging/app.db" 'SELECT COUNT(*) FROM trades;' 2>/dev/null || echo '?')"
log "snapshot is valid — $games games, $trades trades"

if [ "$DRY_RUN" = 1 ]; then
  log "dry run: nothing changed"
  exit 0
fi

if [ -f "$DB" ]; then
  cur_games="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM games;' 2>/dev/null || echo '?')"
  cur_trades="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM trades;' 2>/dev/null || echo '?')"
  log "current database — $cur_games games, $cur_trades trades"
fi

read -r -p "[restore] Replace $DB with this snapshot? [y/N] " reply
[ "$reply" = "y" ] || [ "$reply" = "Y" ] || die "aborted"

log "stopping $SERVICE"
systemctl stop "$SERVICE"

# Snapshot what we're about to overwrite, so this operation is reversible too.
if [ -f "$DB" ]; then
  log "backing up the current database before overwriting"
  DATABASE_URL="$DB" /opt/markettrader/deploy/backup.sh predeploy "pre-restore" || \
    log "WARNING: pre-restore backup failed; continuing at your request"
fi

log "installing snapshot"
install -o markettrader -g markettrader -m 0644 "$staging/app.db" "$DB"
# The old WAL and shared-memory files describe the REPLACED database. Leaving
# them in place lets SQLite replay stale frames over the restored file.
rm -f "${DB}-wal" "${DB}-shm"

log "starting $SERVICE"
systemctl start "$SERVICE"

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    log "restore complete — service healthy"
    exit 0
  fi
  sleep 1
done

die "service did not become healthy within 30s — check: journalctl -u $SERVICE -n 50"
