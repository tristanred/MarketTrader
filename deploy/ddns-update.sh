#!/usr/bin/env bash
#
# Keep the Namecheap DNS records pointed at this host's current public IP.
#
#   ddns-update.sh            # update only if the IP changed
#   ddns-update.sh --force    # update regardless
#
# Configured by /etc/markettrader/ddns.env (see provision.sh). Runs from
# markettrader-ddns.timer every 5 minutes.
#
# Namecheap's Dynamic DNS endpoint takes the record's host label, the domain,
# and the Dynamic DNS password from Advanced DNS. It answers with XML whose
# <ErrCount> is the only reliable success signal — it returns HTTP 200 even
# when it rejects the update, so checking the status code alone would report
# success while DNS silently went stale.

set -euo pipefail

CONFIG="${MARKETTRADER_DDNS_CONFIG:-/etc/markettrader/ddns.env}"
STATE_DIR="${MARKETTRADER_DDNS_STATE_DIR:-/var/lib/markettrader}"
STATE_FILE="$STATE_DIR/.ddns-last-ip"
ENDPOINT=https://dynamicdns.park-your-domain.com/update

# Re-assert the record this often even when the IP looks unchanged, so a record
# edited or lost on Namecheap's side repairs itself instead of waiting for the
# next IP change (which could be months away).
FORCE_INTERVAL_SECONDS=86400

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

log() { echo "[ddns] $*"; }
die() { echo "[ddns] ERROR: $*" >&2; exit 1; }

[ -f "$CONFIG" ] || die "config not found: $CONFIG"
# shellcheck source=/dev/null
. "$CONFIG"

DDNS_DOMAIN="${DDNS_DOMAIN:-}"
DDNS_HOSTS="${DDNS_HOSTS:-@}"
DDNS_PASSWORD="${DDNS_PASSWORD:-}"

# An unconfigured install must be harmless: the timer is enabled at provision
# time, before the password can be known, so bail quietly rather than failing
# every five minutes forever.
if [ -z "$DDNS_PASSWORD" ] || [ "$DDNS_PASSWORD" = "replace-with-namecheap-ddns-password" ]; then
  log "not configured yet — set DDNS_PASSWORD in $CONFIG"
  exit 0
fi
[ -n "$DDNS_DOMAIN" ] || die "DDNS_DOMAIN is not set in $CONFIG"

# Several providers, because a single one being down must not look like an IP
# change. Empty result => give up quietly; a transient network blip is not a
# reason to touch DNS.
detect_ip() {
  local url ip
  for url in https://api.ipify.org https://icanhazip.com https://ifconfig.me/ip; do
    ip="$(curl -fsS --max-time 10 "$url" 2>/dev/null | tr -d '[:space:]')" || continue
    if printf '%s' "$ip" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
      printf '%s' "$ip"
      return 0
    fi
  done
  return 1
}

CURRENT_IP="$(detect_ip)" || {
  log "could not determine public IP (all providers failed) — leaving DNS untouched"
  exit 0
}

LAST_IP=""
[ -f "$STATE_FILE" ] && LAST_IP="$(cat "$STATE_FILE" 2>/dev/null || true)"

stale=0
if [ -f "$STATE_FILE" ]; then
  age=$(( $(date +%s) - $(stat -c %Y "$STATE_FILE") ))
  [ "$age" -ge "$FORCE_INTERVAL_SECONDS" ] && stale=1
fi

if [ "$FORCE" -eq 0 ] && [ "$CURRENT_IP" = "$LAST_IP" ] && [ "$stale" -eq 0 ]; then
  exit 0
fi

if [ "$CURRENT_IP" != "$LAST_IP" ] && [ -n "$LAST_IP" ]; then
  log "public IP changed: $LAST_IP -> $CURRENT_IP"
fi

failed=0
for host in $DDNS_HOSTS; do
  # --data-urlencode with -G keeps the password and host label out of shell
  # quoting hazards. The URL is never logged: it carries the secret.
  response="$(curl -fsS --max-time 20 -G "$ENDPOINT" \
    --data-urlencode "host=$host" \
    --data-urlencode "domain=$DDNS_DOMAIN" \
    --data-urlencode "password=$DDNS_PASSWORD" \
    --data-urlencode "ip=$CURRENT_IP" 2>/dev/null)" || {
    log "ERROR: request failed for host '$host'"
    failed=1
    continue
  }

  errcount="$(printf '%s' "$response" | sed -n 's|.*<ErrCount>\([0-9]*\)</ErrCount>.*|\1|p')"
  if [ "$errcount" = "0" ]; then
    log "updated $host.$DDNS_DOMAIN -> $CURRENT_IP"
  else
    # Surface Namecheap's own message; it names the cause (bad password,
    # unknown host, DDNS not enabled for the domain).
    detail="$(printf '%s' "$response" | sed -n 's|.*<Err1>\([^<]*\)</Err1>.*|\1|p')"
    log "ERROR: $host.$DDNS_DOMAIN rejected — ${detail:-no detail returned}"
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  # Deliberately do not record the IP: a failed update must retry on the next
  # tick rather than believing DNS is correct.
  die "one or more records failed to update"
fi

mkdir -p "$STATE_DIR"
printf '%s' "$CURRENT_IP" > "$STATE_FILE"
