# Deployment Guide — Self-Hosted (single Linux host, SQLite)

The self-hosted path: one Ubuntu box running the Fastify server as a systemd service, nginx serving the SPA and terminating TLS, and SQLite as the database. Built for a long-running tournament on a home server reached through a residential port-forward.

For the AWS/Postgres/Docker path, see [deployment.md](deployment.md). The rationale for SQLite in production is [ADR-013](technical-decisions.md#adr-013-sqlite-as-a-supported-production-database-for-self-hosted-deployments).

---

## Architecture

```
Internet → home IP :443 → router forward → host :443
    nginx (TLS, certbot auto-renew)
      ├── /              → /var/www/markettrader        (SPA bundle)
      └── /api/*, WS     → 127.0.0.1:3000               (Fastify, systemd)
                              └── /var/lib/markettrader/app.db  (SQLite, WAL)
```

| Path | Purpose |
|---|---|
| `/opt/markettrader` | git checkout + build workspace |
| `/var/www/markettrader` | built SPA, published by the deploy |
| `/var/lib/markettrader/app.db` | the database (+ `-wal`, `-shm`) |
| `/var/backups/markettrader/` | tiered snapshots |
| `/etc/markettrader/env` | secrets, `0640 root:markettrader` |

The server binds `0.0.0.0:3000`. Nothing forwards to it and `ufw` default-denies, so it is reachable only over loopback via nginx. **Do not disable the firewall** without also changing that bind.

---

## 1. Provision

Requires `sudo` on the host and a user account you'll deploy as.

```bash
git clone https://github.com/tristanred/MarketTrader.git /tmp/mt && cd /tmp/mt
```

```bash
sudo deploy/provision.sh --hostname markettrader.app
```

Idempotent — re-run it after editing a systemd unit or the nginx site. It installs nginx, sqlite3, certbot and Node 26; creates the `markettrader` service user and the directory tree; clones the repo to `/opt/markettrader`; generates `/etc/markettrader/env` with a random `JWT_SECRET`; installs the units, the nginx site, and a narrow sudoers rule; and enables `ufw`.

By default it forwards SSH only from `192.168.2.0/24` — pass `--lan-cidr` if your LAN differs.

`/etc/markettrader/env` is **never regenerated** on a re-run. Rotating `JWT_SECRET` would invalidate every active session, so it's written once and left alone.

## 2. DNS and TLS

TLS is not optional. The refresh cookie is issued with the `Secure` flag whenever `NODE_ENV=production` (`packages/server/src/routes/auth.ts`), so over plain HTTP browsers discard it and every session dies the moment the 15-minute access token expires.

1. Point an A record for your hostname at your public IP.
2. If that IP is dynamic, install a DDNS updater for your registrar as a systemd timer.
3. Forward router TCP **80 and 443** to the host.
4. Check that inbound port 80 actually reaches you — from a phone on cellular, not from inside the LAN. Many residential ISPs block it.
5. Issue the certificate:

```bash
sudo certbot --nginx -d markettrader.app
```

If port 80 is blocked, use a DNS-01 plugin for your registrar instead (`certbot-dns-cloudflare`, `certbot-dns-route53`, …) and forward only 443. Renewal is handled by the `certbot.timer` the package installs; confirm with `sudo certbot renew --dry-run`.

## 3. Deploy

From your development machine:

```bash
pnpm ship
```

| Command | Effect |
|---|---|
| `pnpm ship` | deploy `origin/main` |
| `pnpm ship --ref v1.2.0` | deploy a tag |
| `pnpm ship --ref abc1234` | roll back to a commit |
| `pnpm ship --host user@10.0.0.5` | override the target |

The target defaults to `tristan@192.168.2.117`; override permanently with `MARKETTRADER_DEPLOY_HOST`.

> The script is called `ship`, not `deploy` — `pnpm deploy` and `pnpm publish` are pnpm built-ins and would shadow a package script of that name.

`deploy/deploy.sh` on the server, in order:

1. Records the currently deployed SHA.
2. Takes a **pre-deploy backup** into `predeploy/`.
3. `git fetch` + checks out the target ref.
4. `pnpm install --frozen-lockfile`, then builds shared → server → frontend.
5. `rsync`es the SPA into `/var/www/markettrader` — only after a successful build, so nginx never serves a half-written bundle.
6. Restarts the service. Migrations run automatically at boot via `runMigrations()`.
7. Polls `/health` for 30s.

If the health check fails it **rolls the code back** to the previous SHA, rebuilds, and restarts. The database is deliberately left alone: migrations are additive, so reverting code is normally enough, and an unattended data rollback would discard trades made since the snapshot. The script prints the exact `restore.sh` command if you do need it.

Expect a few seconds of downtime at the restart.

## 4. Backups

`markettrader-backup.timer` runs hourly and is `Persistent=true`, so a snapshot missed while the machine was off is taken at boot.

| Tier | Retention |
|---|---|
| `hourly/` | 24 |
| `daily/` | 14 |
| `weekly/` | 8 |
| `predeploy/` | 10 |

One `VACUUM INTO` per run feeds all tiers; daily and weekly are hard links to the hourly file, so the tiers share storage and pruning one can't destroy another.

Snapshots use `VACUUM INTO`, never `cp`. The database runs in WAL mode, so a plain copy can capture a torn state where the main file and the `-wal` disagree. Each snapshot is verified with `PRAGMA quick_check` before compression — a corrupt database fails loudly in the journal instead of quietly filling the retention window with unusable backups.

```bash
systemctl list-timers markettrader-backup
```

```bash
journalctl -u markettrader-backup --since today
```

### Restoring

Verify a snapshot without touching anything:

```bash
sudo deploy/restore.sh --dry-run /var/backups/markettrader/daily/app-2026-08-11.db.gz
```

Restore for real (prompts for confirmation, and snapshots the current database first so the restore is itself reversible):

```bash
sudo deploy/restore.sh /var/backups/markettrader/daily/app-2026-08-11.db.gz
```

**Run a restore drill before the tournament starts.** An untested backup is not a backup, and the moment you need one is the worst time to discover the procedure doesn't work.

## 5. Smoke test

```bash
SMOKE_BASE_URL=https://markettrader.app ./scripts/smoke.sh
```

Hits `/api/health`, registers a throwaway user, and makes an authenticated `/api/games` request — so a clean exit proves nginx routing, the API, and SQLite writes all work together.

---

## Routine operations

| Action | Command |
|---|---|
| Service status | `systemctl status markettrader` |
| Tail logs | `journalctl -u markettrader -f` |
| Restart | `sudo systemctl restart markettrader` |
| What's deployed? | `git -C /opt/markettrader log -1 --oneline` |
| Open a SQL shell | `sudo -u markettrader sqlite3 /var/lib/markettrader/app.db` |
| Force a backup now | `sudo systemctl start markettrader-backup.service` |
| List snapshots | `ls -lt /var/backups/markettrader/hourly/` |
| Roll back a release | `pnpm ship --ref <previous-sha>` |
| Check cert expiry | `sudo certbot certificates` |

### Changing configuration

Edit `/etc/markettrader/env`, then restart. The full set of variables is documented in `packages/server/src/env.ts` and `.env.example`.

```bash
sudo nano /etc/markettrader/env && sudo systemctl restart markettrader
```

`DATABASE_URL` must stay an **absolute** path. In production the server rejects relative paths and `:memory:` at boot, because both lose data silently — see ADR-013.

---

## Troubleshooting

**Service won't start.** `journalctl -u markettrader -n 50`. A config error throws before the port is bound and prints exactly which variable is wrong. `Restart=always` is capped at 5 attempts per 300s so an unsatisfiable config doesn't spin forever.

**Users get logged out every 15 minutes.** The `Secure` refresh cookie isn't surviving. You're serving over plain HTTP, or nginx isn't forwarding `X-Forwarded-Proto`. Confirm the site actually loads over `https://`.

**Login works but WebSockets don't.** Check the upgrade blocks in the nginx site. Both `/api/games/*/live` and `/api/ws/live` need `Upgrade`/`Connection` headers, and both must appear before the generic `location /api/`.

**`pnpm ship` fails at the build with "command not found".** `NODE_ENV=production` leaked into the deploy shell — pnpm then skips devDependencies, and `tsup`/`vite`/`typescript` are all devDependencies. `deploy.sh` unsets it; check for a stray export in the deploy user's shell profile.

**Deploy fails with a permission error.** The deploy user must be in the `markettrader` group. Group membership only takes effect on a new login session — reconnect after provisioning.

**Site unreachable from outside but fine on the LAN.** Usually a rotated public IP (check your DDNS updater) or the router dropping its port-forward after a reboot.
