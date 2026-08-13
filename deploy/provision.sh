#!/usr/bin/env bash
#
# One-time server bootstrap for a self-hosted MarketTrader instance.
# Idempotent — safe to re-run after editing the units or the nginx site.
#
#   sudo deploy/provision.sh --hostname markettrader.example.com
#
# Does NOT obtain a TLS certificate; run certbot afterwards (see
# docs/deployment-selfhost.md), because the DNS record has to resolve first.

set -euo pipefail

HOSTNAME_FQDN=""
REPO_URL="${MARKETTRADER_REPO:-https://github.com/tristanred/MarketTrader.git}"
DEPLOY_USER="${SUDO_USER:-}"
LAN_CIDR="192.168.2.0/24"
NODE_MAJOR=26
PNPM_VERSION=11.0.9

SERVICE_USER=markettrader
APP_DIR=/opt/markettrader
WEB_ROOT=/var/www/markettrader
DATA_DIR=/var/lib/markettrader
BACKUP_ROOT=/var/backups/markettrader
ENV_DIR=/etc/markettrader

log() { echo "[provision] $*"; }
die() { echo "[provision] ERROR: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --hostname) HOSTNAME_FQDN="$2"; shift 2 ;;
    --repo) REPO_URL="$2"; shift 2 ;;
    --deploy-user) DEPLOY_USER="$2"; shift 2 ;;
    --lan-cidr) LAN_CIDR="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "must run as root (use sudo)"
[ -n "$HOSTNAME_FQDN" ] || die "--hostname is required (e.g. markettrader.example.com)"
[ -n "$DEPLOY_USER" ] || die "--deploy-user is required when not running under sudo"
id "$DEPLOY_USER" >/dev/null 2>&1 || die "deploy user '$DEPLOY_USER' does not exist"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Packages ────────────────────────────────────────────────────────────────
log "installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  nginx sqlite3 rsync ufw curl git ca-certificates \
  certbot python3-certbot-nginx

# ── Node ────────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  log "installing Node $NODE_MAJOR from NodeSource"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge "$NODE_MAJOR" ] || die "node $node_major is too old; package.json requires >= $NODE_MAJOR"
log "node $(node -v)"

if ! command -v pnpm >/dev/null; then
  log "installing pnpm $PNPM_VERSION"
  # Corepack is the documented path (matches Dockerfile.server), but it is not
  # bundled with every Node distribution — fall back to a global install.
  if command -v corepack >/dev/null; then
    corepack enable
    corepack prepare "pnpm@$PNPM_VERSION" --activate
  else
    npm install -g "pnpm@$PNPM_VERSION"
  fi
fi
log "pnpm $(pnpm --version)"

# ── Service user and directories ────────────────────────────────────────────
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  log "creating service user $SERVICE_USER"
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# The deploy user builds in $APP_DIR, so it needs group membership. setgid on
# the directories keeps files created by either account in the shared group.
log "adding $DEPLOY_USER to the $SERVICE_USER group"
usermod -aG "$SERVICE_USER" "$DEPLOY_USER"

for dir in "$APP_DIR" "$WEB_ROOT" "$DATA_DIR" "$BACKUP_ROOT" \
           "$BACKUP_ROOT"/{hourly,daily,weekly,predeploy}; do
  mkdir -p "$dir"
  chown "$SERVICE_USER:$SERVICE_USER" "$dir"
  chmod 2775 "$dir"
done

mkdir -p "$ENV_DIR"
chown root:"$SERVICE_USER" "$ENV_DIR"
chmod 0750 "$ENV_DIR"

# ── Repository ──────────────────────────────────────────────────────────────
if [ ! -d "$APP_DIR/.git" ]; then
  log "cloning $REPO_URL"
  sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$APP_DIR"
else
  log "repository already present at $APP_DIR"
