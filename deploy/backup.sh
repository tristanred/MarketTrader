#!/usr/bin/env bash
#
# Snapshot the MarketTrader SQLite database into a tiered backup tree.
#
#   backup.sh hourly              # scheduled snapshot, promotes to daily/weekly
#   backup.sh predeploy <label>   # pre-deploy safety net, taken by deploy.sh
#
# Uses `VACUUM INTO` rather than copying the file. The database runs in WAL
# mode (packages/server/src/db/index.ts), so a plain `cp` can capture a torn
# state where the main file and the -wal are inconsistent. VACUUM INTO takes a
# read lock and emits a single consistent, compacted file while the server
# keeps serving.

set -euo pipefail

TIER="${1:-hourly}"
LABEL="${2:-}"

DB_RAW="${DATABASE_URL:-/var/lib/markettrader/app.db}"
# The env file holds the value the server consumes, which may carry libsql's
# file: prefix. sqlite3 wants a bare path.
DB="${DB_RAW#file:}"
BACKUP_ROOT="${MARKETTRADER_BACKUP_ROOT:-/var/backups/markettrader}"

# Retention, in snapshots per tier.
KEEP_HOURLY=24
KEEP_DAILY=14
KEEP_WEEKLY=8
KEEP_PREDEPLOY=10

log() { echo "[backup] $*"; }
die() { echo "[backup] ERROR: $*" >&2; exit 1; }

case "$TIER" in
  hourly|predeploy) ;;
  *) die "unknown tier '$TIER' (expected: hourly, predeploy)" ;;
esac

[ -f "$DB" ] || die "database not found at $DB"
command -v sqlite3 >/dev/null || die "sqlite3 is not installed"

mkdir -p "$BACKUP_ROOT"/{hourly,daily,weekly,predeploy}

stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
if [ "$TIER" = "predeploy" ]; then
  name="app-${stamp}${LABEL:+-$LABEL}"
else
  name="app-${stamp}"
fi

work="$BACKUP_ROOT/.${name}.tmp.db"
rm -f "$work"
# Any partial snapshot left behind by a crash or a full disk is noise at best
# and a restore hazard at worst.
trap 'rm -f "$work"' EXIT

# VACUUM INTO refuses to overwrite, so $work must not exist at this point.
sqlite3 "$DB" "VACUUM INTO '$work'"

# Verify before compressing. Without this a corrupt database would quietly
# produce a full retention window of corrupt snapshots, and the problem would
# only surface during a restore — exactly when there's no good copy left.
check="$(sqlite3 "$work" 'PRAGMA quick_check;')"
[ "$check" = "ok" ] || die "snapshot failed integrity check: $check"

gzip -9 "$work"
work_gz="${work}.gz"

dest="$BACKUP_ROOT/$TIER/${name}.db.gz"
mv "$work_gz" "$dest"
trap - EXIT

size="$(du -h "$dest" | cut -f1)"
log "wrote $dest ($size)"

# Promote the fresh snapshot into the coarser tiers. Hard links, so all three
# tiers share one copy on disk and pruning one tier can't destroy another —
# the file survives until the last link to it is gone.
promote() {
  local tier="$1" target="$BACKUP_ROOT/$1/$2.db.gz"
  if [ ! -e "$target" ]; then
    ln "$dest" "$target"
    log "promoted to $tier/$2.db.gz"
  fi
}

if [ "$TIER" = "hourly" ]; then
  promote daily "app-$(date -u +%Y-%m-%d)"
  promote weekly "app-$(date -u +%G-W%V)"
fi

# Prune oldest-first, by mtime. Filenames are timestamp-based and contain no
# whitespace, so the plain pipeline is safe here.
prune() {
  local tier="$1" keep="$2" dir="$BACKUP_ROOT/$1"
  local -a stale
  mapfile -t stale < <(ls -1t "$dir" 2>/dev/null | tail -n "+$((keep + 1))")
  for f in "${stale[@]}"; do
    [ -n "$f" ] || continue
    rm -f "$dir/$f"
    log "pruned $tier/$f"
  done
}

prune hourly "$KEEP_HOURLY"
prune daily "$KEEP_DAILY"
prune weekly "$KEEP_WEEKLY"
prune predeploy "$KEEP_PREDEPLOY"

log "done (tier=$TIER)"
