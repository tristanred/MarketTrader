# Admin APIs — Design Spec

**Date:** 2026-05-14
**Status:** Draft (awaiting user review)

---

## Context

MarketTrader currently has no privileged operations. Users can manage their own data through normal routes, but there's no mechanism for an operator to fix broken state — abandoned games, stuck working orders, a user who needs their cash balance corrected after a bug, etc.

This spec adds a backend admin surface: a group-based authorization system, a set of `/admin/*` endpoints covering moderation and operational tooling, an append-only audit log, and the schema changes (cascade deletes, ownership transfer) that make destructive operations safe.

Frontend admin UI is **out of scope** — this spec covers backend only.

---

## Authorization Model

### Group system

Two new tables (sqlite + pg, in sync):

- **`groups`**: `id` (uuid), `name` (text, unique), `createdAt`. Seeded with one row: `admin`.
- **`user_groups`**: composite PK `(userId, groupId)`, both with `onDelete: 'cascade'`. Plus a `createdAt` for audit purposes.

Users have no group membership by default.

### First-admin bootstrap

In `POST /auth/register`, wrap the user-insert + group-membership in a single transaction:

1. Count rows in `users`.
2. Insert the new user.
3. If pre-insert count was `0`, insert a `user_groups` row linking the new user to the `admin` group.

This means the very first registered user on a fresh deployment becomes admin. Subsequent users are unprivileged until explicitly added to the `admin` group by an existing admin.

### Route guard

New Fastify decorator `app.requireAdmin` registered in `packages/server/src/plugins/auth.ts` (or a new `plugins/admin.ts`). Pre-handler:

1. Run existing JWT verification (`request.jwtVerify()`).
2. Query `user_groups` joined to `groups` for `(userId = request.user.id, group.name = 'admin')`.
3. Return `403 Forbidden` if no row. Otherwise continue.

Cache the membership check per-request (decorate `request.isAdmin = true`); avoid querying twice if multiple handlers/hooks check it.

All admin routes mount under `/admin/*` and use this guard. Register the admin route plugin in `packages/server/src/app.ts` alongside existing routes.

---

## Schema Changes

### Cascade deletes

Migrate `onDelete` from `'restrict'` → `'cascade'` on these FKs (both `schema.sqlite.ts` and `schema.pg.ts`):

| Table | Column | References | New behaviour |
|---|---|---|---|
| `gamePlayers` | `gameId` | `games.id` | Delete game removes all players in it |
| `gamePlayers` | `userId` | `users.id` | Delete user removes their game_player rows |
| `portfolios` | `gamePlayerId` | `gamePlayers.id` | Holdings vanish with the player |
| `trades` | `gamePlayerId` | `gamePlayers.id` | Trades vanish with the player |
| `trades` | `parentTradeId` | `trades.id` | Bracket children vanish with parent |

**Unchanged (stays `restrict`):**
- `games.createdBy` → `users.id`. Deleting a user who owns a game must fail. Admin must transfer ownership first (see `PATCH /admin/games/:id/owner`).

Note: SQLite enforces FK cascade only when `PRAGMA foreign_keys = ON`. Confirm this pragma is set in `db/index.ts` (it must already be on for existing `'restrict'` constraints to fire).

### Users table additions

- `disabled` (boolean, default `false`) — when true, login is blocked. Checked in `POST /auth/login` after password verify: return `403` with message "account disabled".

### New tables

```ts
// groups
export const groups = table('groups', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  createdAt: text('created_at').default(sql`(datetime('now'))`).notNull(),
});

// user_groups (join)
export const userGroups = table('user_groups', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').default(sql`(datetime('now'))`).notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.groupId] })]);

// admin_audit_log
export const adminAuditLog = table('admin_audit_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  adminUserId: text('admin_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  action: text('action').notNull(),        // e.g. 'user.delete', 'game.edit', 'trade.reverse'
  targetType: text('target_type').notNull(), // 'user' | 'game' | 'trade' | 'portfolio' | 'system'
  targetId: text('target_id'),               // nullable for system-level actions
  before: text('before'),                    // JSON string, nullable
  after: text('after'),                      // JSON string, nullable
  metadata: text('metadata'),                // JSON string — query params, reason, etc.
  createdAt: text('created_at').default(sql`(datetime('now'))`).notNull(),
});
```

Audit log retention: never deleted from any admin endpoint. The `adminUserId` FK is `restrict` so the historical actor record can't be wiped out by deleting that admin's user row.

### Migration

Generate via `pnpm --filter server db:generate`. Migration also seeds the `admin` group row.

---

## Destructive-action UX: `?force=true`

Endpoints that cascade-delete real data (`DELETE /admin/users/:id`, `DELETE /admin/games/:id`, `DELETE /admin/games/:id/players/:playerId`, `POST /admin/games/:id/reset`) follow this pattern:

1. Without `?force=true`: run a dependents check. Count working/pending orders, non-zero holdings, executed trades, enrolled players. If any > 0, return `409 Conflict` with:
   ```json
   { "error": "has_dependents", "dependents": { "workingOrders": 3, "holdings": 2, "players": 5 } }
   ```
