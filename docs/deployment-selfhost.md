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

That also means new variables never reach an existing install. `TRUST_PROXY` was added after the first provision runs; it defaults to `loopback`, which is correct here, so hosts provisioned earlier behave correctly without the line. Add it explicitly only if something other than local nginx fronts the app.

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

### Dynamic DNS

Residential IPs rotate. When yours does, the A record goes stale and the site disappears until someone notices — over a months-long tournament that is closer to inevitable than unlikely. `markettrader-ddns.timer` keeps the record current.

Enable Dynamic DNS on the domain (Namecheap: Domain List → Manage → Advanced DNS → *Dynamic DNS*), then put the generated password in `/etc/markettrader/ddns.env`:

```
DDNS_DOMAIN=markettrader.app
DDNS_HOSTS=@
DDNS_PASSWORD=<the password Namecheap generated>
```

`DDNS_HOSTS` is space-separated record labels; `@` is the bare domain. Add `www` if you have a www A record (a CNAME to the apex needs no updating). Then force a first run:

```bash
sudo -u markettrader /opt/markettrader/deploy/ddns-update.sh --force
```

The timer runs every 5 minutes and 1 minute after boot — the boot run matters because a power cut is exactly when the ISP is likely to hand out a new address. Updates are sent only when the IP actually changes, plus a daily re-assertion so a record edited or lost upstream repairs itself.

Until `DDNS_PASSWORD` is set the updater is a deliberate no-op, so enabling the timer at provision time is harmless.

```bash
journalctl -u markettrader-ddns --since today
```

The secret lives in its own file rather than the app's env, so it is never injected into the server process, and the update URL is never logged.

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
2. `git fetch` + checks out the target ref.
3. Takes a **pre-deploy backup** into `predeploy/`. This runs after the checkout on purpose: nothing before the restart touches the database (migrations run at boot), so the snapshot still lands before anything can damage it — and a fix to `backup.sh` ships on the same deploy that carries it, instead of being blocked by the broken copy it replaces.
4. `pnpm install --frozen-lockfile`, then builds shared → server → frontend.
5. `rsync`es the SPA into `/var/www/markettrader` — only after a successful build, so nginx never serves a half-written bundle.
6. Restarts the service. Migrations run automatically at boot via `runMigrations()`.
7. Polls `/health` for 30s, then echoes what `/version` reports so the deploy output names the build it just put live.

If the health check fails it **rolls the code back** to the previous SHA, rebuilds, and restarts. The database is deliberately left alone: migrations are additive, so reverting code is normally enough, and an unattended data rollback would discard trades made since the snapshot. The script prints the exact `restore.sh` command if you do need it.

Expect a few seconds of downtime at the restart.

### Checking what's live

```bash
curl https://markettrader.app/api/version
```

```json
{ "version": "0.1.0", "commit": "a1b2c3d", "buildTime": "2026-08-15T18:22:04.113Z" }
```

The endpoint is public and unauthenticated, like `/health`. The version and the SHA are both baked into the bundle at build time, so they describe the running process rather than whatever the checkout happens to be at now.

Read the SHA, not just the version: shipping is independent of versioning, so several deploys can legitimately report the same version number. `buildTime` tells you when this host last rebuilt.

For a player reporting something odd, send them `https://markettrader.app/version` instead. That page compares the build their browser is running against the server's and tells them to reload if the bundle is stale — the usual cause of "it broke right after you deployed".

### Cutting a version

Versions are managed locally with changesets and are **not** produced by a deploy — see the "Versioning and Releases" section of `CLAUDE.md`. The one rule that matters here: `pnpm ship` deploys `origin/main` and the server builds from a fresh `git fetch`, so **push the version commit before shipping** or the deploy will build the old number.

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
| What's deployed? | `curl https://markettrader.app/api/version` |
| Browse the API docs | `https://markettrader.app/docs` |
| Check a player's build | send them `https://markettrader.app/version` |
| Open a SQL shell | `sudo -u markettrader sqlite3 /var/lib/markettrader/app.db` |
| Force a backup now | `sudo systemctl start markettrader-backup.service` |
| List snapshots | `deploy/restore.sh --list` |
| Force a DNS update | `sudo -u markettrader deploy/ddns-update.sh --force` |
| Check the public IP on record | `cat /var/lib/markettrader/.ddns-last-ip` |
| Roll back a release | `pnpm ship --ref <previous-sha>` |
| Check cert expiry | `sudo certbot certificates` |

### Changing configuration

Edit `/etc/markettrader/env`, then restart. The full set of variables is documented in `packages/server/src/env.ts` and `.env.example`.

### Changing the nginx site

**Editing `deploy/nginx/markettrader.conf` in the repo does not change the server.** This catches people out, so it is worth stating plainly:

- `provision.sh` refuses to overwrite an existing site file *on purpose*. `certbot --nginx` rewrites the installed copy in place to add the 443 listener, the certificate paths and an HTTP→HTTPS redirect block. Regenerating from the repo would revert the site to HTTP-only — and on an HSTS-preloaded TLD like `.app` that takes it off the air entirely.
- `deploy.sh` does not warn about it either. It compares the systemd units, not the nginx site, because the installed site *legitimately* differs from the repo (certbot's edits plus the substituted `server_name`), so a plain comparison would cry wolf on every deploy.

The result: the repo copy is documentation of intent, and the installed copy is what actually serves. They drift silently. A missing `location /docs` survived this way and made the API docs unreachable in production while looking correct in the repo.

**Detecting drift.** Run this from a checkout on the server — it reports repo location blocks that never made it into the installed file, and ignores certbot's rewrites:

```bash
/opt/markettrader/deploy/nginx-check.sh
```

It only compares `location` directives, though. A change *inside* an existing block — a
`proxy_set_header` line, a timeout, a rewrite — is invisible to it, so those have to be
tracked by hand.

**Outstanding manual change: `X-Forwarded-For`.** Every proxy block in the repo site now
sends `proxy_set_header X-Forwarded-For $remote_addr` instead of
`$proxy_add_x_forwarded_for`. The old form prepends whatever the client sent, letting a
caller forge the value the app keys its rate limits on. Since this is an edit inside
existing blocks, neither `deploy.sh` nor `nginx-check.sh` reports it — check the installed
file and apply it if it still says `$proxy_add_x_forwarded_for`:

```bash
grep -n 'X-Forwarded-For' /etc/nginx/sites-available/markettrader
```

**Applying a change.** Hand-apply the same edit, then test and reload:

```bash
sudo cp -a /etc/nginx/sites-available/markettrader /etc/nginx/sites-available/markettrader.bak.$(date +%F)
sudo nano /etc/nginx/sites-available/markettrader
sudo nginx -t && sudo systemctl reload nginx
```

Three things about that sequence:

- **Back up first.** Certbot's edits live only in that file; if you mangle it you cannot regenerate an equivalent from the repo.
- **`nginx -t` before the reload is not optional.** It is the only thing standing between a typo and the whole site going down.
- **Put new `location` blocks in the first `server` block** — the one with `server_name markettrader.app` that holds `location /api/`. The second block is certbot's port-80 redirect and anything added there is ignored for real traffic.

Note that `sudo` prompts for a password here. The NOPASSWD rules from `provision.sh` cover only `systemctl restart|start|stop|is-active markettrader` and `backup.sh`, deliberately — they exist so deploys are unattended, not so the host is broadly writable without authentication.

### Swagger UI

The API docs are at `https://markettrader.app/docs` — served by the API server, **not** under `/api`. This needs the `location /docs` block from `deploy/nginx/markettrader.conf`; without it `/docs` falls through to the SPA and the catch-all route redirects to `/`. If you provisioned before that block existed, apply it using the manual step above.

Note that this makes the full API schema publicly readable.

```bash
sudo nano /etc/markettrader/env && sudo systemctl restart markettrader
```

`DATABASE_URL` must stay an **absolute** path. In production the server rejects relative paths and `:memory:` at boot, because both lose data silently — see ADR-013.

---

## Troubleshooting

**Service won't start.** `journalctl -u markettrader -n 50`. A config error throws before the port is bound and prints exactly which variable is wrong. `Restart=always` is capped at 5 attempts per 300s so an unsatisfiable config doesn't spin forever.

**Changed a systemd unit and nothing happened.** Units are installed by `provision.sh`, not by a deploy. Re-run `provision.sh` to apply them — it's idempotent. `deploy.sh` warns when the repo copy differs from the installed one. Note that a broken unit cannot be fixed by the automatic rollback either, because the unit is the same at every commit.

**`uv_interface_addresses returned Unknown system error 97`.** Errno 97 is `EAFNOSUPPORT`. The unit's `RestrictAddressFamilies` is missing `AF_NETLINK`, which glibc needs for `getifaddrs()` — Fastify calls `os.networkInterfaces()` right after binding — and for the resolver's `AI_ADDRCONFIG`. Re-run `provision.sh`.

**Users get logged out every 15 minutes.** The `Secure` refresh cookie isn't surviving. You're serving over plain HTTP, or nginx isn't forwarding `X-Forwarded-Proto`. Confirm the site actually loads over `https://`.

**Login works but WebSockets don't.** Check the upgrade blocks in the nginx site. Both `/api/games/*/live` and `/api/ws/live` need `Upgrade`/`Connection` headers, and both must appear before the generic `location /api/`.

**`pnpm ship` fails at the build with "command not found".** `NODE_ENV=production` leaked into the deploy shell — pnpm then skips devDependencies, and `tsup`/`vite`/`typescript` are all devDependencies. `deploy.sh` unsets it; check for a stray export in the deploy user's shell profile.

**Deploy fails with a permission error.** The deploy user must be in the `markettrader` group. Group membership only takes effect on a new login session — reconnect after provisioning.

**Site unreachable from outside but fine on the LAN.** Usually a rotated public IP or the router dropping its port-forward after a reboot. Check `journalctl -u markettrader-ddns -n 20` and compare `dig +short markettrader.app @1.1.1.1` against `curl -s https://api.ipify.org` from the host.

**DDNS reports "Passwords do not match".** The Dynamic DNS password is not your Namecheap account password — it is generated per-domain under Advanced DNS → Dynamic DNS, and only appears once that toggle is on.

**A record looks right but the server still resolves the old IP.** The host's own resolver caches independently of authoritative DNS. `dig @1.1.1.1` bypasses it; `sudo resolvectl flush-caches` clears it.