fi
git config --global --add safe.directory "$APP_DIR" || true
# Git on Windows checkouts doesn't preserve the exec bit; set it here so the
# units and the deploy path can invoke these directly.
chmod +x "$APP_DIR"/deploy/*.sh

# ── Environment file ────────────────────────────────────────────────────────
if [ ! -f "$ENV_DIR/env" ]; then
  log "generating $ENV_DIR/env"
  cat > "$ENV_DIR/env" <<EOF
NODE_ENV=production
DATABASE_URL=$DATA_DIR/app.db
JWT_SECRET=$(openssl rand -hex 32)
PORT=3000
CORS_ORIGIN=https://$HOSTNAME_FQDN
STOCK_PROVIDER=yahoo
MARKET_HOURS_MODE=pending
MARKETTRADER_BACKUP_ROOT=$BACKUP_ROOT
EOF
else
  # Never regenerate: rotating JWT_SECRET invalidates every active session.
  log "$ENV_DIR/env already exists — leaving it untouched"
fi
chown root:"$SERVICE_USER" "$ENV_DIR/env"
chmod 0640 "$ENV_DIR/env"

# ── systemd ─────────────────────────────────────────────────────────────────
log "installing systemd units"
install -m 0644 "$SCRIPT_DIR/systemd/markettrader.service" /etc/systemd/system/
install -m 0644 "$SCRIPT_DIR/systemd/markettrader-backup.service" /etc/systemd/system/
install -m 0644 "$SCRIPT_DIR/systemd/markettrader-backup.timer" /etc/systemd/system/
systemctl daemon-reload

# ── sudoers ─────────────────────────────────────────────────────────────────
# `pnpm ship` must be non-interactive, so grant exactly the two privileged
# operations a deploy performs — nothing broader.
log "installing sudoers rule for $DEPLOY_USER"
cat > /etc/sudoers.d/markettrader-deploy <<EOF
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart markettrader, \\
  /usr/bin/systemctl start markettrader, \\
  /usr/bin/systemctl stop markettrader, \\
  /usr/bin/systemctl is-active markettrader
$DEPLOY_USER ALL=($SERVICE_USER) NOPASSWD: $APP_DIR/deploy/backup.sh
EOF
chmod 0440 /etc/sudoers.d/markettrader-deploy
visudo -cf /etc/sudoers.d/markettrader-deploy || die "generated sudoers rule is invalid"

# ── nginx ───────────────────────────────────────────────────────────────────
log "installing nginx site for $HOSTNAME_FQDN"
sed "s/server_name _;/server_name $HOSTNAME_FQDN;/" \
  "$SCRIPT_DIR/nginx/markettrader.conf" > /etc/nginx/sites-available/markettrader
ln -sf /etc/nginx/sites-available/markettrader /etc/nginx/sites-enabled/markettrader
rm -f /etc/nginx/sites-enabled/default
# Placeholder so nginx has something to serve before the first deploy.
[ -f "$WEB_ROOT/index.html" ] || echo '<!doctype html>MarketTrader: not deployed yet.' > "$WEB_ROOT/index.html"
nginx -t || die "nginx config test failed"
systemctl reload nginx

# ── Firewall ────────────────────────────────────────────────────────────────
# Default-deny is what keeps the server's 0.0.0.0:3000 bind off the LAN.
log "configuring ufw"
ufw --force default deny incoming
ufw --force default allow outgoing
ufw allow from "$LAN_CIDR" to any port 22 proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ── Enable services ─────────────────────────────────────────────────────────
systemctl enable markettrader-backup.timer
systemctl start markettrader-backup.timer
systemctl enable markettrader

cat <<EOF

[provision] Done.

Next steps:
  1. Point an A record for $HOSTNAME_FQDN at your public IP.
  2. Forward router TCP 80 and 443 to this host.
  3. Deploy the app:      pnpm ship
  4. Issue a certificate: sudo certbot --nginx -d $HOSTNAME_FQDN
     (if inbound :80 is blocked by your ISP, use a DNS-01 plugin instead)

The service is enabled but not started — it has nothing to run until the
first deploy. Step 3 builds the app and starts it.
EOF
