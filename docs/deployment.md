# Deployment Guide — AWS EC2 (single host)

This is the smallest viable production deployment for MarketTrader: one EC2 instance running Docker Compose with Postgres + the Fastify server + an Nginx container serving the SPA. Suitable for a tournament with a handful of players. For multi-replica deployments, swap the auto-migration step (see "Migrations") and front the host with an ALB.

---

## 1. Provision the instance

| Setting | Value |
|---|---|
| AMI | Ubuntu 24.04 LTS |
| Type | `t3.small` (2 vCPU, 2 GiB RAM) — `t3.micro` works but argon2 hashes are slow |
| Storage | 20 GB gp3 |
| Security group | TCP 22 (your IP), 80, 443 |

SSH in:

```sh
ssh -i ~/.ssh/your-key.pem ubuntu@<public-ip>
```

## 2. Install Docker

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit
# log back in so the group takes effect
ssh -i ~/.ssh/your-key.pem ubuntu@<public-ip>
docker compose version  # should print v2.x
```

## 3. Clone and configure

```sh
sudo apt-get install -y git jq
git clone https://github.com/<you>/MarketTrader.git
cd MarketTrader
cp .env.example .env
```

Edit `.env`:

```sh
DATABASE_URL=postgres://markettrader:markettrader@db:5432/markettrader
JWT_SECRET=$(openssl rand -hex 32)   # paste the output
CORS_ORIGIN=https://your-domain.example.com
NODE_ENV=production
STOCK_PROVIDER=yahoo
# Optional:
# OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
# STOCK_PROVIDER=alpaca
# ALPACA_API_KEY_ID=...
# ALPACA_API_SECRET_KEY=...
```

Production env validation (`validateProductionEnv()` in `packages/server/src/env.ts`) refuses to start if `JWT_SECRET` is shorter than 32 chars, `CORS_ORIGIN` is the dev default, `DATABASE_URL` isn't Postgres, or Alpaca is selected (via `STOCK_PROVIDER` or `MARKET_STATUS_PROVIDER`) without both `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY`.

## 4. Bring up the stack

```sh
docker compose up -d --build
```

What happens:

1. `db` (Postgres 16) starts; health-checks via `pg_isready`.
2. `server` waits for db, runs Drizzle migrations from `packages/server/drizzle/pg/` on startup (idempotent — tracked in `__drizzle_migrations`), seeds the first administrator if the database has none, then binds `:3000` (internal only).
3. `web` (Nginx) serves the static SPA bundle on `:80` and proxies `/api/*` and `/api/games/*/live` (WebSocket) to `server:3000`.

> **WebSocket credentials ride in `Sec-WebSocket-Protocol`, not the URL.** Any reverse proxy in
> front of the API must pass that header through on the upgrade request *and* pass the server's
> echoed value back on the 101 response — browsers fail the handshake otherwise. Nginx does both
> by default; a proxy that whitelists headers needs it added explicitly. Server and frontend must
> ship together: there is no query-string fallback.

Tail the logs:

```sh
docker compose logs -f server
```

### The first administrator

On a database with no admin, the server creates an `admin` account with a
randomly generated password and prints it to stdout once, before it starts
accepting requests:

```
================================================================
  MarketTrader — administrator account created

    username: admin
    password: <32 random characters>
```

Capture it from `docker compose logs server` on first boot. The app shows it
once and never again: subsequent boots find the existing admin and leave it
alone — no second account, no password reset. If a non-admin account already
holds the name `admin`, that account is *not* promoted; the seed uses
`admin-<hex>` instead and the banner names it.

**Rotate it.** The banner goes to stdout, so it stays in `docker compose logs`
for as long as the log is retained. Sign in, open the admin panel's Users page,
and reset the admin's own password (`POST /admin/users/:id/reset-password` — an
admin may target itself). There is no self-service password change outside the
admin surface.

Registering through the app grants no privileges to anyone. Every further
administrator is added by an existing one.

## 5. TLS

The compose file ships HTTP-only. Two production options:

**A. AWS Application Load Balancer (recommended)**

Put an ALB in front of the instance, attach an ACM cert, target group on TCP 80. ALB handles TLS termination; the instance never sees HTTPS. Set `CORS_ORIGIN=https://your-domain.example.com` — that's what the browser sees.

**B. Certbot + Nginx**

Add a certbot container to the compose file, mount `/etc/letsencrypt`, point the Nginx server block at the issued cert, and add `listen 443 ssl;`. Out of scope for the bootstrap guide.

## 6. Smoke test

Check the API answers, then that a registration round-trips:

```sh
curl -fsS http://<public-ip>/api/health

# Generate the password per run. Never commit a literal here: this account is
# created on the live host, and a password in the repo is a working credential.
SMOKE_USER="smoke-$$"
SMOKE_PASS=$(openssl rand -hex 24)

TOKEN=$(curl -fsS -X POST http://<public-ip>/api/auth/register \
  -H 'content-type: application/json' \
  -d "{\"username\":\"$SMOKE_USER\",\"password\":\"$SMOKE_PASS\"}" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

curl -fsS http://<public-ip>/api/games -H "authorization: Bearer $TOKEN"
```

Registration grants no privileges, so this account is unprivileged — but it does
leave a real user row behind. Delete it afterwards from the admin panel
(`/admin/users`) or with `DELETE /api/admin/users/<id>` as the seeded admin.

Exit code 0 on all three calls means the round-trip works.

## 7. Routine operations

| Action | Command |
|---|---|
| Pull a new release | `git pull && docker compose up -d --build` |
| Tail server logs | `docker compose logs -f server` |
| Open a psql shell | `docker compose exec db psql -U markettrader` |
| List tables | `docker compose exec db psql -U markettrader -c '\dt'` |
| Stop the stack | `docker compose down` (data persists in `postgres_data` volume) |
| Wipe data | `docker compose down -v` (irreversible) |

### Migrations

Migrations live in `packages/server/drizzle/pg/`. They run automatically when the `server` container starts. To add a migration during development:

```sh
DATABASE_URL=postgres://... pnpm --filter server db:generate
git add packages/server/drizzle/pg/
```

The next `docker compose up --build` picks it up. For multi-replica deployments, set `RUN_MIGRATIONS=false` (not yet wired) and run `pnpm --filter server db:migrate` as a separate pre-deploy step.

### Graceful shutdown

`docker compose stop server` sends SIGTERM. The server stops accepting connections, drains the WebSocket poll interval, closes the Postgres pool, and exits within 10s. After that it's force-killed.

### Rollback

```sh
git checkout <previous-tag>
docker compose up -d --build
```

The Postgres volume persists across container rebuilds, so the rollback is cheap as long as schema changes are backwards-compatible (additive). For destructive schema changes, take a `pg_dump` first.