2. With `?force=true`: cascade proceeds. Audit log records the dependent counts in `metadata` for the record.

The dependents check is read-only; the actual delete + audit insert happen in one transaction.

---

## Self-Protection

Hard-coded checks (return `409 Conflict`, error code `self_action_blocked`):

- `DELETE /admin/users/:id` — refuse if `id === request.user.id`.
- `DELETE /admin/users/:id/groups/admin` — refuse if `id === request.user.id`.
- `PATCH /admin/users/:id` with `disabled: true` — refuse if `id === request.user.id`.

Editing your own cash balance, holdings, or other game data is **allowed** (audit log captures it).

---

## Endpoint Surface

All routes require admin group membership. All destructive routes accept `?force=true` where noted. All routes write to `admin_audit_log` inside the same transaction as the action.

### Users — `packages/server/src/routes/admin/users.ts`

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/users` | Paginated list. Query: `?q=` (username substring), `?limit`, `?offset`, `?sort=createdAt\|username`. |
| GET | `/admin/users/:id` | Detail: profile, group memberships, games joined, trade count. |
| PATCH | `/admin/users/:id` | Body: `{ username?, disabled? }`. Self-disable blocked. |
| DELETE | `/admin/users/:id` | Cascade-delete via FK. **409 if user owns any games**, even with `?force=true`. Self-delete blocked. |
| POST | `/admin/users/:id/reset-password` | Body: `{ newPassword }`. Argon2-hashed and stored. Returns `204`. |
| POST | `/admin/users/:id/groups/:groupName` | Add user to group. Idempotent (no-op if already member). |
| DELETE | `/admin/users/:id/groups/:groupName` | Remove user from group. Self-removal blocked when `groupName === 'admin'`. |

### Games — `packages/server/src/routes/admin/games.ts`

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/games` | Paginated list. Query: `?status`, `?q=` (name substring), `?ownerId`, `?limit`, `?offset`. |
| GET | `/admin/games/:id` | Detail: full settings, player count, owner, derived status. |
| PATCH | `/admin/games/:id` | Body: subset of `{ name, startDate, endDate, startingBalance, allowShortSelling, allowLimitOrders, allowStopOrders, allowBracketOrders, allowGTC }`. Triggers `recomputeGameStatus`. |
| PATCH | `/admin/games/:id/owner` | Body: `{ newOwnerId }`. If `newOwnerId` is not a player in this game, auto-enroll them with the game's `startingBalance`. Updates `games.createdBy`. |
| POST | `/admin/games/:id/status` | Body: `{ status: 'pending' \| 'active' \| 'ended' }`. Force-override the derived status by adjusting dates if needed, or by overriding the `status` column directly (document which — see open questions). |
| POST | `/admin/games/:id/reset` | Wipe all trades and portfolios, restore every `cashBalance` to `startingBalance`. Requires `?force=true` if game has any executed trades. |
| DELETE | `/admin/games/:id` | Cascade-delete via FK. |
| POST | `/admin/games/:id/players` | Body: `{ userId }`. Enroll user in game with `startingBalance`. |
| DELETE | `/admin/games/:id/players/:playerId` | Remove player and all their trades/holdings. |
| POST | `/admin/games/:id/cancel-working-orders` | Cancel every `working` or `pending` trade in this game. Reason recorded as `admin_bulk_cancel`. |
| POST | `/admin/games/:id/leaderboard-recompute` | Force leaderboard recompute and broadcast to WS subscribers. |

### Portfolios & cash — `packages/server/src/routes/admin/portfolios.ts`

| Method | Path | Purpose |
|---|---|---|
| PATCH | `/admin/players/:playerId/cash` | Body: `{ cashBalance, reason? }`. Set cash to arbitrary non-negative value. |
| POST | `/admin/players/:playerId/holdings` | Body: `{ symbol, quantityDelta, costBasis? }`. Add (positive delta) or remove (negative) shares. New row if symbol absent and delta > 0. Refuse if delta < 0 and abs > current quantity. |
| DELETE | `/admin/players/:playerId/holdings` | Wipe all holdings (rows deleted, cash unchanged). |

### Trades — `packages/server/src/routes/admin/trades.ts`

| Method | Path | Purpose |
|---|---|---|
| DELETE | `/admin/trades/:id` | Cancel a `working` or `pending` trade. Releases reservations. Refuse if already `executed` or `cancelled`. |
| POST | `/admin/trades/:id/force-execute` | Body: `{ price? }`. Force a working/pending trade to execute at `price` (or current quote if omitted). |
| POST | `/admin/trades/:id/reverse` | Undo an `executed` trade: restore cash + holdings, mark trade `cancelled` with reason `admin_reverse`. Refuse if downstream trades depend on this position (configurable check; v1 = always allow but log). |
| PATCH | `/admin/trades/:id/price` | Body: `{ price }`. Adjust fill price on an executed trade. Recompute cost basis & cash delta. |

### Market / system — `packages/server/src/routes/admin/system.ts`

| Method | Path | Purpose |
|---|---|---|
| POST | `/admin/market-status/override` | Body: `{ override: 'open' \| 'closed' \| null }`. Null clears override. |
| PATCH | `/admin/stocks/:symbol/price` | Body: `{ price, change?, changePercent? }`. Manually set cache entry. |
| POST | `/admin/stocks/cache/flush` | Truncate `stock_price_cache`. |
| GET | `/admin/stats` | Active WS connections, DB row counts per table, uptime. |

### Audit — `packages/server/src/routes/admin/audit.ts`

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/audit` | Paginated audit log. Query: `?action`, `?targetType`, `?targetId`, `?adminUserId`, `?since`, `?until`, `?limit`, `?offset`. |

---

## Audit Log Service

New file `packages/server/src/services/admin-audit.ts` exporting:

```ts
async function recordAdminAction(
  tx: DbTransaction,
  params: {
    adminUserId: string;
    action: string;
    targetType: 'user' | 'game' | 'trade' | 'portfolio' | 'system';
    targetId?: string | null;
    before?: unknown;
    after?: unknown;
    metadata?: unknown;
  },
): Promise<void>;
```

Always called within the same transaction as the mutation. JSON fields are `JSON.stringify`'d at write time, parsed at read time in the `GET /admin/audit` handler.

---

## Shared Types

New file `packages/shared/src/types/admin.ts`:

- Request/response shapes for every endpoint above.
- `AdminAuditEntry` type matching the parsed audit-log row (with `before`/`after`/`metadata` as `unknown`).
- `AdminDependentCounts` type for 409 conflict bodies.
- `GroupName` literal type — currently just `'admin'`, easy to extend later.

---

## File Layout

```
packages/server/src/
  routes/
    admin/
      _guard.ts            ← requireAdmin pre-handler + decorator setup
      users.ts
      games.ts
      portfolios.ts
      trades.ts
      system.ts
      audit.ts
      index.ts             ← composes all admin sub-routes under /admin
  services/
    admin-audit.ts         ← recordAdminAction helper
  db/
    schema.sqlite.ts       ← + groups, user_groups, admin_audit_log; cascade changes; users.disabled
    schema.pg.ts           ← mirror of above
    migrations/            ← new generated migration

packages/shared/src/types/
  admin.ts                 ← new
  auth.ts                  ← extend AuthUser with isAdmin? (optional, derived server-side)
```

---

## Existing Code to Reuse

- `recomputeGameStatus` (`packages/server/src/services/game-status.ts`) — call after `PATCH /admin/games/:id` and `POST /admin/games/:id/status` to keep derived status in sync.
- `cancelTrade` logic (`packages/server/src/services/trade.ts` / `working-order.ts`) — reuse for `DELETE /admin/trades/:id` and bulk-cancel.
- `leaderboardSnapshot` / broadcast logic — reuse for `POST /admin/games/:id/leaderboard-recompute`.
- Argon2 hashing helper (currently inline in `auth.ts`) — extract to `services/password.ts` if not already, reuse for `reset-password`.
- Existing JWT decorator/auth plugin — `requireAdmin` builds on `request.jwtVerify()`.

---

## Open Questions (for implementation phase)

1. **`POST /admin/games/:id/status`**: should it overwrite the `status` column directly (bypassing `recomputeGameStatus`), or adjust `startDate`/`endDate` so the derived status matches? Current architecture recomputes from dates, so direct column override would drift. Probably: adjust dates.
2. **`POST /admin/trades/:id/reverse`** on positions that have since been sold: v1 just allows it (cash + holdings may go negative, audit log shows the mess). A stricter check is deferred.
3. **Rate-limiting on admin routes**: current routes have per-route limits. Admin routes probably want higher limits or none. Default: no rate limit on `/admin/*`.

---

## Verification

End-to-end checks for the implementation phase:

1. `pnpm typecheck` clean across all packages.
2. `pnpm --filter server test` — new test files:
   - `tests/admin/auth.test.ts`: register first user → has admin; register second → does not. `requireAdmin` blocks non-admins.
   - `tests/admin/users.test.ts`: list, detail, delete with/without `?force`, owner-of-game blocks delete, self-delete blocked, group add/remove, self group-remove blocked.
   - `tests/admin/games.test.ts`: owner transfer (with and without auto-enroll), edit settings, reset, cascade delete, bulk-cancel.
   - `tests/admin/portfolios.test.ts`: cash edit, holdings adjust (positive/negative delta, refuse over-sell), wipe.
   - `tests/admin/trades.test.ts`: cancel working, force-execute, reverse executed, edit price.
   - `tests/admin/audit.test.ts`: every action above produces exactly one audit row with correct `before`/`after`; failed actions produce zero rows (transactional).
3. Manual sanity via `pnpm dev`: register two users, promote second to admin, demote first, verify both flows work; delete a game via curl with and without `?force`.
4. Drizzle migration applies cleanly to a fresh SQLite db and to a Postgres db.

---

## Out of Scope

- Frontend admin UI (separate spec).
- Impersonation endpoint (dropped per user decision — too risky for v1).
- Bulk operations across games (no "delete all ended games" etc.).
- Audit log export / archival.
- Webhook notifications on admin actions.
- IP allowlisting or 2FA for admins (defer until prod hardening).
