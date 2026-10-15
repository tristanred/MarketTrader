# User Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-user API and resource limits (global defaults, per-user overrides, probation for new accounts, a privileged-IP multiplier, admin immunity) with per-user usage monitoring and an admin panel, plus the Phase 0 validation fixes that close the worst soft-abuse holes on their own.

**Architecture:** One `LimitResolver` (admin → override → probation → privileged multiplier) feeds three enforcement mechanisms: `@fastify/rate-limit` keyed per user for request rates, `LimitEnforcer.enforce()` counting real rows for quotas and concurrent caps, and a WS admission layer. Global limit values are live options in the existing `/admin/config` registry; per-user overrides live in a new `user_limit_overrides` table. Usage is aggregated in memory by a `UsageTracker` and rolled up hourly into two tables by a worker, read by a new admin API and UI.

**Tech Stack:** Fastify v5, `@fastify/rate-limit` 10.3, Drizzle ORM (SQLite + Postgres), Zod, Node `net.BlockList`, React 19, React Query v5, ShadCN/UI, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-user-limits-design.md` — read it before starting any task; this plan argues from it.

**Branch:** `feat/user-limits`, stacked on `feat/admin-config-panel` (PR #30). Rebase after #30 merges.

## Global Constraints

- TypeScript strict; no `any` — use `unknown` and narrow, or a type in `packages/shared`.
- Comments explain *why* only; JSDoc (1–4 lines) on every exported function/class/interface in `services/`, `providers/`, `routes/`, `limits/`, and on every shared type and every new Drizzle table.
- Validate at route entry with Zod; no raw SQL — Drizzle query builder only (`sql` template fragments for expressions are fine, matching existing code).
- Schema changes go in **both** `schema.sqlite.ts` and `schema.pg.ts`; generate migrations twice (`pnpm --filter server db:generate`, then `DATABASE_URL=postgres://u:p@localhost:5432/x pnpm --filter server db:generate`). Never hand-edit migration files.
- On Postgres numeric/count columns come back as strings — wrap reads in `Number(...)`.
- Live options are read per use via `ConfigReader.get(...)`, never cached at construction; only `config/runtime-config.ts` may import `liveBootConfig`.
- Every new live integer option has `min` and `max` in its registry descriptor.
- Admins are immune to every limit; per-user overrides are absolute (no multipliers); probation = `max(1, ceil(base × LIMITS_PROBATION_PERCENT / 100))`; privileged multiplier default 10.
- Concurrent caps → HTTP 409; rate and windowed quota denials → HTTP 429 with `Retry-After`; both with body `LimitExceededBody` (`code: 'LIMIT_EXCEEDED'`).
- WS close code `4429` = limit exceeded, disjoint from 1008 (credential) and 4400 (invalid frame); clients treat it as backoff, never as a token refresh.
- No user IDs on OTel metric attributes.
- The test fixture (`createTestAppWithDb`) defaults to `limits: { disabled: true }`; limit tests opt in with `limits: { disabled: false }`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Server tests: `pnpm build:shared && pnpm --filter server exec vitest run <path>`; frontend: `pnpm --filter frontend exec vitest run <path>`; full: `pnpm test && pnpm typecheck && pnpm lint`.

## Review Focus

Inputs and conditions the spec implies that are most likely to bite a real user. Each has a test pinned in the task that owns the code.

1. **IPv4-mapped IPv6 client addresses** (`::ffff:203.0.113.7`, what Node reports on a dual-stack listener) against an IPv4 entry in `LIMITS_PRIVILEGED_CIDRS` — must match, or the office gets no multiplier. → Task 6.
2. **SQLite `created_at` text (`YYYY-MM-DD HH:MM:SS`, no `T`/`Z`) vs ISO window boundaries** — a game created 6 days 23 hours ago must count toward the 7-day quota, and one created 7 days 1 hour ago must not. → Task 9.
3. **An admin demoted mid-session** must lose immunity on the very next request with the same token. → Task 7.
4. **An override lowered below current usage** (user owns 5 active games, override set to 2) — existing games are untouched, the next create is denied with 409, and the admin card shows `5 / 2` without crashing. → Tasks 9 and 16.
5. **Changing a policy option live** (`LIMITS_PROBATION_PERCENT`, `LIMITS_MATURITY_DAYS`, `LIMITS_PRIVILEGED_CIDRS`) takes effect on the next request without restart. → Task 8.

---
## File Structure

New server module `packages/server/src/limits/`, one responsibility per file:

| File | Task | Responsibility |
|---|---|---|
| `cidr.ts` | 6 | IP/CIDR parsing and matching (`net.BlockList`), IPv4-mapped normalisation |
| `catalogue.ts` | 6 | `LIMIT_CATALOGUE` — kind, config key, window, probation, overridable, label per `LimitKey` |
| `policy.ts` | 6 | `isMatureUser`, `maturityEndsAt`, `isPrivilegedConnection` |
| `account.ts` | 7 | `RequestAccount`, `loadAccount` (users row + admin EXISTS in one query), `toIsoUtc` |
| `overrides.ts` | 7 | `LimitOverridesService` — cached, audited per-user overrides |
| `resolver.ts` | 8 | `LimitResolver` — admin → override → probation → privileged |
| `errors.ts` | 8 | `LimitExceededError`, body builder, root error handler |
| `enforce.ts` | 8 | `LimitEnforcer`, `secondsUntilWindowFrees` |
| `index.ts` | 8 | `createLimits()` → `Limits { config, resolver, overrides, enforcer, tracker }` |
| `quota-counts.ts` | 9 | Counts from source tables, window starts, `assertOpenOrderCapacity` |
| `rate.ts` | 10 | `rateLimitFor`, `withPrivilegedIp`, `rateDenialLabel` |
| `sliding-window.ts` | 12 | `SlidingWindowCounter` |
| `usage-tracker.ts` | 14 | In-memory request/denial aggregation, sliding minute counter |
| `usage-hooks.ts` | 14 | `onResponse` recorder, `apiRequests` ceiling `preHandler`, denial recorders |
| `usage-store.ts` | 15 | Rollup flush/prune and admin read queries |

Other new files: `services/game-bounds.ts` (1), `services/open-orders.ts` (3; folded into `quota-counts.ts` by Task 9),
`ws/limits.ts` (12), `workers/usage-rollup.ts` (15), `routes/admin/limits.ts` (16), `tests/helpers/users.ts` (7),
`packages/shared/src/types/limits.ts` (6); frontend `lib/limits.ts` (13), `lib/limitLabels.ts`, `api/admin/limits.ts`,
`components/admin/{LimitUsage,LimitOverrideEditor,UserLimitsCard}.tsx` (17),
`components/admin/PrivilegedIpBanner.tsx`, `pages/admin/AdminLimitsPage.tsx` (18); `docs/pii-inventory.md` (19).

Final route-factory signatures after all tasks: `gameRoutes(db, limits, bus?)`,
`tradingRoutes(db, provider, msp, config, limits, registry?, throttle?, bus?)`, `watchlistRoutes(db, limits)`,
`authRoutes(db, loginThrottle, limits)`, `liveRoute(db, registry, engine, revalidateIntervalMs?, wsLimits?)`,
`globalLiveRoute(db, registry, revalidateIntervalMs?, wsLimits?)`; `adminRoutes` gains `limits` and `wsConnectionCount` (Task 16).

## Phases

- **Phase 0 (Tasks 1–5):** validation fixes, independent of the limits engine — shippable alone.
- **Phase 1 (Tasks 6–8):** catalogue, policy, account, overrides, resolver, enforcer.
- **Phase 2 (Tasks 9–13):** enforcement — quotas, rates, registration, WebSocket, player-facing errors.
- **Phase 3 (Tasks 14–16):** monitoring — tracker, rollup worker, admin API.
- **Phase 4 (Tasks 17–19):** admin UI, docs, final verification.

---

## Phase 0 — Validation fixes

These five tasks need nothing from the limits engine. They close the worst soft-abuse holes on their own and ship first.

**Phase-wide decision: game date bounds in tests.** About 20 server test files create games through `POST /games` with fixed windows like `2020-01-01 → 2099-01-01` or `2099-01-01 → 2099-06-01`. Both break once `GAME_MAX_DURATION_DAYS` (365) and `GAME_MAX_START_DELAY_DAYS` (90) exist. Rewriting them to relative dates is churn, and fixed dates in a 365-day window would rot after a year anyway.

Instead, Task 1 sets lenient values for both keys in `packages/server/vitest.config.ts` → `test.env`. That flows into `liveBootConfig`, so every `RuntimeConfig.fromEnvironment(...)` and every direct `buildApp(...)` in the suite inherits it. Tests that exercise the bounds pass strict values explicitly through `RuntimeConfig.fromEnvironment({ GAME_MAX_DURATION_DAYS: 365, GAME_MAX_START_DELAY_DAYS: 90 })`. Later tasks that build their own `RuntimeConfig` inherit the lenient values automatically.

---

### Task 1: Game creation bounds (starting balance, duration, start delay)

**Files:**
- Modify: `packages/server/src/env.ts`: add `parseNonNegativeInt`, plus three keys in `liveBootConfig`.
- Modify: `packages/server/src/config/registry.ts`: three descriptors in the `limits` section.
- Create: `packages/server/src/services/game-bounds.ts`
- Modify: `packages/server/src/routes/games.ts`: new `config` parameter, and the check in `POST /games`.
- Modify: `packages/server/src/app.ts:170`: pass `runtimeConfig` to `gameRoutes`.
- Modify: `packages/server/vitest.config.ts`: lenient test env.
- Test: `packages/server/tests/services/game-bounds.test.ts` (create)
- Test: `packages/server/tests/routes/games-bounds.test.ts` (create)

**Interfaces:**
- Consumes: `ConfigReader` (`S/config/runtime-config.ts`).
- Produces:
  - `checkGameBounds(input: GameBoundsInput, config: ConfigReader, now?: number): string | null`. Returns the error message, or `null` when the input is within bounds.
  - `parseNonNegativeInt(name: string, raw: string): number` in `env.ts`. Module-private; Task 6 reuses it in the same file.
  - `gameRoutes(db: Db, config: ConfigReader, bus?: EventBus)`. **The signature changes:** `config` is now the second parameter.
  - Live keys `GAME_MAX_STARTING_BALANCE`, `GAME_MAX_DURATION_DAYS`, `GAME_MAX_START_DELAY_DAYS`.

- [ ] **Step 1: Write the failing unit test**

Create `packages/server/tests/services/game-bounds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { checkGameBounds } from '../../src/services/game-bounds.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const strict = RuntimeConfig.fromEnvironment({
  GAME_MAX_STARTING_BALANCE: 10_000_000,
  GAME_MAX_DURATION_DAYS: 365,
  GAME_MAX_START_DELAY_DAYS: 90,
});

function input(startOffsetDays: number, durationDays: number, startingBalance = 100_000) {
  const start = NOW + startOffsetDays * DAY;
  return {
    startDate: new Date(start).toISOString(),
    endDate: new Date(start + durationDays * DAY).toISOString(),
    startingBalance,
  };
}

describe('checkGameBounds', () => {
  it('accepts a game inside every bound', () => {
    expect(checkGameBounds(input(1, 30), strict, NOW)).toBeNull();
  });

  it('accepts exactly the maximum starting balance', () => {
    expect(checkGameBounds(input(1, 30, 10_000_000), strict, NOW)).toBeNull();
  });

  it('rejects a starting balance above the maximum', () => {
    expect(checkGameBounds(input(1, 30, 10_000_001), strict, NOW)).toMatch(/startingBalance/);
  });

  it('accepts exactly the maximum duration', () => {
    expect(checkGameBounds(input(1, 365), strict, NOW)).toBeNull();
  });

  it('rejects a duration one day over the maximum', () => {
    expect(checkGameBounds(input(1, 366), strict, NOW)).toMatch(/365 days/);
  });

  it('accepts a start exactly at the maximum delay', () => {
    expect(checkGameBounds(input(90, 10), strict, NOW)).toBeNull();
  });

  it('rejects a start beyond the maximum delay', () => {
    expect(checkGameBounds(input(91, 10), strict, NOW)).toMatch(/90 days/);
  });

  it('accepts a start date in the past', () => {
    expect(checkGameBounds(input(-10, 30), strict, NOW)).toBeNull();
  });

  it('reads the config on every call so an override applies immediately', () => {
    const config = RuntimeConfig.fromEnvironment({
      GAME_MAX_STARTING_BALANCE: 10_000_000,
      GAME_MAX_DURATION_DAYS: 365,
      GAME_MAX_START_DELAY_DAYS: 90,
    });
    expect(checkGameBounds(input(1, 30, 5_000), config, NOW)).toBeNull();
    config.set('GAME_MAX_STARTING_BALANCE', 1_000);
    expect(checkGameBounds(input(1, 30, 5_000), config, NOW)).toMatch(/startingBalance/);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/services/game-bounds.test.ts`
Expected: FAIL with `Failed to load url ../../src/services/game-bounds.js`, or a type error naming the unknown `GAME_MAX_*` keys.

- [ ] **Step 3: Add the env parser and the live keys**

In `packages/server/src/env.ts`, directly below `parsePositiveInt`:

```ts
function parseNonNegativeInt(name: string, raw: string): number {
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 0) {
    throw new Error(`Invalid ${name}: "${raw}". Must be a non-negative integer.`);
  }
  return n;
}
```

In `liveBootConfig`, directly after the `WATCHLIST_MAX_PER_USER` entry:

```ts
  /** Largest `startingBalance` a player may give a new game. Bounds the featured-games ranking input. */
  GAME_MAX_STARTING_BALANCE: parsePositiveInt(
    'GAME_MAX_STARTING_BALANCE',
    optional('GAME_MAX_STARTING_BALANCE', '10000000'),
  ),
  /** Longest a new game may run, in days. Workers write rows for every live game, so open-ended games are unbounded cost. */
  GAME_MAX_DURATION_DAYS: parsePositiveInt(
    'GAME_MAX_DURATION_DAYS',
    optional('GAME_MAX_DURATION_DAYS', '365'),
  ),
  /** How far in the future a new game's start date may be, in days. */
  GAME_MAX_START_DELAY_DAYS: parseNonNegativeInt(
    'GAME_MAX_START_DELAY_DAYS',
    optional('GAME_MAX_START_DELAY_DAYS', '90'),
  ),
```

In `packages/server/src/config/registry.ts`, in the `// ── limits ──` section after `WATCHLIST_MAX_PER_USER`:

```ts
  GAME_MAX_STARTING_BALANCE: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1_000, max: 1_000_000_000,
    description: 'Largest starting balance a player may give a new game. Admin edits are not checked.',
  },
  GAME_MAX_DURATION_DAYS: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 3_650,
    description: 'Longest a new game may run, in days.',
  },
  GAME_MAX_START_DELAY_DAYS: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 0, max: 3_650,
    description: 'How far ahead a new game may be scheduled to start, in days.',
  },
```

In `packages/server/vitest.config.ts`, extend `test.env`:

```ts
    env: {
      DATABASE_URL: ':memory:',
      JWT_SECRET: 'test-secret-not-used-in-production',
      // Fixtures across the suite create games on fixed windows like
      // 2020 → 2099. Tests of the bounds pass strict values explicitly.
      GAME_MAX_DURATION_DAYS: '100000',
      GAME_MAX_START_DELAY_DAYS: '100000',
    },
```

- [ ] **Step 4: Implement `checkGameBounds`**

Create `packages/server/src/services/game-bounds.ts`:

```ts
import type { ConfigReader } from '../config/runtime-config.js';

const DAY_MS = 86_400_000;

/** The `POST /games` fields that the live game bounds constrain. */
export interface GameBoundsInput {
  startDate: string;
  endDate: string;
  startingBalance: number;
}

/**
 * Checks a new game against `GAME_MAX_STARTING_BALANCE`, `GAME_MAX_DURATION_DAYS`
 * and `GAME_MAX_START_DELAY_DAYS`, read on every call so an admin override applies
 * to the next request. Returns the first violation's message, or `null`.
 */
export function checkGameBounds(
  input: GameBoundsInput,
  config: ConfigReader,
  now: number = Date.now(),
): string | null {
  const maxBalance = config.get('GAME_MAX_STARTING_BALANCE');
  if (input.startingBalance > maxBalance) {
    return `startingBalance must be at most ${maxBalance}`;
  }

  const start = Date.parse(input.startDate);
  const end = Date.parse(input.endDate);

  const maxDays = config.get('GAME_MAX_DURATION_DAYS');
  if (end - start > maxDays * DAY_MS) {
    return `A game may run for at most ${maxDays} days`;
  }

  const maxDelay = config.get('GAME_MAX_START_DELAY_DAYS');
  if (start - now > maxDelay * DAY_MS) {
    return `A game must start within ${maxDelay} days`;
  }

  return null;
}
```

- [ ] **Step 5: Run the unit test and confirm it passes**

Run: `pnpm --filter server exec vitest run tests/services/game-bounds.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Write the failing route test**

Create `packages/server/tests/routes/games-bounds.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

const DAY = 86_400_000;

function window(startOffsetDays: number, durationDays: number) {
  const start = Date.now() + startOffsetDays * DAY;
  return {
    startDate: new Date(start).toISOString(),
    endDate: new Date(start + durationDays * DAY).toISOString(),
  };
}

describe('POST /games bounds', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp(undefined, undefined, {
      runtimeConfig: RuntimeConfig.fromEnvironment({
        GAME_MAX_STARTING_BALANCE: 10_000_000,
        GAME_MAX_DURATION_DAYS: 365,
        GAME_MAX_START_DELAY_DAYS: 90,
      }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'bounds-user', password: 'password123' },
    });
    token = res.json<{ token: string }>().token;
  });
  afterAll(() => app.close());

  function create(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'Bounded', startingBalance: 100_000, ...window(1, 30), ...payload },
    });
  }

  it('creates a game inside every bound', async () => {
    expect((await create({})).statusCode).toBe(201);
  });

  it('rejects a starting balance above GAME_MAX_STARTING_BALANCE with 400', async () => {
    const res = await create({ startingBalance: 1e12 });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/startingBalance/);
  });

  it('rejects a game longer than GAME_MAX_DURATION_DAYS with 400', async () => {
    const res = await create(window(1, 400));
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/365 days/);
  });

  it('rejects a start further out than GAME_MAX_START_DELAY_DAYS with 400', async () => {
    const res = await create(window(120, 10));
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toMatch(/90 days/);
  });

  it('creates no row for a rejected game', async () => {
    const before = await app.inject({
      method: 'GET', url: '/games', headers: { Authorization: `Bearer ${token}` },
    });
    await create({ startingBalance: 1e12 });
    const after = await app.inject({
      method: 'GET', url: '/games', headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.json<unknown[]>()).toHaveLength(before.json<unknown[]>().length);
  });
});
```

- [ ] **Step 7: Run the route test and confirm it fails**

Run: `pnpm --filter server exec vitest run tests/routes/games-bounds.test.ts`
Expected: FAIL. The three rejection tests get `201` instead of `400`.

- [ ] **Step 8: Wire the check into `POST /games`**

In `packages/server/src/routes/games.ts`, add the imports:

```ts
import type { ConfigReader } from '../config/runtime-config.js';
import { checkGameBounds } from '../services/game-bounds.js';
```

Change the factory signature and its JSDoc:

```ts
 * All routes recompute game status on the fly so `pending`/`active`/`ended`
 * reflects real time rather than the stored snapshot. `config` supplies the
 * live game bounds checked on create.
 */
export function gameRoutes(db: Db, config: ConfigReader, bus?: EventBus) {
```

In the `app.post('/games', …)` handler, directly after `const userId = request.user.id;`:

```ts
      const boundsError = checkGameBounds({ startDate, endDate, startingBalance }, config);
      if (boundsError) return reply.status(400).send({ error: boundsError });
```

In `packages/server/src/app.ts`, change `await app.register(gameRoutes(db, bus));` to:

```ts
  await app.register(gameRoutes(db, runtimeConfig, bus));
```

- [ ] **Step 9: Run the new tests, then the full server suite**

Run: `pnpm --filter server exec vitest run tests/routes/games-bounds.test.ts tests/services/game-bounds.test.ts tests/config/registry.test.ts`
Expected: PASS.

Run: `pnpm test`
Expected: PASS. If an existing test now gets a 400 from `POST /games`, it built its config without the lenient env. Check that `vitest.config.ts` `test.env` was saved. Don't edit the test's dates.

- [ ] **Step 10: Typecheck and commit**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

```bash
git add packages/server/src/env.ts packages/server/src/config/registry.ts \
  packages/server/src/services/game-bounds.ts packages/server/src/routes/games.ts \
  packages/server/src/app.ts packages/server/vitest.config.ts \
  packages/server/tests/services/game-bounds.test.ts packages/server/tests/routes/games-bounds.test.ts
git commit -m "feat(games): bound starting balance, duration and start delay on create

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Maximum players per game

**Files:**
- Modify: `packages/server/src/env.ts`: `GAME_MAX_PLAYERS` in `liveBootConfig`.
- Modify: `packages/server/src/config/registry.ts`: descriptor.
- Modify: `packages/server/src/routes/games.ts`: the check in `POST /games/:id/join`.
- Test: `packages/server/tests/routes/games-max-players.test.ts` (create)

**Interfaces:**
- Consumes: `gameRoutes(db, config, bus?)` from Task 1.
- Produces:
  - Live key `GAME_MAX_PLAYERS`.
  - The join route answers `409 { error: 'Game is full', code: 'GAME_FULL' }`.
  - The admin route `POST /admin/games/:id/players` is deliberately not checked.

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/routes/games-max-players.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, registerAdmin } from '../helpers/app.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

async function register(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id };
}

describe('GAME_MAX_PLAYERS', () => {
  let app: FastifyInstance;
  let gameId: string;

  beforeAll(async () => {
    app = await createTestApp(undefined, undefined, {
      runtimeConfig: RuntimeConfig.fromEnvironment({ GAME_MAX_PLAYERS: 2 }),
    });
    const owner = await register(app, 'cap-owner');
    const res = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${owner.token}` },
      payload: {
        name: 'Two Seats',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2099-01-01T00:00:00.000Z',
        startingBalance: 10_000,
      },
    });
    gameId = res.json<{ id: string }>().id;
  });
  afterAll(() => app.close());

  function join(token: string) {
    return app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  it('lets players join up to the cap (the creator holds the first seat)', async () => {
    const second = await register(app, 'cap-second');
    expect((await join(second.token)).statusCode).toBe(201);
  });

  it('refuses the next join with 409 GAME_FULL', async () => {
    const third = await register(app, 'cap-third');
    const res = await join(third.token);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Game is full', code: 'GAME_FULL' });
  });

  it('still lets an admin seat a player past the cap', async () => {
    const admin = await registerAdmin(app, 'cap-admin');
    const fourth = await register(app, 'cap-fourth');
    const res = await app.inject({
      method: 'POST',
      url: `/admin/games/${gameId}/players`,
      headers: { Authorization: `Bearer ${admin.token}` },
      payload: { userId: fourth.userId },
    });
    expect(res.statusCode).toBeLessThan(300);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter server exec vitest run tests/routes/games-max-players.test.ts`
Expected: FAIL. TypeScript rejects `GAME_MAX_PLAYERS` as an unknown key. With the type error ignored, the second test gets `201` instead of `409`.

- [ ] **Step 3: Add the live key**

`packages/server/src/env.ts`, in `liveBootConfig` after `GAME_MAX_START_DELAY_DAYS`:

```ts
  /** Most players one game may hold. Joins past it are refused with 409 GAME_FULL. */
  GAME_MAX_PLAYERS: parsePositiveInt('GAME_MAX_PLAYERS', optional('GAME_MAX_PLAYERS', '100')),
```

`packages/server/src/config/registry.ts`, after `GAME_MAX_START_DELAY_DAYS`:

```ts
  GAME_MAX_PLAYERS: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 2, max: 10_000,
    description: 'Most players one game may hold. A property of the game, so it has no per-user override. Admin seating is not checked.',
  },
```

- [ ] **Step 4: Enforce it in the join route**

In `packages/server/src/routes/games.ts`, inside `app.post('/games/:id/join', …)`, directly after `if (status === 'ended') return reply.status(409).send({ error: 'Game has ended' });`:

```ts
      // Count-then-insert can overshoot by one under concurrent joins; the cap
      // exists to stop leaderboard flooding, which one extra seat does not enable.
      const [{ players } = { players: 0 }] = await db
        .select({ players: count() })
        .from(gamePlayers)
        .where(eq(gamePlayers.gameId, gameId));
      if (Number(players) >= config.get('GAME_MAX_PLAYERS')) {
        return reply.status(409).send({ error: 'Game is full', code: 'GAME_FULL' });
      }
```

Add a line to the `gameRoutes` JSDoc list entry for join:

```ts
 * - `POST /games/:id/join` — join an existing game (rejected if ended, or full per `GAME_MAX_PLAYERS`).
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm --filter server exec vitest run tests/routes/games-max-players.test.ts tests/routes/games.test.ts tests/config/registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/env.ts packages/server/src/config/registry.ts \
  packages/server/src/routes/games.ts packages/server/tests/routes/games-max-players.test.ts
git commit -m "feat(games): cap players per game with live GAME_MAX_PLAYERS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pending orders count toward the open-order cap

**Files:**
- Create: `packages/server/src/services/open-orders.ts`
- Modify: `packages/server/src/services/working-order.ts`: move the constant and use the shared check.
- Modify: `packages/server/src/services/pending-trade.ts:63-136`: call the check inside the transaction.
- Test: `packages/server/tests/services/pending-trade-cap.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `assertOpenOrderCapacity(tx: OpenOrdersReader, gamePlayerId: string, rowsToInsert: number, max?: number): Promise<void>`. Throws `TradeError('TOO_MANY_OPEN_ORDERS')`.
  - `MAX_OPEN_ORDERS_PER_PLAYER`, still exported from `working-order.ts` and re-exported from `open-orders.ts`. Task 9 replaces the default `max` with the resolved per-user limit by passing `max` explicitly.

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/services/pending-trade-cap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import { reservePendingTrade } from '../../src/services/pending-trade.js';
import { MAX_OPEN_ORDERS_PER_PLAYER } from '../../src/services/working-order.js';
import { schema } from '../../src/db/index.js';

async function seed() {
  const db = await createTestDb();
  const [user] = await db
    .insert(schema.users)
    .values({ username: `u_${Math.random().toString(36).slice(2, 10)}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('seed user');
  const [game] = await db
    .insert(schema.games)
    .values({
      name: 'g',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 1_000_000,
      status: 'active',
      createdBy: user.id,
    })
    .returning({ id: schema.games.id });
  if (!game) throw new Error('seed game');
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game.id, userId: user.id, cashBalance: 1_000_000 })
    .returning({ id: schema.gamePlayers.id });
  if (!gp) throw new Error('seed gp');
  return { db, gamePlayerId: gp.id };
}

function pendingBuy(gamePlayerId: string) {
  return { gamePlayerId, symbol: 'AAPL', direction: 'buy' as const, quantity: 1, reservedPrice: 1 };
}

describe('reservePendingTrade open-order cap', () => {
  it('refuses a pending order once the player holds the maximum open rows', async () => {
    const { db, gamePlayerId } = await seed();
    for (let i = 0; i < MAX_OPEN_ORDERS_PER_PLAYER; i++) {
      await reservePendingTrade(db, pendingBuy(gamePlayerId));
    }

    await expect(reservePendingTrade(db, pendingBuy(gamePlayerId))).rejects.toMatchObject({
      code: 'TOO_MANY_OPEN_ORDERS',
    });

    const pending = await db
      .select({ id: schema.trades.id })
      .from(schema.trades)
      .where(and(eq(schema.trades.gamePlayerId, gamePlayerId), eq(schema.trades.status, 'pending')));
    expect(pending).toHaveLength(MAX_OPEN_ORDERS_PER_PLAYER);
  });

  it('does not deduct cash for a refused pending buy', async () => {
    const { db, gamePlayerId } = await seed();
    for (let i = 0; i < MAX_OPEN_ORDERS_PER_PLAYER; i++) {
      await reservePendingTrade(db, pendingBuy(gamePlayerId));
    }
    const cashBefore = await cashOf(db, gamePlayerId);
    await expect(reservePendingTrade(db, pendingBuy(gamePlayerId))).rejects.toBeDefined();
    expect(await cashOf(db, gamePlayerId)).toBe(cashBefore);
  });

  it('counts working rows toward the same cap', async () => {
    const { db, gamePlayerId } = await seed();
    await db.insert(schema.trades).values(
      Array.from({ length: MAX_OPEN_ORDERS_PER_PLAYER }, () => ({
        gamePlayerId,
        symbol: 'MSFT',
        direction: 'buy' as const,
        quantity: 1,
        status: 'working' as const,
        orderType: 'limit' as const,
        limitPrice: 0.01,
      })),
    );
    await expect(reservePendingTrade(db, pendingBuy(gamePlayerId))).rejects.toMatchObject({
      code: 'TOO_MANY_OPEN_ORDERS',
    });
  });
});

async function cashOf(db: Awaited<ReturnType<typeof createTestDb>>, gamePlayerId: string) {
  const [row] = await db
    .select({ cash: schema.gamePlayers.cashBalance })
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.id, gamePlayerId));
  return Number(row?.cash);
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter server exec vitest run tests/services/pending-trade-cap.test.ts`
Expected: FAIL. The 51st `reservePendingTrade` resolves instead of rejecting with `TOO_MANY_OPEN_ORDERS`.

- [ ] **Step 3: Extract the shared check**

Create `packages/server/src/services/open-orders.ts`:

```ts
import { and, eq, or } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { TradeError } from '../providers/index.js';

/**
 * Ceiling on `working` + `pending` rows one game-player may hold open.
 *
 * Resting rows are re-quoted by the trigger worker and the price poller on
 * every tick, so an unbounded pile of them is an unbounded outbound-request
 * amplifier against the shared upstream provider. Nothing expires them today:
 * `expireDayOrders` needs `expiresAt`, which the trade route never sets.
 */
export const MAX_OPEN_ORDERS_PER_PLAYER = 50;

/** A database handle or transaction that can run the count. */
export type OpenOrdersReader = Pick<Db, 'select'>;

/**
 * Throws `TOO_MANY_OPEN_ORDERS` when inserting `rowsToInsert` more resting rows
 * would push the player past `max`. Run it inside the inserting transaction so
 * the count and the insert see the same rows.
 *
 * @throws {TradeError} `TOO_MANY_OPEN_ORDERS`
 */
export async function assertOpenOrderCapacity(
  tx: OpenOrdersReader,
  gamePlayerId: string,
  rowsToInsert: number,
  max: number = MAX_OPEN_ORDERS_PER_PLAYER,
): Promise<void> {
  const { trades } = schema;
  const open = await tx
    .select({ id: trades.id })
    .from(trades)
    .where(
      and(
        eq(trades.gamePlayerId, gamePlayerId),
        or(eq(trades.status, 'working'), eq(trades.status, 'pending')),
      ),
    );
  if (open.length + rowsToInsert > max) {
    throw new TradeError(
      'TOO_MANY_OPEN_ORDERS',
      `Too many open orders (limit ${max}); cancel one first`,
    );
  }
}
```

In `packages/server/src/services/working-order.ts`:

1. Delete the `MAX_OPEN_ORDERS_PER_PLAYER` declaration and its JSDoc block. Replace them with:

```ts
import { assertOpenOrderCapacity } from './open-orders.js';

export { MAX_OPEN_ORDERS_PER_PLAYER } from './open-orders.js';
```

Put the `import` with the other imports at the top of the file, and the `export … from` where the constant used to be.

2. Inside `db.transaction(async (tx) => {` in `placeWorkingOrder`, replace this block:

```ts
    const rowsToInsert = orderType === 'bracket' ? 3 : 1;
    const open = await tx
      .select({ id: trades.id })
      .from(trades)
      .where(
        and(
          eq(trades.gamePlayerId, gamePlayerId),
          or(eq(trades.status, 'working'), eq(trades.status, 'pending')),
        ),
      );
    if (open.length + rowsToInsert > MAX_OPEN_ORDERS_PER_PLAYER) {
      throw new TradeError(
        'TOO_MANY_OPEN_ORDERS',
        `Too many open orders (limit ${MAX_OPEN_ORDERS_PER_PLAYER}); cancel one first`,
      );
    }
```

with:

```ts
    await assertOpenOrderCapacity(tx, gamePlayerId, orderType === 'bracket' ? 3 : 1);
```

If `or` is no longer used anywhere else in `working-order.ts`, remove it from the `drizzle-orm` import (lint flags it).

In `packages/server/src/services/pending-trade.ts`, add the import:

```ts
import { assertOpenOrderCapacity } from './open-orders.js';
```

In `reservePendingTrade`, make the check the first statement inside the transaction:

```ts
  return db.transaction(async (tx) => {
    await assertOpenOrderCapacity(tx, gamePlayerId, 1);

    const [player] = await tx
```

Append to its JSDoc `@throws` line:

```ts
 * @throws {TradeError} `INSUFFICIENT_FUNDS` / `INSUFFICIENT_SHARES` /
 *   `INVALID_QUANTITY` / `INVALID_SYMBOL` on validation failure, and
 *   `TOO_MANY_OPEN_ORDERS` when the player already holds the open-order cap.
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm --filter server exec vitest run tests/services/pending-trade-cap.test.ts tests/services/pending-trade.test.ts tests/security/f20-resting-order-symbol.test.ts tests/routes/trading-market-hours.test.ts`
Expected: PASS.

No route change is needed. The pending branch of `POST /games/:id/trades` (`routes/trading.ts:352`) already maps every `TradeError` to `422 { code, message }`, the same as the working branch, so `TOO_MANY_OPEN_ORDERS` reaches the client unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/open-orders.ts packages/server/src/services/working-order.ts \
  packages/server/src/services/pending-trade.ts \
  packages/server/tests/services/pending-trade-cap.test.ts
git commit -m "fix(trading): count pending orders toward the open-order cap

reservePendingTrade never checked MAX_OPEN_ORDERS_PER_PLAYER, so orders
placed while the market was closed bypassed it entirely.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Paginate `/games/browse`

**Files:**
- Modify: `packages/shared/src/types/game.ts`: `BrowseGamesResponse`.
- Modify: `packages/server/src/routes/games.ts`: query schema, and slicing in `GET /games/browse`.
- Modify: `packages/server/tests/routes/games.test.ts:37-39`, and the browse assertions at 466-487.
- Modify: `packages/server/tests/admin/admin.test.ts:203-221`
- Modify: `packages/frontend/src/api/games.ts`: `useBrowsableGames` becomes infinite.
- Modify: `packages/frontend/src/components/game/BrowseGamesSection.tsx`: "Load more", plus the total.
- Modify: `packages/frontend/tests/GamesListPage.test.tsx:29-39`: new mock shape.
- Test: `packages/server/tests/routes/games-browse-pagination.test.ts` (create)
- Test: `packages/frontend/tests/BrowseGamesSection.test.tsx` (create)

**Interfaces:**
- Consumes: `gameRoutes(db, config, bus?)` from Task 1.
- Produces:
  - `BrowseGamesResponse { games: BrowsableGame[]; total: number }`.
  - `GET /games/browse?limit=1..50 (default 20)&offset>=0 (default 0)`.
  - Frontend `useBrowsableGames()` returns the infinite query plus `games: BrowsableGame[]` and `total: number`. `BROWSE_PAGE_SIZE = 20`.

- [ ] **Step 1: Write the failing server test**

Create `packages/server/tests/routes/games-browse-pagination.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BrowseGamesResponse } from '@markettrader/shared';
import { createTestApp } from '../helpers/app.js';

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  return res.json<{ token: string }>().token;
}

describe('GET /games/browse pagination', () => {
  let app: FastifyInstance;
  let viewer: string;
  const created: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    const host = await register(app, 'page-host');
    viewer = await register(app, 'page-viewer');
    for (let i = 0; i < 25; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/games',
        headers: { Authorization: `Bearer ${host}` },
        payload: {
          name: `Paged ${i}`,
          startDate: '2099-01-01T00:00:00.000Z',
          endDate: '2099-06-01T00:00:00.000Z',
          startingBalance: 10_000,
        },
      });
      created.push(res.json<{ id: string }>().id);
    }
  });
  afterAll(() => app.close());

  function browse(query = '') {
    return app.inject({
      method: 'GET',
      url: `/games/browse${query}`,
      headers: { Authorization: `Bearer ${viewer}` },
    });
  }

  it('returns the first 20 games and the full total by default', async () => {
    const res = await browse();
    expect(res.statusCode).toBe(200);
    const body = res.json<BrowseGamesResponse>();
    expect(body.games).toHaveLength(20);
    expect(body.total).toBe(25);
  });

  it('pages with limit and offset without overlap', async () => {
    const first = (await browse('?limit=10&offset=0')).json<BrowseGamesResponse>();
    const second = (await browse('?limit=10&offset=10')).json<BrowseGamesResponse>();
    const third = (await browse('?limit=10&offset=20')).json<BrowseGamesResponse>();
    const ids = [...first.games, ...second.games, ...third.games].map((g) => g.id);
    expect(third.games).toHaveLength(5);
    expect(new Set(ids).size).toBe(25);
    expect(new Set(ids)).toEqual(new Set(created));
  });

  it('keeps newest-first order across pages', async () => {
    const all = (await browse('?limit=50')).json<BrowseGamesResponse>().games;
    const sorted = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    expect(all.map((g) => g.id)).toEqual(sorted.map((g) => g.id));
  });

  it('rejects a limit above 50 with 400', async () => {
    expect((await browse('?limit=51')).statusCode).toBe(400);
  });

  it('rejects a negative offset with 400', async () => {
    expect((await browse('?offset=-1')).statusCode).toBe(400);
  });

  it('returns an empty page past the end, still reporting the total', async () => {
    const body = (await browse('?offset=100')).json<BrowseGamesResponse>();
    expect(body.games).toEqual([]);
    expect(body.total).toBe(25);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/routes/games-browse-pagination.test.ts`
Expected: FAIL. `BrowseGamesResponse` is not exported from `@markettrader/shared`, and `body.games` is undefined because the route returns an array.

- [ ] **Step 3: Add the shared type**

In `packages/shared/src/types/game.ts`, directly after the `BrowsableGame` interface:

```ts
/**
 * `GET /games/browse` response: one page of {@link BrowsableGame}s, newest first.
 * `total` counts every browsable game, not just this page, so a client knows
 * whether another page exists.
 */
export interface BrowseGamesResponse {
  games: BrowsableGame[];
  total: number;
}
```

- [ ] **Step 4: Paginate the route**

In `packages/server/src/routes/games.ts`, next to the other schemas:

```ts
const browseQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
```

In `app.get('/games/browse', …)`, add `querystring: browseQuerySchema,` to `schema` after `security`. Then replace the tail of the handler, from `const open = candidates` through `return reply.status(200).send(open);`, with:

```ts
      const open = candidates
        .filter(g => (statusMap.get(g.id) ?? g.status) !== 'ended')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const { limit, offset } = request.query;
      const page = open.slice(offset, offset + limit).map(g => ({
        ...g,
        startingBalance: Number(g.startingBalance),
        status: statusMap.get(g.id) ?? g.status,
        playerCount: countMap.get(g.id) ?? 0,
      }));

      return reply.status(200).send({ games: page, total: open.length });
```

Update the summary string to `'List public games the caller has not joined and can still join, one page at a time.'`.

- [ ] **Step 5: Update the existing server tests to the new shape**

`packages/server/tests/routes/games.test.ts`, replace `browseHas`:

```ts
function browseHas(res: LightMyRequestResponse, gameId: string): boolean {
  return res.json<{ games: { id: string }[] }>().games.some((g) => g.id === gameId);
}
```

In `it('lists a public game the caller has not joined, with counts and creator', …)`, replace:

```ts
    const row = res.json<
      { id: string; name: string; playerCount: number; createdByUsername: string }[]
    >().find((g) => g.id === gameId);
```

with:

```ts
    const row = res.json<{
      games: { id: string; name: string; playerCount: number; createdByUsername: string }[];
    }>().games.find((g) => g.id === gameId);
```

In `it('never exposes the invite code', …)`, replace `for (const row of res.json<Record<string, unknown>[]>()) {` with:

```ts
    for (const row of res.json<{ games: Record<string, unknown>[] }>().games) {
```

`packages/server/tests/admin/admin.test.ts`, replace both `.json<{ id: string }[]>().some(` calls on `browseBefore` and `browseAfter` with `.json<{ games: { id: string }[] }>().games.some(`.

Run: `pnpm --filter server exec vitest run tests/routes/games-browse-pagination.test.ts tests/routes/games.test.ts tests/admin/admin.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing frontend test**

Create `packages/frontend/tests/BrowseGamesSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowsableGame } from '@markettrader/shared';

const fetchNextPage = vi.fn();
const state = {
  games: [] as BrowsableGame[],
  total: 0,
  hasNextPage: false,
  isFetchingNextPage: false,
};

vi.mock('@/api/games', () => ({
  useBrowsableGames: () => ({
    ...state,
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
    fetchNextPage,
  }),
  useJoinGame: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { BrowseGamesSection } from '@/components/game/BrowseGamesSection';

function game(i: number): BrowsableGame {
  return {
    id: `g${i}`,
    name: `Open ${i}`,
    startDate: '2026-11-01T00:00:00Z',
    endDate: '2026-12-01T00:00:00Z',
    startingBalance: 100_000,
    status: 'pending',
    playerCount: 1,
    createdByUsername: 'host',
    createdAt: '2026-10-01T00:00:00Z',
  };
}

describe('BrowseGamesSection pagination', () => {
  beforeEach(() => {
    fetchNextPage.mockReset();
    state.games = [game(1), game(2)];
    state.total = 30;
    state.hasNextPage = true;
    state.isFetchingNextPage = false;
  });

  it('shows the server total, not the loaded count', () => {
    render(<BrowseGamesSection />);
    expect(screen.getByText('30 listed')).toBeInTheDocument();
  });

  it('loads the next page from the Load more button', async () => {
    render(<BrowseGamesSection />);
    await userEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('hides Load more when there is no next page', () => {
    state.hasNextPage = false;
    render(<BrowseGamesSection />);
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });

  it('disables Load more while a page is in flight', () => {
    state.isFetchingNextPage = true;
    render(<BrowseGamesSection />);
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
  });
});
```

Run: `pnpm --filter frontend exec vitest run tests/BrowseGamesSection.test.tsx`
Expected: FAIL. There's no "Load more" button, and the count reads `2 listed`.

- [ ] **Step 7: Make the hook infinite**

`packages/frontend/src/api/games.ts`:

1. Change the React Query import to `import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';`, and add `import { useMemo } from 'react';`.
2. Add `BrowseGamesResponse` to the `@markettrader/shared` type import.
3. Replace `useBrowsableGames` with:

```ts
/** Page size `useBrowsableGames` asks the server for. */
export const BROWSE_PAGE_SIZE = 20;

/**
 * Public games the current user has not joined and can still join, fetched a
 * page at a time. `games` is every loaded page flattened, and `total` is the
 * server's count of all browsable games.
 */
export function useBrowsableGames() {
  const query = useInfiniteQuery({
    queryKey: gameKeys.browse(),
    queryFn: ({ pageParam }) =>
      apiFetch<BrowseGamesResponse>(
        `/games/browse?limit=${BROWSE_PAGE_SIZE}&offset=${pageParam}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (last, _all, lastOffset) => {
      const next = lastOffset + last.games.length;
      return last.games.length > 0 && next < last.total ? next : undefined;
    },
  });
  // A game created between two page fetches shifts every offset by one, so the
  // same row can arrive on two pages.
  const games = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages ?? [])
      .flatMap((p) => p.games)
      .filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
  }, [query.data]);
  return { ...query, games, total: query.data?.pages[0]?.total ?? 0 };
}
```

Invalidations elsewhere in the file (`qc.invalidateQueries({ queryKey: gameKeys.browse() })`) work unchanged for infinite queries.

- [ ] **Step 8: Render the pages and Load more**

In `packages/frontend/src/components/game/BrowseGamesSection.tsx`:

1. In `handleFilled`, change `setFrozen((prev) => prev ?? browsable.data ?? null);` to `setFrozen((prev) => prev ?? browsable.games);`, and its dependency array to `[browsable.games]`.
2. Change `const rows = frozen ?? browsable.data ?? [];` to `const rows = frozen ?? browsable.games;`.
3. Replace the count badge:

```tsx
        {browsable.total > 0 && (
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            {browsable.total} listed
          </span>
        )}
```

4. Directly after the closing `</ul>` inside the `rows.length > 0` block, add:

```tsx
          {browsable.hasNextPage && (
            <div className="flex justify-center pt-1">
              <Button
                size="sm"
                variant="outline"
                className="font-mono uppercase tracking-[0.1em]"
                onClick={() => void browsable.fetchNextPage()}
                disabled={browsable.isFetchingNextPage}
              >
                {browsable.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
```

`packages/frontend/tests/GamesListPage.test.tsx`, replace the `useBrowsableGames` mock:

```tsx
  useBrowsableGames: () => ({
    games: browsableData,
    total: browsableData.length,
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
```

- [ ] **Step 9: Run the frontend tests and confirm they pass**

Run: `pnpm --filter frontend exec vitest run tests/BrowseGamesSection.test.tsx tests/GamesListPage.test.tsx`
Expected: PASS.

- [ ] **Step 10: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

```bash
git add packages/shared/src/types/game.ts packages/server/src/routes/games.ts \
  packages/server/tests/routes/games.test.ts packages/server/tests/admin/admin.test.ts \
  packages/server/tests/routes/games-browse-pagination.test.ts \
  packages/frontend/src/api/games.ts packages/frontend/src/components/game/BrowseGamesSection.tsx \
  packages/frontend/tests/GamesListPage.test.tsx packages/frontend/tests/BrowseGamesSection.test.tsx
git commit -m "feat(games): paginate /games/browse with limit/offset and Load more

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Featured games: at least 2 players, ranked by % return

**Files:**
- Modify: `packages/server/src/routes/public-games.ts`
- Modify: `packages/server/tests/security/f10-featured-games-private-leak.test.ts`: give the public game a second player.
- Test: `packages/server/tests/routes/featured-games-ranking.test.ts` (create)

**Interfaces:**
- Consumes: nothing new. `GET /public/featured-games` keeps the `FeaturedGame[]` response shape.
- Produces:
  - Only public, active games with at least `MIN_PLAYERS` (2) players are considered.
  - Results are ranked by the mean `pnlPct` of the returned top entries, descending. Ties keep newest-first.
  - Single-player games are dropped in SQL, so spam games cost no leaderboard computation.

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/routes/featured-games-ranking.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import type { FeaturedGame } from '@markettrader/shared';
import { createTestAppWithDb } from '../helpers/app.js';
import { schema } from '../../src/db/index.js';

const ACTIVE = { startDate: '2026-01-01T00:00:00.000Z', endDate: '2099-01-01T00:00:00.000Z' };

describe('GET /public/featured-games ranking', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof createTestAppWithDb>>['db'];
  let whaleId: string;
  let winnerId: string;
  let soloId: string;

  async function register(username: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username, password: 'password123' },
    });
    const body = res.json<{ token: string; user: { id: string } }>();
    return { token: body.token, userId: body.user.id };
  }

  async function createGame(token: string, name: string, startingBalance: number) {
    const res = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name, ...ACTIVE, startingBalance },
    });
    return res.json<{ id: string }>().id;
  }

  async function join(token: string, gameId: string) {
    await app.inject({
      method: 'POST',
      url: `/games/${gameId}/join`,
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  beforeAll(async () => {
    ({ app, db } = await createTestAppWithDb());
    const a = await register('feat-a');
    const b = await register('feat-b');

    // Largest absolute value, but 0% return.
    whaleId = await createGame(a.token, 'Whale Pool', 5_000_000);
    await join(b.token, whaleId);

    // Small balance, but its creator doubled their cash.
    winnerId = await createGame(a.token, 'Winner Pool', 10_000);
    await join(b.token, winnerId);
    await db
      .update(schema.gamePlayers)
      .set({ cashBalance: 20_000 })
      .where(and(eq(schema.gamePlayers.gameId, winnerId), eq(schema.gamePlayers.userId, a.userId)));

    // Only one player: never featured.
    soloId = await createGame(a.token, 'Solo Spam', 9_000_000);
  });
  afterAll(() => app.close());

  it('ranks by % return, not absolute portfolio value', async () => {
    const ids = (await app.inject({ method: 'GET', url: '/public/featured-games' }))
      .json<FeaturedGame[]>()
      .map((g) => g.id);
    expect(ids.indexOf(winnerId)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(whaleId)).toBeGreaterThan(ids.indexOf(winnerId));
  });

  it('excludes games with fewer than two players', async () => {
    const ids = (await app.inject({ method: 'GET', url: '/public/featured-games' }))
      .json<FeaturedGame[]>()
      .map((g) => g.id);
    expect(ids).not.toContain(soloId);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter server exec vitest run tests/routes/featured-games-ranking.test.ts`
Expected: FAIL. `Whale Pool` ranks first because the sum is larger, and `Solo Spam` is included.

- [ ] **Step 3: Rewrite the selection and ranking**

In `packages/server/src/routes/public-games.ts`:

1. Change the drizzle import to `import { count, eq, gte } from 'drizzle-orm';`.
2. Below `const TOP_N = 4;` add:

```ts
// A one-player public game is free to mint, so letting it qualify would let
// anyone place a game on the logged-out login page.
const MIN_PLAYERS = 2;
```

3. Inside the factory, change `const { games } = schema;` to `const { games, gamePlayers } = schema;`.
4. Replace the `rows` query with:

```ts
      const rows = await db
        .select({
          id: games.id,
          name: games.name,
          startDate: games.startDate,
          endDate: games.endDate,
          startingBalance: games.startingBalance,
          status: games.status,
          createdAt: games.createdAt,
        })
        .from(games)
        .innerJoin(gamePlayers, eq(gamePlayers.gameId, games.id))
        .where(eq(games.visibility, 'public'))
        .groupBy(games.id)
        .having(gte(count(gamePlayers.id), MIN_PLAYERS));
```

5. Replace the final sort block, from the `// Stable secondary sort …` comment through `);`, with:

```ts
      // Ranked by % return so a game's starting balance cannot buy it the top
      // slot. Array.prototype.sort is stable, so ties keep newest-first.
      const meanReturn = (g: FeaturedGame): number =>
        g.leaderboard.reduce((s, e) => s + e.pnlPct, 0) / g.leaderboard.length;
      featured.sort((a, b) => meanReturn(b) - meanReturn(a));
```

6. Update the `publicGamesRoutes` JSDoc, appending: `Only games with at least two players qualify, ranked by the mean return of their top entries.`

- [ ] **Step 4: Give f10's public game a second player**

In `packages/server/tests/security/f10-featured-games-private-leak.test.ts`, inside `beforeAll`, after `publicId = await createGame(…)`:

```ts
    const second = await register(app, 'f10-second');
    await app.inject({
      method: 'POST',
      url: `/games/${publicId}/join`,
      headers: { Authorization: `Bearer ${second}` },
    });
```

The private game deliberately stays single-player. The "never the private one" assertion must hold through the visibility filter, and it still does even if the player count would have excluded the game anyway. To keep that assertion meaningful, also add a second player to the private game. `register` returns the token, and the join needs the invite code:

```ts
    const privateCode = (
      await app.inject({
        method: 'POST',
        url: `/games/${privateId}/invite-code`,
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json<{ inviteCode: string }>().inviteCode;
    await app.inject({
      method: 'POST',
      url: `/games/${privateId}/join`,
      headers: { Authorization: `Bearer ${second}` },
      payload: { inviteCode: privateCode },
    });
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm --filter server exec vitest run tests/routes/featured-games-ranking.test.ts tests/security/f10-featured-games-private-leak.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS, no errors.

```bash
git add packages/server/src/routes/public-games.ts \
  packages/server/tests/routes/featured-games-ranking.test.ts \
  packages/server/tests/security/f10-featured-games-private-leak.test.ts
git commit -m "fix(featured-games): require two players and rank by % return

A single-player game with a huge starting balance used to take over the
logged-out login page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
## Phase 1 — Core

### Task 6: Shared limit types, live limit options, catalogue, and policy helpers

Adds the vocabulary the rest of the feature uses: `LimitKey` and the DTOs in `shared`, every
`LIMITS_*` and `LIMIT_*` live option (env, registry, override validation), the declarative
catalogue, and the two policy helpers `isMatureUser` and `isPrivilegedConnection`. No route
behaviour changes yet.

**Files:**
- Create: `packages/shared/src/types/limits.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/server/src/limits/cidr.ts`
- Create: `packages/server/src/limits/policy.ts`
- Create: `packages/server/src/limits/catalogue.ts`
- Modify: `packages/server/src/env.ts`: move `isAddressOrSubnet` to `limits/cidr.ts`, add `validatedCidrList`, add the live options
- Modify: `packages/server/src/config/registry.ts`: `validate` hook on `LiveDescriptor`, new descriptors, string schema refinement
- Test: `packages/server/tests/limits/policy.test.ts`
- Test: `packages/server/tests/limits/catalogue.test.ts`
- Test: `packages/server/tests/config/registry.test.ts` (extend)

**Interfaces:**
- Consumes: `parseNonNegativeInt(name: string, raw: string): number` from `env.ts`, which Task 1 adds. If Task 1 has not landed, Step 3 adds it.
- Produces:
  - **Shared (`@markettrader/shared`):**
    - `LIMIT_KEYS`, `LimitKey`, `LimitKind`, `LimitBasis`, `LimitExceededBody`
    - Admin DTOs: `AdminLimitPolicy`, `AdminUserLimitRow`, `AdminRouteVolume`, `AdminDenialSummary`, `AdminUserLimitsResponse`, `AdminSetUserLimitRequest`, `AdminLimitOverrideEntry`, `AdminTopConsumer`, `AdminTopConsumersResponse`
  - **`limits/cidr.ts`:**
    - `isAddressOrSubnet(token: string): boolean`
    - `validateCidrList(raw: string): string | undefined`
    - `parseCidrList(raw: string): CidrMatcher`, where `interface CidrMatcher { readonly size: number; matches(ip: string): boolean }`
    - `normaliseIp(ip: string): string`
  - **`limits/policy.ts`:**
    - `maturityEndsAt(account: { createdAt: string }, config: ConfigReader): Date`
    - `isMatureUser(account: { createdAt: string }, config: ConfigReader, now?: number): boolean`
    - `isPrivilegedConnection(ip: string, config: ConfigReader): boolean`
    - re-exports `parseCidrList` and `validateCidrList`
  - **`limits/catalogue.ts`:** `LimitConfigKey`, `LimitDescriptor`, `LIMIT_CATALOGUE`, `isLimitKey(key: string): key is LimitKey`
    - `LimitDescriptor` = `{ kind, configKey, windowMs, probation, overridable, label, per }`
    - `per` is the unit phrase used in messages, e.g. `'per week'`.
  - **Live keys:** `LIMITS_ENABLED`, `LIMITS_MATURITY_DAYS`, `LIMITS_PROBATION_PERCENT`, `LIMITS_PRIVILEGED_CIDRS`, `LIMITS_PRIVILEGED_MULTIPLIER`, and every `LIMIT_*` key in spec §4.
    - `USAGE_FLUSH_INTERVAL_MS` and `USAGE_RETENTION_DAYS` are **not** added here. Task 15 owns them.
  - **`LiveDescriptor`** gains `validate?: (value: string) => string | undefined`.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/tests/limits/policy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import {
  isMatureUser,
  isPrivilegedConnection,
  maturityEndsAt,
  parseCidrList,
  validateCidrList,
} from '../../src/limits/policy.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const createdDaysAgo = (days: number) => ({ createdAt: new Date(NOW - days * DAY).toISOString() });

describe('validateCidrList', () => {
  it.each(['', '  ', '203.0.113.0/24', '203.0.113.0/24, 198.51.100.7', '2001:db8::/32', '::1'])(
    'accepts %j',
    (raw) => {
      expect(validateCidrList(raw)).toBeUndefined();
    },
  );

  it.each([
    ['10.0.0.0/33', '10.0.0.0/33'],
    ['office', 'office'],
    ['203.0.113.0/24, nope', 'nope'],
    ['2001:db8::/129', '2001:db8::/129'],
  ])('rejects %j naming the bad entry', (raw, bad) => {
    expect(validateCidrList(raw)).toContain(bad);
  });
});

describe('parseCidrList', () => {
  const list = parseCidrList('203.0.113.0/24, 198.51.100.7, 2001:db8::/32');

  it('matches addresses inside a v4 subnet and an exact address', () => {
    expect(list.matches('203.0.113.42')).toBe(true);
    expect(list.matches('198.51.100.7')).toBe(true);
    expect(list.size).toBe(3);
  });

  it('does not match outside the list', () => {
    expect(list.matches('203.0.114.1')).toBe(false);
    expect(list.matches('198.51.100.8')).toBe(false);
  });

  it('matches IPv4-mapped IPv6 addresses, which is how dual-stack sockets report v4 peers', () => {
    expect(list.matches('::ffff:203.0.113.9')).toBe(true);
  });

  it('matches inside a v6 subnet', () => {
    expect(list.matches('2001:db8:1::5')).toBe(true);
    expect(list.matches('2001:db9::1')).toBe(false);
  });

  it('never matches a non-address', () => {
    expect(list.matches('')).toBe(false);
    expect(list.matches('not-an-ip')).toBe(false);
  });

  it('matches nothing when empty', () => {
    expect(parseCidrList('').matches('203.0.113.1')).toBe(false);
  });

  it('memoises on the raw string', () => {
    expect(parseCidrList('10.0.0.0/8')).toBe(parseCidrList('10.0.0.0/8'));
  });
});

describe('isMatureUser', () => {
  const config = RuntimeConfig.fromEnvironment({ LIMITS_MATURITY_DAYS: 7 });

  it('is false inside the maturity period and true after it', () => {
    expect(isMatureUser(createdDaysAgo(6), config, NOW)).toBe(false);
    expect(isMatureUser(createdDaysAgo(8), config, NOW)).toBe(true);
  });

  it('is true exactly at the boundary', () => {
    expect(isMatureUser(createdDaysAgo(7), config, NOW)).toBe(true);
  });

  it('treats every account as mature when the period is 0', () => {
    const zero = RuntimeConfig.fromEnvironment({ LIMITS_MATURITY_DAYS: 0 });
    expect(isMatureUser(createdDaysAgo(0), zero, NOW)).toBe(true);
  });

  // Fail toward probation: an unreadable timestamp must not hand out full limits.
  it('treats an unparseable createdAt as not mature', () => {
    expect(isMatureUser({ createdAt: 'garbage' }, config, NOW)).toBe(false);
  });

  it('reads the period live', () => {
    const live = RuntimeConfig.fromEnvironment({ LIMITS_MATURITY_DAYS: 7 });
    expect(isMatureUser(createdDaysAgo(3), live, NOW)).toBe(false);
    live.set('LIMITS_MATURITY_DAYS', 2);
    expect(isMatureUser(createdDaysAgo(3), live, NOW)).toBe(true);
  });

  it('maturityEndsAt is createdAt plus the period', () => {
    expect(maturityEndsAt(createdDaysAgo(3), config).toISOString()).toBe(
      new Date(NOW + 4 * DAY).toISOString(),
    );
  });
});

describe('isPrivilegedConnection', () => {
  it('reads LIMITS_PRIVILEGED_CIDRS live', () => {
    const config = RuntimeConfig.fromEnvironment({ LIMITS_PRIVILEGED_CIDRS: '' });
    expect(isPrivilegedConnection('203.0.113.5', config)).toBe(false);
    config.set('LIMITS_PRIVILEGED_CIDRS', '203.0.113.0/24');
    expect(isPrivilegedConnection('203.0.113.5', config)).toBe(true);
  });
});
```

Create `packages/server/tests/limits/catalogue.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LIMIT_KEYS } from '@markettrader/shared';
import { LIMIT_CATALOGUE, isLimitKey } from '../../src/limits/catalogue.js';
import { descriptorFor, isLiveKey } from '../../src/config/registry.js';

// Completeness (one descriptor per LimitKey) is enforced at compile time by the
// catalogue's `satisfies`; these pin the invariants the type cannot express.
describe('LIMIT_CATALOGUE', () => {
  it('has exactly one entry per LimitKey', () => {
    expect(Object.keys(LIMIT_CATALOGUE).sort()).toEqual([...LIMIT_KEYS].sort());
  });

  it.each([...LIMIT_KEYS])('%s is backed by a live integer option in the limits category', (key) => {
    const { configKey } = LIMIT_CATALOGUE[key];
    expect(isLiveKey(configKey), configKey).toBe(true);
    const d = descriptorFor(configKey);
    expect(d.category).toBe('limits');
    expect(d.kind).toBe('integer');
  });

  it.each([...LIMIT_KEYS])('%s has a window consistent with its kind', (key) => {
    const d = LIMIT_CATALOGUE[key];
    if (d.kind === 'rate') expect(d.windowMs).toBe(60_000);
    if (d.kind === 'concurrent') expect(d.windowMs).toBeNull();
    if (d.kind === 'quota' || d.kind === 'ip') expect(d.windowMs).toBeGreaterThan(0);
  });

  // An ip limit has no user to be new or to carry an override.
  it('never applies probation or overrides to ip limits', () => {
    for (const key of LIMIT_KEYS) {
      const d = LIMIT_CATALOGUE[key];
      if (d.kind === 'ip') {
        expect(d.probation, key).toBe(false);
        expect(d.overridable, key).toBe(false);
      } else {
        expect(d.probation, key).toBe(true);
        expect(d.overridable, key).toBe(true);
      }
    }
  });

  it('isLimitKey rejects prototype names and unknown keys', () => {
    expect(isLimitKey('trades')).toBe(true);
    expect(isLimitKey('toString')).toBe(false);
    expect(isLimitKey('nope')).toBe(false);
  });
});
```

Append to `packages/server/tests/config/registry.test.ts`, inside `describe('liveValueSchema', …)` after `'restricts enums to their options'`:

```ts
  it('validates privileged CIDR overrides', () => {
    const schema = liveValueSchema('LIMITS_PRIVILEGED_CIDRS');
    expect(schema.safeParse('203.0.113.0/24, 2001:db8::/32, 198.51.100.7').success).toBe(true);
    expect(schema.safeParse('').success).toBe(true);
    expect(schema.safeParse('203.0.113.0/33').success).toBe(false);
    expect(schema.safeParse('office').success).toBe(false);
  });

  it('allows a zero maturity period but not a negative one', () => {
    const schema = liveValueSchema('LIMITS_MATURITY_DAYS');
    expect(schema.safeParse(0).success).toBe(true);
    expect(schema.safeParse(-1).success).toBe(false);
    expect(schema.safeParse(366).success).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/limits tests/config/registry.test.ts`
Expected: FAIL. Module resolution errors for `../../src/limits/policy.js` and `../../src/limits/catalogue.js`, and `LIMIT_KEYS` is not exported from `@markettrader/shared`.

- [ ] **Step 3: Implement**

Create `packages/shared/src/types/limits.ts`:

```ts
/**
 * Contract for per-user limits: what a denied request returns, and what the
 * admin limits API (`/admin/limits`, `/admin/users/:id/limits`) exchanges.
 */

/** Every limit the server enforces, in display order. */
export const LIMIT_KEYS = [
  'apiRequests',
  'trades',
  'orderCancels',
  'codeLookups',
  'wsSubscribes',
  'gamesCreated',
  'activeGamesOwned',
  'gamesJoined',
  'activeGamesJoined',
  'openOrders',
  'watchlists',
  'watchlistItems',
  'wsConnections',
  'registrationsPerIp',
] as const;

export type LimitKey = (typeof LIMIT_KEYS)[number];

/**
 * `rate` — requests per sliding window, in memory. `quota` — rows created in a
 * window, counted from the database. `concurrent` — rows or sockets open now.
 * `ip` — keyed by network address, not by user.
 */
export type LimitKind = 'rate' | 'quota' | 'concurrent' | 'ip';

/** Why a user has the limit they have. `probation` = reduced because the account is new. */
export type LimitBasis = 'disabled' | 'admin' | 'override' | 'probation' | 'base';

/** Body of a 429 (rate, quota, ip) or 409 (concurrent) answering a request over its limit. */
export interface LimitExceededBody {
  /** Human-readable, e.g. "Game creation limit reached (3 per week)". */
  error: string;
  code: 'LIMIT_EXCEEDED';
  limit: LimitKey;
  max: number;
  /** True when the max is reduced because the account is still new. */
  probation: boolean;
  /** Seconds until one more request would be admitted; also sent as `Retry-After`. */
  retryAfterSeconds?: number;
}

/** `GET /admin/limits/policy` — the global policy plus how the server sees the caller. */
export interface AdminLimitPolicy {
  enabled: boolean;
  maturityDays: number;
  probationPercent: number;
  privilegedCidrs: string[];
  privilegedMultiplier: number;
  /** The caller's `request.ip` — lets an admin confirm the allowlist matches their office. */
  requestIp: string;
  requestIpPrivileged: boolean;
}

/** One limit as it applies to one user, for the admin user page. */
export interface AdminUserLimitRow {
  key: LimitKey;
  label: string;
  kind: LimitKind;
  configKey: string;
  /** The global value before probation, overrides, or multipliers. */
  baseValue: number;
  /** Resolved for a non-privileged connection; null = unlimited. */
  effectiveMax: number | null;
  basis: LimitBasis;
  override: { value: number; note: string | null; updatedBy: string | null; updatedAt: string } | null;
  /** Current usage; null where it cannot be attributed to the user (ip limits). */
  used: number | null;
  overridable: boolean;
}

/** Requests one subject sent to one route pattern over a window. */
export interface AdminRouteVolume {
  route: string;
  count: number;
}

/** Denials of one limit for one subject over a window. */
export interface AdminDenialSummary {
  limitKey: string;
  count: number;
  lastAt: string;
}

/** `GET /admin/users/:id/limits`. */
export interface AdminUserLimitsResponse {
  userId: string;
  mature: boolean;
  /** When probation ends; null once mature. */
  probationEndsAt: string | null;
  privilegedMultiplier: number;
  rows: AdminUserLimitRow[];
  /** Null for accounts created before registration IPs were recorded. */
  registrationIp: string | null;
  /** Other accounts registered from the same IP — a sybil signal. */
  siblingAccounts: { id: string; username: string; createdAt: string }[];
  requestVolume7d: AdminRouteVolume[];
  denials7d: AdminDenialSummary[];
}

/** Body of `PUT /admin/users/:id/limits/:key`. */
export interface AdminSetUserLimitRequest {
  value: number;
  note?: string;
}

/** One active per-user override, for `GET /admin/limits/overrides`. */
export interface AdminLimitOverrideEntry {
  userId: string;
  username: string;
  key: LimitKey;
  value: number;
  note: string | null;
  /** Admin user id that last wrote it; null when unknown. */
  updatedBy: string | null;
  /** That admin's username; null if the account no longer exists. */
  updatedByUsername: string | null;
  updatedAt: string;
}

/** One row of the top-consumers table. */
export interface AdminTopConsumer {
  subjectType: 'user' | 'ip';
  subjectId: string;
  username: string | null;
  count: number;
  /** Busiest route (requests) or most-denied limit (denials). */
  top: string | null;
  /** Other accounts sharing this user's registration IP; 0 for ip subjects. */
  sharedRegistrationIpCount: number;
}

/** `GET /admin/limits/top`. */
export interface AdminTopConsumersResponse {
  window: '24h' | '7d';
  metric: 'requests' | 'denials';
  rows: AdminTopConsumer[];
}
```

In `packages/shared/src/index.ts`, after `export * from './types/leaderboard-history.js';` add:

```ts
export * from './types/limits.js';
```

Create `packages/server/src/limits/cidr.ts`:

```ts
import { BlockList, isIP } from 'node:net';

/** True for `10.0.0.0/8`, `::1/128`, and bare addresses in either family. */
export function isAddressOrSubnet(token: string): boolean {
  const slash = token.indexOf('/');
  if (slash === -1) return isIP(token) !== 0;
  const address = token.slice(0, slash);
  const prefix = token.slice(slash + 1);
  const family = isIP(address);
  if (family === 0 || !/^\d+$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

/** An error message naming every entry that is not an address or CIDR subnet; undefined when valid. */
export function validateCidrList(raw: string): string | undefined {
  const bad = splitList(raw).filter((t) => !isAddressOrSubnet(t));
  return bad.length === 0 ? undefined : `not an IP address or CIDR subnet: ${bad.join(', ')}`;
}

/**
 * Strips the `::ffff:` prefix a dual-stack socket puts on IPv4 peers, so an
 * IPv4 allowlist entry matches them.
 */
export function normaliseIp(ip: string): string {
  return ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

/** A compiled allowlist. */
export interface CidrMatcher {
  readonly size: number;
  matches(ip: string): boolean;
}

let memo: { raw: string; matcher: CidrMatcher } | undefined;

/**
 * Compiles a comma-separated address/CIDR list. Memoised on the raw string
 * because the source is a live option read on every limited request. Invalid
 * entries are skipped; the option's validator rejects them before they persist.
 */
export function parseCidrList(raw: string): CidrMatcher {
  if (memo?.raw === raw) return memo.matcher;
  const list = new BlockList();
  let size = 0;
  for (const token of splitList(raw)) {
    if (!isAddressOrSubnet(token)) continue;
    const slash = token.indexOf('/');
    const address = slash === -1 ? token : token.slice(0, slash);
    const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    if (slash === -1) list.addAddress(address, family);
    else list.addSubnet(address, Number(token.slice(slash + 1)), family);
    size++;
  }
  const matcher: CidrMatcher = {
    size,
    matches(ip: string): boolean {
      const candidate = normaliseIp(ip);
      const family = isIP(candidate);
      if (family === 0) return false;
      return list.check(candidate, family === 6 ? 'ipv6' : 'ipv4');
    },
  };
  memo = { raw, matcher };
  return matcher;
}
```

Create `packages/server/src/limits/policy.ts`:

```ts
import type { ConfigReader } from '../config/runtime-config.js';
import { parseCidrList } from './cidr.js';

export { parseCidrList, validateCidrList } from './cidr.js';

const DAY_MS = 86_400_000;

/**
 * When an account leaves probation. `createdAt` must be ISO-8601 with a zone
 * (`RequestAccount.createdAt` is normalised by `loadAccount`).
 */
export function maturityEndsAt(account: { createdAt: string }, config: ConfigReader): Date {
  return new Date(Date.parse(account.createdAt) + config.get('LIMITS_MATURITY_DAYS') * DAY_MS);
}

/**
 * True once the account is at least `LIMITS_MATURITY_DAYS` old. An unparseable
 * `createdAt` yields false, so a bad timestamp keeps the reduced limits.
 */
export function isMatureUser(
  account: { createdAt: string },
  config: ConfigReader,
  now: number = Date.now(),
): boolean {
  return now >= maturityEndsAt(account, config).getTime();
}

/** True when `ip` is inside `LIMITS_PRIVILEGED_CIDRS`. Only as trustworthy as `TRUST_PROXY`. */
export function isPrivilegedConnection(ip: string, config: ConfigReader): boolean {
  return parseCidrList(config.get('LIMITS_PRIVILEGED_CIDRS')).matches(ip);
}
```

In `packages/server/src/env.ts`:

1. Replace the local `isAddressOrSubnet` function (the block from `/** True for \`10.0.0.0/8\`…` through its closing `}`) with nothing, and add the imports at the top, below `import { isIP } from 'node:net';`:

```ts
import { isAddressOrSubnet, validateCidrList } from './limits/cidr.js';
```

If `isIP` is now unused in `env.ts`, remove the `import { isIP } from 'node:net';` line. Lint will flag it.

2. If Task 1 did not add `parseNonNegativeInt`, add it directly below `parsePositiveInt`:

```ts
function parseNonNegativeInt(name: string, raw: string): number {
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 0) {
    throw new Error(`Invalid ${name}: "${raw}". Must be a non-negative integer.`);
  }
  return n;
}
```

3. Below `parseBool`, add:

```ts
/** Reads a comma-separated IP/CIDR list, failing at boot on any malformed entry. */
function validatedCidrList(name: string): string {
  const raw = optional(name, '').trim();
  const problem = validateCidrList(raw);
  if (problem) throw new Error(`Invalid ${name}: ${problem}.`);
  return raw;
}
```

4. In `liveBootConfig`, immediately after the `WATCHLIST_MAX_PER_USER` entry (the line `optional('WATCHLIST_MAX_PER_USER', '20'),` followed by `),`), insert:

```ts

  // Per-user limits. Each LIMIT_* value is the global ceiling for a mature
  // account on an ordinary connection; see limits/catalogue.ts for what each
  // one counts and limits/resolver.ts for probation and the privileged multiplier.
  /** Master switch. False lifts every limit in limits/catalogue.ts. */
  LIMITS_ENABLED: parseBool(optional('LIMITS_ENABLED', 'true')),
  /** Days a new account runs on reduced limits. 0 turns probation off. */
  LIMITS_MATURITY_DAYS: parseNonNegativeInt(
    'LIMITS_MATURITY_DAYS',
    optional('LIMITS_MATURITY_DAYS', '7'),
  ),
  /** Share of each limit an account on probation gets, rounded up, never below 1. */
  LIMITS_PROBATION_PERCENT: parsePositiveInt(
    'LIMITS_PROBATION_PERCENT',
    optional('LIMITS_PROBATION_PERCENT', '25'),
  ),
  /**
   * Comma-separated IPs and CIDR subnets (an office) whose requests get
   * {@link liveBootConfig.LIMITS_PRIVILEGED_MULTIPLIER} on every limit. Matched
   * against `request.ip`, so it is only as trustworthy as TRUST_PROXY.
   */
  LIMITS_PRIVILEGED_CIDRS: validatedCidrList('LIMITS_PRIVILEGED_CIDRS'),
  /** Factor applied to every limit for a privileged connection. */
  LIMITS_PRIVILEGED_MULTIPLIER: parsePositiveInt(
    'LIMITS_PRIVILEGED_MULTIPLIER',
    optional('LIMITS_PRIVILEGED_MULTIPLIER', '10'),
  ),
  /** Authenticated REST requests per user per minute, across every route. */
  LIMIT_API_REQUESTS_PER_MINUTE: parsePositiveInt(
    'LIMIT_API_REQUESTS_PER_MINUTE',
    optional('LIMIT_API_REQUESTS_PER_MINUTE', '600'),
  ),
  /** Orders placed per user per minute. */
  LIMIT_TRADES_PER_MINUTE: parsePositiveInt(
    'LIMIT_TRADES_PER_MINUTE',
    optional('LIMIT_TRADES_PER_MINUTE', '60'),
  ),
  /** Order cancellations (working and pending) per user per minute. */
  LIMIT_ORDER_CANCELS_PER_MINUTE: parsePositiveInt(
    'LIMIT_ORDER_CANCELS_PER_MINUTE',
    optional('LIMIT_ORDER_CANCELS_PER_MINUTE', '60'),
  ),
  /** Invite-code lookups per user per minute; bounds code enumeration. */
  LIMIT_CODE_LOOKUPS_PER_MINUTE: parsePositiveInt(
    'LIMIT_CODE_LOOKUPS_PER_MINUTE',
    optional('LIMIT_CODE_LOOKUPS_PER_MINUTE', '20'),
  ),
  /** WebSocket `subscribe` frames per user per minute, across sockets. */
  LIMIT_WS_SUBSCRIBES_PER_MINUTE: parsePositiveInt(
    'LIMIT_WS_SUBSCRIBES_PER_MINUTE',
    optional('LIMIT_WS_SUBSCRIBES_PER_MINUTE', '30'),
  ),
  /** Games one user may create in any rolling 7 days. */
  LIMIT_GAMES_CREATED_PER_WEEK: parsePositiveInt(
    'LIMIT_GAMES_CREATED_PER_WEEK',
    optional('LIMIT_GAMES_CREATED_PER_WEEK', '10'),
  ),
  /** Games one user may own that have not ended. */
  LIMIT_ACTIVE_GAMES_OWNED: parsePositiveInt(
    'LIMIT_ACTIVE_GAMES_OWNED',
    optional('LIMIT_ACTIVE_GAMES_OWNED', '5'),
  ),
  /** Games one user may join (including ones they create) in any rolling 24 hours. */
  LIMIT_GAMES_JOINED_PER_DAY: parsePositiveInt(
    'LIMIT_GAMES_JOINED_PER_DAY',
    optional('LIMIT_GAMES_JOINED_PER_DAY', '20'),
  ),
  /** Games one user may be in that have not ended. */
  LIMIT_ACTIVE_GAMES_JOINED: parsePositiveInt(
    'LIMIT_ACTIVE_GAMES_JOINED',
    optional('LIMIT_ACTIVE_GAMES_JOINED', '30'),
  ),
  /** Working plus pending orders one player may have open in one game. */
  LIMIT_OPEN_ORDERS_PER_PLAYER: parsePositiveInt(
    'LIMIT_OPEN_ORDERS_PER_PLAYER',
    optional('LIMIT_OPEN_ORDERS_PER_PLAYER', '50'),
  ),
  /** Live sockets one user may hold open across both WebSocket routes. */
  LIMIT_WS_CONNECTIONS_PER_USER: parsePositiveInt(
    'LIMIT_WS_CONNECTIONS_PER_USER',
    optional('LIMIT_WS_CONNECTIONS_PER_USER', '10'),
  ),
  /** Accounts that may be registered from one IP in any rolling 24 hours. */
  LIMIT_REGISTRATIONS_PER_IP_PER_DAY: parsePositiveInt(
    'LIMIT_REGISTRATIONS_PER_IP_PER_DAY',
    optional('LIMIT_REGISTRATIONS_PER_IP_PER_DAY', '5'),
  ),
```

In `packages/server/src/config/registry.ts`:

1. Add the import below the existing `../env.js` import block:

```ts
import { validateCidrList } from '../limits/cidr.js';
```

2. Replace the `LiveDescriptor` interface with:

```ts
/** An option the admin panel may override. `min`/`max` bound overrides, not the environment. */
export interface LiveDescriptor extends DescriptorBase {
  mutability: 'live';
  min?: number;
  max?: number;
  /** Extra check for `string` kinds; returns an error message, or undefined when valid. */
  validate?: (value: string) => string | undefined;
}
```

3. In `CONFIG_REGISTRY`, immediately after the `WATCHLIST_MAX_PER_USER` descriptor and before `// ── websocket`, insert:

```ts
  LIMITS_ENABLED: {
    category: 'limits', kind: 'boolean', mutability: 'live',
    description:
      'Master switch for per-user limits. Off lifts every limit below; the fixed per-IP caps on login, register and stock lookups stay.',
  },
  LIMITS_MATURITY_DAYS: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 0, max: 365,
    description: 'Days a new account runs on probation (reduced limits). 0 turns probation off.',
  },
  LIMITS_PROBATION_PERCENT: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 100,
    description: 'Share of each limit an account on probation gets, rounded up, never below 1.',
  },
  LIMITS_PRIVILEGED_CIDRS: {
    category: 'limits', kind: 'string', mutability: 'live', validate: validateCidrList,
    description:
      'Comma-separated IPs/CIDR subnets (e.g. an office) whose requests get the privileged multiplier on every limit. Matched on request.ip, so TRUST_PROXY must be right.',
  },
  LIMITS_PRIVILEGED_MULTIPLIER: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 1_000,
    description: 'Factor applied to every limit for a privileged connection.',
  },
  LIMIT_API_REQUESTS_PER_MINUTE: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 100_000,
    description: 'Authenticated REST requests per user per minute, across every route.',
  },
  LIMIT_TRADES_PER_MINUTE: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 10_000,
    description: 'Orders one user may place per minute.',
  },
  LIMIT_ORDER_CANCELS_PER_MINUTE: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 10_000,
    description: 'Order cancellations (working and pending) one user may make per minute.',
  },
  LIMIT_CODE_LOOKUPS_PER_MINUTE: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 10_000,
    description: 'Invite-code lookups one user may make per minute. Bounds code enumeration.',
  },
  LIMIT_WS_SUBSCRIBES_PER_MINUTE: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 10_000,
    description: 'Live-price subscription changes one user may send per minute, across sockets.',
  },
  LIMIT_GAMES_CREATED_PER_WEEK: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 10_000,
    description: 'Games one user may create in any rolling 7 days.',
  },
  LIMIT_ACTIVE_GAMES_OWNED: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 10_000,
    description: 'Games one user may own that have not ended.',
  },
  LIMIT_GAMES_JOINED_PER_DAY: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 10_000,
    description: 'Games one user may join in any rolling 24 hours. Creating a game counts as joining it.',
  },
  LIMIT_ACTIVE_GAMES_JOINED: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 10_000,
    description: 'Games one user may be playing at once (not ended).',
  },
  LIMIT_OPEN_ORDERS_PER_PLAYER: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 10_000,
    description: 'Working plus pending orders one player may have open in one game.',
  },
  LIMIT_WS_CONNECTIONS_PER_USER: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 1_000,
    description: 'Live sockets one user may hold open at once.',
  },
  LIMIT_REGISTRATIONS_PER_IP_PER_DAY: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 10_000,
    description: 'Accounts that may be registered from one IP in any rolling 24 hours.',
  },
```

4. In `schemaForKind`, replace the `case 'string':` branch with:

```ts
    case 'string': {
      const base = z.string().max(2048);
      const validate = d.validate;
      if (!validate) return base;
      return base.superRefine((value, ctx) => {
        const problem = validate(value);
        if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
      });
    }
```

Create `packages/server/src/limits/catalogue.ts`:

```ts
import { LIMIT_KEYS, type LimitKey, type LimitKind } from '@markettrader/shared';
import type { LiveKey } from '../config/registry.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Live options that hold a limit's global value. */
export type LimitConfigKey = Extract<
  LiveKey,
  `LIMIT_${string}` | 'WATCHLIST_MAX_PER_USER' | 'WATCHLIST_MAX_ITEMS'
>;

/** How one limit is counted and resolved. */
export interface LimitDescriptor {
  kind: LimitKind;
  configKey: LimitConfigKey;
  /** Counting window for `rate`/`quota`/`ip`; null for `concurrent`. */
  windowMs: number | null;
  /** Whether accounts on probation get the reduced value. */
  probation: boolean;
  /** Whether an admin may set a per-user override. */
  overridable: boolean;
  /** Subject of the denial message: "{label} limit reached ({max} {per})". */
  label: string;
  per: string;
}

/**
 * Every enforced limit. Adding a `LimitKey` in `shared` without an entry here
 * fails typecheck; adding one also needs a `LIMIT_*` live option and an
 * enforcement point.
 */
export const LIMIT_CATALOGUE = {
  apiRequests: {
    kind: 'rate', configKey: 'LIMIT_API_REQUESTS_PER_MINUTE', windowMs: MINUTE,
    probation: true, overridable: true, label: 'Request', per: 'per minute',
  },
  trades: {
    kind: 'rate', configKey: 'LIMIT_TRADES_PER_MINUTE', windowMs: MINUTE,
    probation: true, overridable: true, label: 'Order placement', per: 'per minute',
  },
  orderCancels: {
    kind: 'rate', configKey: 'LIMIT_ORDER_CANCELS_PER_MINUTE', windowMs: MINUTE,
    probation: true, overridable: true, label: 'Order cancellation', per: 'per minute',
  },
  codeLookups: {
    kind: 'rate', configKey: 'LIMIT_CODE_LOOKUPS_PER_MINUTE', windowMs: MINUTE,
    probation: true, overridable: true, label: 'Invite code lookup', per: 'per minute',
  },
  wsSubscribes: {
    kind: 'rate', configKey: 'LIMIT_WS_SUBSCRIBES_PER_MINUTE', windowMs: MINUTE,
    probation: true, overridable: true, label: 'Live subscription change', per: 'per minute',
  },
  gamesCreated: {
    kind: 'quota', configKey: 'LIMIT_GAMES_CREATED_PER_WEEK', windowMs: 7 * DAY,
    probation: true, overridable: true, label: 'Game creation', per: 'per week',
  },
  activeGamesOwned: {
    kind: 'concurrent', configKey: 'LIMIT_ACTIVE_GAMES_OWNED', windowMs: null,
    probation: true, overridable: true, label: 'Active games owned', per: 'at once',
  },
  gamesJoined: {
    kind: 'quota', configKey: 'LIMIT_GAMES_JOINED_PER_DAY', windowMs: DAY,
    probation: true, overridable: true, label: 'Game join', per: 'per day',
  },
  activeGamesJoined: {
    kind: 'concurrent', configKey: 'LIMIT_ACTIVE_GAMES_JOINED', windowMs: null,
    probation: true, overridable: true, label: 'Active games joined', per: 'at once',
  },
  openOrders: {
    kind: 'concurrent', configKey: 'LIMIT_OPEN_ORDERS_PER_PLAYER', windowMs: null,
    probation: true, overridable: true, label: 'Open order', per: 'per game',
  },
  watchlists: {
    kind: 'concurrent', configKey: 'WATCHLIST_MAX_PER_USER', windowMs: null,
    probation: true, overridable: true, label: 'Watchlist', per: 'per user',
  },
  watchlistItems: {
    kind: 'concurrent', configKey: 'WATCHLIST_MAX_ITEMS', windowMs: null,
    probation: true, overridable: true, label: 'Watchlist symbol', per: 'per list',
  },
  wsConnections: {
    kind: 'concurrent', configKey: 'LIMIT_WS_CONNECTIONS_PER_USER', windowMs: null,
    probation: true, overridable: true, label: 'Live connection', per: 'at once',
  },
  registrationsPerIp: {
    kind: 'ip', configKey: 'LIMIT_REGISTRATIONS_PER_IP_PER_DAY', windowMs: DAY,
    probation: false, overridable: false, label: 'Account registration', per: 'per day from this network',
  },
} as const satisfies { [K in LimitKey]: LimitDescriptor };

/** True for a known limit key; prototype names like `toString` are rejected. */
export function isLimitKey(key: string): key is LimitKey {
  return (LIMIT_KEYS as readonly string[]).includes(key);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/limits tests/config`
Expected: PASS. The existing registry test `'bounds every live integer'` and `'declares a kind matching each live boot value'` cover the new keys too.

Run: `pnpm typecheck && pnpm lint`
Expected: no errors. If the `satisfies` clause in `registry.ts` fails, a key in `liveBootConfig` is missing its descriptor.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/limits.ts packages/shared/src/index.ts \
  packages/server/src/limits/cidr.ts packages/server/src/limits/policy.ts packages/server/src/limits/catalogue.ts \
  packages/server/src/env.ts packages/server/src/config/registry.ts \
  packages/server/tests/limits/policy.test.ts packages/server/tests/limits/catalogue.test.ts \
  packages/server/tests/config/registry.test.ts
git commit -m "feat(limits): limit catalogue, live limit options, and policy helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Request account, override and registration-IP schema, `LimitOverridesService`

`verifyAccessToken` already reads the `users` row on every request. Widen that read so every
authenticated request carries `request.account = { id, createdAt, isAdmin }`, with no extra
query. Add the `user_limit_overrides` table, `users.registration_ip`, and the quota indexes,
then add the service that reads and writes overrides with an audit trail.

**Files:**
- Create: `packages/server/src/limits/account.ts`
- Create: `packages/server/src/limits/overrides.ts`
- Modify: `packages/server/src/plugins/jwt.ts`: `verifyAccessToken` uses `loadAccount`; decorate `request.account`
- Modify: `packages/server/src/plugins/admin-guard.ts`: use `request.account.isAdmin` instead of a second query
- Modify: `packages/server/src/ws/live-route.ts` and `packages/server/src/ws/global-live-route.ts`: upgrade-time user read uses `loadAccount`
- Modify: `packages/server/src/db/schema.sqlite.ts`, `packages/server/src/db/schema.pg.ts`
- Create (generated): `packages/server/drizzle/sqlite/00NN_user_limits.sql`, `packages/server/drizzle/pg/00NN_user_limits.sql` and their `meta/` snapshots
- Create: `packages/server/tests/helpers/users.ts`
- Test: `packages/server/tests/limits/account.test.ts`
- Test: `packages/server/tests/limits/overrides.test.ts`

**Interfaces:**
- Consumes:
  - From Task 6: `LimitKey`, `LIMIT_KEYS`, `AdminLimitOverrideEntry`, and `isLimitKey`.
  - From `services/admin-audit.ts`: `recordAdminAction`.
- Produces:
  - **`limits/account.ts`:**
    - `interface RequestAccount { id: string; createdAt: string; isAdmin: boolean }`, with `createdAt` in ISO-8601 UTC
    - module augmentation `FastifyRequest.account?: RequestAccount`
    - `toIsoUtc(value: string): string`
    - `loadAccount(db: Db, userId: string): Promise<(RequestAccount & { disabled: boolean }) | undefined>`
  - **`limits/overrides.ts`:**
    - `interface LimitOverride { value: number; note: string | null; updatedBy: string | null; updatedAt: string }`
    - `class LimitOverridesService` with:
      - `constructor(db: Db)`
      - `forUser(userId: string): Promise<Map<LimitKey, number>>`
      - `get(userId: string, key: LimitKey): Promise<number | undefined>`
      - `listForUser(userId: string): Promise<Map<LimitKey, LimitOverride>>`
      - `set(adminId: string, userId: string, key: LimitKey, value: number, note: string | null): Promise<void>`
      - `clear(adminId: string, userId: string, key: LimitKey): Promise<boolean>`
      - `listAll(): Promise<AdminLimitOverrideEntry[]>`
  - **Schema:**
    - `schema.userLimitOverrides` (`userId`, `limitKey`, `value`, `note`, `updatedBy`, `updatedAt`; PK `(userId, limitKey)`)
    - `schema.users.registrationIp`
    - indexes `users_registration_ip_created_idx`, `games_created_by_created_at_idx`, `game_players_user_joined_idx`
  - **`tests/helpers/users.ts`:**
    - `registerUser(app, username, opts?: { remoteAddress?: string }): Promise<{ token: string; userId: string; headers: { authorization: string } }>`
      - `headers` is a convenience for `app.inject`.
      - This helper is created here rather than in Task 8 (deviation), because this task's tests need it.
    - `ageAccount(db, userId, days): Promise<void>`
    - `type TestDb`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/tests/helpers/users.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema.sqlite.js';
import type { createTestDb } from './app.js';

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

/**
 * Registers an ordinary (non-admin) user through `POST /auth/register`.
 * `remoteAddress` sets `request.ip`, for tests of per-IP and privileged limits.
 */
export async function registerUser(
  app: FastifyInstance,
  username: string,
  opts: { remoteAddress?: string } = {},
): Promise<{ token: string; userId: string; headers: { authorization: string } }> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
    ...(opts.remoteAddress ? { remoteAddress: opts.remoteAddress } : {}),
  });
  if (res.statusCode !== 201) {
    throw new Error(`registerUser: register failed: ${res.statusCode} ${res.body}`);
  }
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id, headers: { authorization: `Bearer ${body.token}` } };
}

/**
 * Back-dates an account's `created_at` by `days`, e.g. to make it mature.
 * Writes SQLite's `datetime('now')` format, which is what the column holds.
 */
export async function ageAccount(db: TestDb, userId: string, days: number): Promise<void> {
  const at = new Date(Date.now() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  await db.update(schema.users).set({ createdAt: at }).where(eq(schema.users.id, userId));
}
```

Create `packages/server/tests/limits/account.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { createTestAppWithDb, registerAdmin } from '../helpers/app.js';
import { registerUser, type TestDb } from '../helpers/users.js';
import { loadAccount, toIsoUtc, type RequestAccount } from '../../src/limits/account.js';
import * as schema from '../../src/db/schema.sqlite.js';
import { ADMIN_GROUP_ID } from '../../src/constants/groups.js';

describe('toIsoUtc', () => {
  it.each([
    ['2026-10-14 12:00:00', '2026-10-14T12:00:00.000Z'],
    ['2026-10-14 12:00:00.123456', '2026-10-14T12:00:00.123Z'],
    ['2026-10-14T12:00:00.000Z', '2026-10-14T12:00:00.000Z'],
    ['2026-10-14 14:00:00+02', '2026-10-14T12:00:00.000Z'],
    ['2026-10-14 14:00:00+02:00', '2026-10-14T12:00:00.000Z'],
  ])('%j → %j', (input, expected) => {
    expect(toIsoUtc(input)).toBe(expected);
  });

  it('returns an unparseable value unchanged', () => {
    expect(toIsoUtc('garbage')).toBe('garbage');
  });
});

describe('request.account', () => {
  let app: FastifyInstance;
  let db: TestDb;

  beforeAll(async () => {
    ({ app, db } = await createTestAppWithDb());
    // Must be added before the first inject — routes cannot be added once ready.
    app.get('/__account', { onRequest: app.authenticate }, async (request) => request.account ?? null);
  });

  afterAll(async () => {
    await app.close();
  });

  it('is set for an ordinary user with an ISO createdAt and isAdmin false', async () => {
    const user = await registerUser(app, 'acct-member');
    const res = await app.inject({ method: 'GET', url: '/__account', headers: user.headers });
    const account = res.json<RequestAccount>();
    expect(account.id).toBe(user.userId);
    expect(account.isAdmin).toBe(false);
    expect(account.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  it('is isAdmin true for an admin, and false on the next request after demotion', async () => {
    const admin = await registerAdmin(app, 'acct-admin');
    const headers = { authorization: `Bearer ${admin.token}` };
    expect((await app.inject({ method: 'GET', url: '/__account', headers })).json<RequestAccount>().isAdmin).toBe(true);

    await db
      .delete(schema.userGroups)
      .where(and(eq(schema.userGroups.userId, admin.userId), eq(schema.userGroups.groupId, ADMIN_GROUP_ID)));
    expect((await app.inject({ method: 'GET', url: '/__account', headers })).json<RequestAccount>().isAdmin).toBe(false);
  });

  it('loadAccount reports disabled and undefined for unknown users', async () => {
    const user = await registerUser(app, 'acct-disabled');
    await db.update(schema.users).set({ disabled: true }).where(eq(schema.users.id, user.userId));
    expect((await loadAccount(db, user.userId))?.disabled).toBe(true);
    expect(await loadAccount(db, 'no-such-user')).toBeUndefined();
  });

  it('requireAdmin still answers 403 to a member and 200 to an admin', async () => {
    const member = await registerUser(app, 'acct-guard-member');
    const admin = await registerAdmin(app, 'acct-guard-admin');
    expect((await app.inject({ method: 'GET', url: '/admin/config', headers: member.headers })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/admin/config', headers: { authorization: `Bearer ${admin.token}` } }))
        .statusCode,
    ).toBe(200);
  });
});
```

Create `packages/server/tests/limits/overrides.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '../helpers/app.js';
import type { TestDb } from '../helpers/users.js';
import * as schema from '../../src/db/schema.sqlite.js';
import { LimitOverridesService } from '../../src/limits/overrides.js';

async function insertUser(db: TestDb, prefix: string): Promise<string> {
  const [row] = await db
    .insert(schema.users)
    .values({ username: `${prefix}-${randomUUID().slice(0, 8)}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  return row!.id;
}

describe('LimitOverridesService', () => {
  let db: TestDb;
  let svc: LimitOverridesService;
  let adminId: string;
  let userId: string;

  beforeEach(async () => {
    db = await createTestDb();
    svc = new LimitOverridesService(db);
    adminId = await insertUser(db, 'ov-admin');
    userId = await insertUser(db, 'ov-user');
  });

  it('returns an empty map for a user with no overrides', async () => {
    expect((await svc.forUser(userId)).size).toBe(0);
    expect(await svc.get(userId, 'gamesCreated')).toBeUndefined();
  });

  it('set() persists, invalidates the cache, and audits', async () => {
    await svc.forUser(userId); // warm the cache with "no overrides"
    await svc.set(adminId, userId, 'gamesCreated', 40, 'tournament organiser');
    expect(await svc.get(userId, 'gamesCreated')).toBe(40);

    await svc.set(adminId, userId, 'gamesCreated', 60, null);
    expect(await svc.get(userId, 'gamesCreated')).toBe(60);

    const audit = await db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.targetId, userId));
    expect(audit.map((r) => r.action)).toEqual(['user.limit.override', 'user.limit.override']);
    expect(JSON.parse(audit[1]!.before!)).toEqual({ key: 'gamesCreated', value: 40, note: 'tournament organiser' });
    expect(JSON.parse(audit[1]!.after!)).toEqual({ key: 'gamesCreated', value: 60, note: null });
  });

  it('listForUser() returns value, note, author and ISO time', async () => {
    await svc.set(adminId, userId, 'trades', 500, 'market maker');
    const entry = (await svc.listForUser(userId)).get('trades');
    expect(entry).toMatchObject({ value: 500, note: 'market maker', updatedBy: adminId });
    expect(entry!.updatedAt).toMatch(/Z$/);
  });

  it('clear() removes, audits once, and is idempotent', async () => {
    await svc.set(adminId, userId, 'trades', 500, null);
    expect(await svc.clear(adminId, userId, 'trades')).toBe(true);
    expect(await svc.get(userId, 'trades')).toBeUndefined();
    expect(await svc.clear(adminId, userId, 'trades')).toBe(false);

    const resets = await db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.action, 'user.limit.reset'));
    expect(resets.filter((r) => r.targetId === userId)).toHaveLength(1);
  });

  it('listAll() names the user and the admin', async () => {
    await svc.set(adminId, userId, 'openOrders', 200, 'bot test');
    const entry = (await svc.listAll()).find((e) => e.userId === userId);
    expect(entry).toMatchObject({ key: 'openOrders', value: 200, note: 'bot test', updatedBy: adminId });
    expect(entry!.username).toMatch(/^ov-user-/);
    expect(entry!.updatedByUsername).toMatch(/^ov-admin-/);
  });

  it('ignores rows whose key is no longer a LimitKey', async () => {
    await db.insert(schema.userLimitOverrides).values({ userId, limitKey: 'retiredLimit', value: 3 });
    expect((await svc.forUser(userId)).size).toBe(0);
    expect((await svc.listAll()).some((e) => e.userId === userId)).toBe(false);
  });

  it('cascades when the user is deleted', async () => {
    await svc.set(adminId, userId, 'trades', 500, null);
    await db.delete(schema.adminAuditLog).where(eq(schema.adminAuditLog.targetId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    const rows = await db
      .select()
      .from(schema.userLimitOverrides)
      .where(eq(schema.userLimitOverrides.userId, userId));
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/limits/account.test.ts tests/limits/overrides.test.ts`
Expected: FAIL. `../../src/limits/account.js` and `../../src/limits/overrides.js` cannot be resolved, and `schema.userLimitOverrides` is undefined.

- [ ] **Step 3: Add the schema in both dialects**

In `packages/server/src/db/schema.sqlite.ts`, replace the `users` table with:

```ts
/** Registered platform accounts. One user can participate in many games. */
export const users = sqliteTable(
  'users',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    /** When true, login is rejected with 403. Set by admins via PATCH /admin/users/:id. */
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
    /**
     * `request.ip` at `POST /auth/register`. Counts registrations per network and
     * links sibling accounts on the admin page. Null for accounts created before
     * it was recorded. Personal data — listed in docs/pii-inventory.md.
     */
    registrationIp: text('registration_ip'),
  },
  (t) => [index('users_registration_ip_created_idx').on(t.registrationIp, t.createdAt)],
);
```

In the same file, in `games`, close the column object with an index config. Replace the final

```ts
  snapshotsCompactedAt: text('snapshots_compacted_at'),
});
```

of the `games` table with:

```ts
  snapshotsCompactedAt: text('snapshots_compacted_at'),
}, (t) => [index('games_created_by_created_at_idx').on(t.createdBy, t.createdAt)]);
```

In `gamePlayers`, replace `(t) => [unique().on(t.gameId, t.userId)],` with:

```ts
  (t) => [
    unique().on(t.gameId, t.userId),
    index('game_players_user_joined_idx').on(t.userId, t.joinedAt),
  ],
```

Append at the end of `schema.sqlite.ts`:

```ts
/**
 * Per-user exceptions to the global limits, set from the admin user page. The
 * value replaces the resolved limit outright: probation and the privileged
 * multiplier do not apply on top of it. Keys are `LimitKey`s; rows for keys
 * since removed from the catalogue are ignored on read.
 */
export const userLimitOverrides = sqliteTable(
  'user_limit_overrides',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    limitKey: text('limit_key').notNull(),
    value: integer('value').notNull(),
    /** Why the override exists, shown in the admin overrides list. */
    note: text('note'),
    /** Admin who last wrote the row. No FK, like `system_settings.updated_by`. */
    updatedBy: text('updated_by'),
    updatedAt: text('updated_at')
      .default(sql`(datetime('now'))`)
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.limitKey] })],
);
```

In `packages/server/src/db/schema.pg.ts`, replace the `users` table with:

```ts
/** Registered platform accounts. One user can participate in many games. */
export const users = pgTable(
  'users',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    /** When true, login is rejected with 403. Set by admins via PATCH /admin/users/:id. */
    disabled: boolean('disabled').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    /** `request.ip` at registration. See the SQLite variant. Personal data — docs/pii-inventory.md. */
    registrationIp: text('registration_ip'),
  },
  (t) => [index('users_registration_ip_created_idx').on(t.registrationIp, t.createdAt)],
);
```

In `games` (pg), replace the closing

```ts
  snapshotsCompactedAt: timestamp('snapshots_compacted_at', { mode: 'string' }),
});
```

with:

```ts
  snapshotsCompactedAt: timestamp('snapshots_compacted_at', { mode: 'string' }),
}, (t) => [index('games_created_by_created_at_idx').on(t.createdBy, t.createdAt)]);
```

In `gamePlayers` (pg), replace `(t) => [unique().on(t.gameId, t.userId)],` with:

```ts
  (t) => [
    unique().on(t.gameId, t.userId),
    index('game_players_user_joined_idx').on(t.userId, t.joinedAt),
  ],
```

Append at the end of `schema.pg.ts`:

```ts
/** Per-user exceptions to the global limits. See the SQLite variant. */
export const userLimitOverrides = pgTable(
  'user_limit_overrides',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    limitKey: text('limit_key').notNull(),
    value: integer('value').notNull(),
    note: text('note'),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.limitKey] })],
);
```

Generate both migrations:

```bash
pnpm --filter server db:generate --name user_limits
DATABASE_URL=postgres://u:p@localhost:5432/x pnpm --filter server db:generate --name user_limits
```

Expected: one new `.sql` file and an updated snapshot under each of `packages/server/drizzle/sqlite/` and `packages/server/drizzle/pg/`. Read both files and confirm they contain:
- `CREATE TABLE user_limit_overrides`
- `ALTER TABLE users ADD registration_ip`
- the three `CREATE INDEX` statements

with no table rebuilds or drops. Do not edit them.

- [ ] **Step 4: Implement `account.ts` and wire it in**

Create `packages/server/src/limits/account.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { ADMIN_GROUP_ID } from '../constants/groups.js';

/** Who an authenticated request belongs to, as far as limits care. */
export interface RequestAccount {
  id: string;
  /** ISO-8601 UTC. */
  createdAt: string;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `verifyAccessToken`; undefined on unauthenticated requests. */
    account?: RequestAccount;
  }
}

const HAS_ZONE = /(?:[zZ]|[+-]\d\d(?::?\d\d)?)$/;

/**
 * Normalises a stored timestamp to ISO-8601 UTC. SQLite's `datetime('now')` and
 * postgres-js's zone-less timestamps both come back as `YYYY-MM-DD HH:MM:SS[.f]`
 * in UTC with no zone, which `Date.parse` would read as local time.
 */
export function toIsoUtc(value: string): string {
  const parsed = new Date(HAS_ZONE.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/**
 * The live account row plus admin membership in one query: the left join finds
 * the admin `user_groups` row if there is one. Undefined when the user is gone.
 */
export async function loadAccount(
  db: Db,
  userId: string,
): Promise<(RequestAccount & { disabled: boolean }) | undefined> {
  const { users, userGroups } = schema;
  const [row] = await db
    .select({
      id: users.id,
      disabled: users.disabled,
      createdAt: users.createdAt,
      adminGroupId: userGroups.groupId,
    })
    .from(users)
    .leftJoin(userGroups, and(eq(userGroups.userId, users.id), eq(userGroups.groupId, ADMIN_GROUP_ID)))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return undefined;
  return {
    id: row.id,
    disabled: row.disabled,
    createdAt: toIsoUtc(row.createdAt),
    isAdmin: row.adminGroupId !== null,
  };
}
```

In `packages/server/src/plugins/jwt.ts`:

1. Replace the imports `import { eq } from 'drizzle-orm';` and `import { schema } from '../db/index.js';` with:

```ts
import { loadAccount } from '../limits/account.js';
```

Keep `import type { Db } from '../db/index.js';`.

2. In `verifyAccessToken`, replace

```ts
  const [current] = await db
    .select({ disabled: schema.users.disabled })
    .from(schema.users)
    .where(eq(schema.users.id, request.user.id))
    .limit(1);

  if (!current || current.disabled) {
    return unauthorized();
  }

  return true;
```

with

```ts
  const account = await loadAccount(db, request.user.id);
  if (!account || account.disabled) {
    return unauthorized();
  }

  request.account = { id: account.id, createdAt: account.createdAt, isAdmin: account.isAdmin };
  return true;
```

3. Add one sentence to the JSDoc of `verifyAccessToken`, at the end of its first paragraph:

```
 * On success it sets `request.account` (id, ISO `createdAt`, `isAdmin`) from
 * the same read, which is what per-user limits and admin immunity key on.
```

4. In `registerJwt`, directly after `await app.register(fastifyJwt, { secret: env.JWT_SECRET });`, add:

```ts
  app.decorateRequest('account', undefined);
```

In `packages/server/src/plugins/admin-guard.ts`:

1. Replace the body of the decorated function with:

```ts
    async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
      if (!(await verifyAccessToken(request, reply, db))) return;
      // `verifyAccessToken` already read admin membership into request.account.
      if (!request.account?.isAdmin) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    },
```

2. Delete the now-unused imports: `and, eq` from `drizzle-orm`, `schema`, and `ADMIN_GROUP_ID`. Keep `import type { Db }`.

3. Update the JSDoc of `registerAdminGuard` to say membership comes from `request.account.isAdmin`, which `verifyAccessToken` reads in its single account query.

In `packages/server/src/ws/live-route.ts`, add `import { loadAccount } from '../limits/account.js';` and replace

```ts
        const [account] = await db
          .select({ disabled: schema.users.disabled })
          .from(schema.users)
          .where(eq(schema.users.id, payload.id))
          .limit(1);
```

with

```ts
        const account = await loadAccount(db, payload.id);
```

In `packages/server/src/ws/global-live-route.ts`:

1. Make the same replacement, adding the same import.
2. Change `import { eq, inArray } from 'drizzle-orm';` to `import { inArray } from 'drizzle-orm';`, because `eq` has no other use there.

The following `if (!account || account.disabled)` lines stay unchanged in both files. Task 12 uses `account` for the connection cap.

- [ ] **Step 5: Implement `LimitOverridesService`**

Create `packages/server/src/limits/overrides.ts`:

```ts
import { and, eq, inArray } from 'drizzle-orm';
import type { AdminLimitOverrideEntry, LimitKey } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { recordAdminAction } from '../services/admin-audit.js';
import { isLimitKey } from './catalogue.js';
import { toIsoUtc } from './account.js';

/** One stored override with its provenance. */
export interface LimitOverride {
  value: number;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

// The resolver reads overrides on every limited request; the cache makes that a
// map lookup. Bounded so a flood of distinct users cannot grow it without limit.
const CACHE_MAX_USERS = 5_000;

/**
 * Reads and writes per-user limit overrides. Writes are audited in the same
 * transaction and invalidate the in-process cache; safe because the app runs
 * as a single process (ADR-017).
 */
export class LimitOverridesService {
  private readonly cache = new Map<string, Map<LimitKey, number>>();

  constructor(private readonly db: Db) {}

  /** Every override for `userId`, as values only. Cached, least-recently-used eviction. */
  async forUser(userId: string): Promise<Map<LimitKey, number>> {
    const hit = this.cache.get(userId);
    if (hit) {
      this.cache.delete(userId);
      this.cache.set(userId, hit);
      return hit;
    }
    const t = schema.userLimitOverrides;
    const rows = await this.db
      .select({ limitKey: t.limitKey, value: t.value })
      .from(t)
      .where(eq(t.userId, userId));
    const values = new Map<LimitKey, number>();
    for (const row of rows) if (isLimitKey(row.limitKey)) values.set(row.limitKey, row.value);
    this.cache.set(userId, values);
    if (this.cache.size > CACHE_MAX_USERS) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return values;
  }

  async get(userId: string, key: LimitKey): Promise<number | undefined> {
    return (await this.forUser(userId)).get(key);
  }

  /** Overrides for one user with note and author, uncached (admin views only). */
  async listForUser(userId: string): Promise<Map<LimitKey, LimitOverride>> {
    const t = schema.userLimitOverrides;
    const rows = await this.db.select().from(t).where(eq(t.userId, userId));
    const out = new Map<LimitKey, LimitOverride>();
    for (const row of rows) {
      if (!isLimitKey(row.limitKey)) continue;
      out.set(row.limitKey, {
        value: row.value,
        note: row.note,
        updatedBy: row.updatedBy,
        updatedAt: toIsoUtc(row.updatedAt),
      });
    }
    return out;
  }

  /** Creates or replaces one override and audits `user.limit.override`. `value` must already be validated. */
  async set(adminId: string, userId: string, key: LimitKey, value: number, note: string | null): Promise<void> {
    const t = schema.userLimitOverrides;
    const now = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ value: t.value, note: t.note })
        .from(t)
        .where(and(eq(t.userId, userId), eq(t.limitKey, key)))
        .limit(1);
      await tx
        .insert(t)
        .values({ userId, limitKey: key, value, note, updatedBy: adminId, updatedAt: now })
        .onConflictDoUpdate({
          target: [t.userId, t.limitKey],
          set: { value, note, updatedBy: adminId, updatedAt: now },
        });
      await recordAdminAction(tx, {
        adminUserId: adminId,
        action: 'user.limit.override',
        targetType: 'user',
        targetId: userId,
        before: before ? { key, value: before.value, note: before.note } : null,
        after: { key, value, note },
      });
    });
    this.cache.delete(userId);
  }

  /** Removes one override. Returns false (and audits nothing) when there was none. */
  async clear(adminId: string, userId: string, key: LimitKey): Promise<boolean> {
    const t = schema.userLimitOverrides;
    const removed = await this.db.transaction(async (tx) => {
      const rows = await tx
        .delete(t)
        .where(and(eq(t.userId, userId), eq(t.limitKey, key)))
        .returning({ value: t.value, note: t.note });
      const row = rows[0];
      if (!row) return false;
      await recordAdminAction(tx, {
        adminUserId: adminId,
        action: 'user.limit.reset',
        targetType: 'user',
        targetId: userId,
        before: { key, value: row.value, note: row.note },
        after: null,
      });
      return true;
    });
    this.cache.delete(userId);
    return removed;
  }

  /** Every active override with the target's and the author's usernames, newest first. */
  async listAll(): Promise<AdminLimitOverrideEntry[]> {
    const t = schema.userLimitOverrides;
    const rows = await this.db
      .select({
        userId: t.userId,
        username: schema.users.username,
        limitKey: t.limitKey,
        value: t.value,
        note: t.note,
        updatedBy: t.updatedBy,
        updatedAt: t.updatedAt,
      })
      .from(t)
      .innerJoin(schema.users, eq(schema.users.id, t.userId));

    const authorIds = [...new Set(rows.map((r) => r.updatedBy).filter((id): id is string => id !== null))];
    const authors =
      authorIds.length === 0
        ? []
        : await this.db
            .select({ id: schema.users.id, username: schema.users.username })
            .from(schema.users)
            .where(inArray(schema.users.id, authorIds));
    const authorName = new Map(authors.map((a) => [a.id, a.username]));

    const entries: AdminLimitOverrideEntry[] = [];
    for (const row of rows) {
      if (!isLimitKey(row.limitKey)) continue;
      entries.push({
        userId: row.userId,
        username: row.username,
        key: row.limitKey,
        value: row.value,
        note: row.note,
        updatedBy: row.updatedBy,
        updatedByUsername: row.updatedBy ? (authorName.get(row.updatedBy) ?? null) : null,
        updatedAt: toIsoUtc(row.updatedAt),
      });
    }
    return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/limits tests/admin tests/routes/admin-config.test.ts tests/security/f06-f22-ws-token-not-in-query.test.ts tests/security/f08-ws-revalidation.test.ts tests/migrate.test.ts`
Expected: PASS.

Run the whole server suite, because every authenticated route now goes through `loadAccount`:
`pnpm --filter server exec vitest run`
Expected: PASS (890+ tests).

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/limits/account.ts packages/server/src/limits/overrides.ts \
  packages/server/src/plugins/jwt.ts packages/server/src/plugins/admin-guard.ts \
  packages/server/src/ws/live-route.ts packages/server/src/ws/global-live-route.ts \
  packages/server/src/db/schema.sqlite.ts packages/server/src/db/schema.pg.ts \
  packages/server/drizzle/sqlite packages/server/drizzle/pg \
  packages/server/tests/helpers/users.ts packages/server/tests/limits/account.test.ts \
  packages/server/tests/limits/overrides.test.ts
git commit -m "feat(limits): request.account, override table, and LimitOverridesService

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `LimitResolver`, `LimitExceededError`, `LimitEnforcer`, and app wiring

This task adds the single place that decides a user's limit and the single error shape a
denial produces, and builds both once per app. It doesn't enforce any limit yet; Tasks 9–12
add the call sites.

**Files:**
- Create: `packages/server/src/limits/resolver.ts`
- Create: `packages/server/src/limits/errors.ts`
- Create: `packages/server/src/limits/enforce.ts`
- Create: `packages/server/src/limits/index.ts`
- Modify: `packages/server/src/app.ts`: `limits` option, `createLimits`, `registerLimitErrorHandler`, `app.decorate('limits', …)`
- Modify: `packages/server/tests/helpers/app.ts`: `TestAppOptions.limits`, defaulting to disabled
- Test: `packages/server/tests/limits/resolver.test.ts`
- Test: `packages/server/tests/limits/enforce.test.ts`
- Test: `packages/server/tests/limits/errors.test.ts`

**Interfaces:**
- Consumes:
  - From Task 6: `LIMIT_CATALOGUE`, `isMatureUser`, `isPrivilegedConnection`.
  - From Task 7: `RequestAccount`, `LimitOverridesService`.
- Produces:
  - **`limits/resolver.ts`:**
    - `interface LimitSubject { account?: RequestAccount; ip: string }`
    - `interface ResolvedLimit { key: LimitKey; max: number | null; basis: LimitBasis; privileged: boolean; probation: boolean }`
      - `privileged` means the multiplier *was applied*.
    - `probationValue(base: number, percent: number): number`
    - `class LimitResolver` with:
      - `constructor(config: ConfigReader, overrides: Pick<LimitOverridesService, 'get'>, opts?: { disabled?: boolean })`
      - `resolve(subject, key): Promise<ResolvedLimit>`
      - `resolveForUser(account, key): Promise<ResolvedLimit>`
      - `baseValue(key): number`
      - `isDisabled(): boolean` (an **addition**)
    - `subjectOf(request: FastifyRequest): LimitSubject`
  - **`limits/errors.ts`:**
    - `class LimitExceededError extends Error`, with `readonly resolved: ResolvedLimit & { max: number }`, `readonly retryAfterSeconds?: number`, and a settable `recorded: boolean` (default `false`) — set once a denial has been counted, so the Task 14 error-handler fallback never counts it twice
    - `limitMessage(key: LimitKey, max: number): string`
    - `statusFor(kind: LimitKind): 409 | 429`
    - `limitExceededBody(err: LimitExceededError): LimitExceededBody`
    - `registerLimitErrorHandler(app: FastifyInstance): void`
  - **`limits/enforce.ts`:**
    - `type DenialRecorder = (subject: LimitSubject, key: LimitKey | string) => void`
    - `interface EnforceOptions { retryAfter?: () => Promise<number | undefined> }`
    - `class LimitEnforcer` with:
      - `constructor(resolver: LimitResolver, recordDenial?: DenialRecorder)`
      - `enforce(request, key, count, opts?)`
      - `enforceFor(subject, key, count, opts?)`
    - `secondsUntilWindowFrees(oldestIso: string | null, windowMs: number, now?: number): number | undefined` (an **addition** — the **only** retry-after helper; Task 9 and Task 11 use it for `Retry-After`)
  - **`limits/index.ts`:**
    - `interface Limits { config: ConfigReader; resolver: LimitResolver; overrides: LimitOverridesService; enforcer: LimitEnforcer }`
      - `config` is the app's `ConfigReader`, so factories that only receive `limits` (auth, watchlists, games) can read live options via `limits.config.get(...)`.
      - There is no `tracker` field yet. Task 14 adds a **non-null** `tracker: UsageTracker` and passes its recorder to the enforcer inside `createLimits`.
    - `createLimits(deps: { db: Db; config: ConfigReader; disabled?: boolean }): Limits`
    - module augmentation `FastifyInstance.limits: Limits` (an **addition**, so tests can reach `app.limits`)
  - **`buildApp`:** option `limits?: { disabled?: boolean }`. Route factories receive `limits` in Tasks 9–12.
  - **Test fixture:** `TestAppOptions.limits?: { disabled?: boolean }`, defaulting to `{ disabled: true }`.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/tests/limits/resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { LimitBasis, LimitKey } from '@markettrader/shared';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { LimitResolver, probationValue, type LimitSubject } from '../../src/limits/resolver.js';
import type { RequestAccount } from '../../src/limits/account.js';

const DAY = 86_400_000;
const account = (id: string, ageDays: number, isAdmin = false): RequestAccount => ({
  id,
  createdAt: new Date(Date.now() - ageDays * DAY).toISOString(),
  isAdmin,
});

const MATURE = account('mature', 30);
const FRESH = account('fresh', 1);
const ADMIN = account('admin', 1, true);
const OFFICE = '203.0.113.7';
const HOME = '198.51.100.9';

function stubOverrides(entries: Record<string, Partial<Record<LimitKey, number>>>) {
  return { get: async (userId: string, key: LimitKey) => entries[userId]?.[key] };
}

function makeConfig(extra: Partial<Parameters<typeof RuntimeConfig.fromEnvironment>[0]> = {}) {
  return RuntimeConfig.fromEnvironment({
    LIMITS_ENABLED: true,
    LIMITS_MATURITY_DAYS: 7,
    LIMITS_PROBATION_PERCENT: 25,
    LIMITS_PRIVILEGED_CIDRS: '203.0.113.0/24',
    LIMITS_PRIVILEGED_MULTIPLIER: 10,
    LIMIT_GAMES_CREATED_PER_WEEK: 10,
    LIMIT_REGISTRATIONS_PER_IP_PER_DAY: 5,
    ...extra,
  });
}

interface Row {
  name: string;
  subject: LimitSubject;
  key?: LimitKey;
  overrides?: Record<string, Partial<Record<LimitKey, number>>>;
  max: number | null;
  basis: LimitBasis;
  privileged: boolean;
  probation: boolean;
}

// The precedence in spec §3.2: disabled → admin → override → probation → privileged.
const MATRIX: Row[] = [
  { name: 'mature, ordinary IP → base', subject: { account: MATURE, ip: HOME }, max: 10, basis: 'base', privileged: false, probation: false },
  { name: 'mature, office IP → base ×10', subject: { account: MATURE, ip: OFFICE }, max: 100, basis: 'base', privileged: true, probation: false },
  { name: 'fresh, ordinary IP → probation', subject: { account: FRESH, ip: HOME }, max: 3, basis: 'probation', privileged: false, probation: true },
  { name: 'fresh, office IP → probation ×10', subject: { account: FRESH, ip: OFFICE }, max: 30, basis: 'probation', privileged: true, probation: true },
  { name: 'override wins and takes no multiplier', subject: { account: MATURE, ip: OFFICE }, overrides: { mature: { gamesCreated: 4 } }, max: 4, basis: 'override', privileged: false, probation: false },
  { name: 'override lifts probation', subject: { account: FRESH, ip: HOME }, overrides: { fresh: { gamesCreated: 50 } }, max: 50, basis: 'override', privileged: false, probation: false },
  { name: 'override for another key does not apply', subject: { account: FRESH, ip: HOME }, overrides: { fresh: { trades: 999 } }, max: 3, basis: 'probation', privileged: false, probation: true },
  { name: 'admin → unlimited', subject: { account: ADMIN, ip: HOME }, max: null, basis: 'admin', privileged: false, probation: false },
  { name: 'admin beats an override', subject: { account: ADMIN, ip: HOME }, overrides: { admin: { gamesCreated: 1 } }, max: null, basis: 'admin', privileged: false, probation: false },
  { name: 'anonymous → base', subject: { ip: HOME }, max: 10, basis: 'base', privileged: false, probation: false },
  { name: 'anonymous on IPv4-mapped office IP → ×10', subject: { ip: `::ffff:${OFFICE}` }, max: 100, basis: 'base', privileged: true, probation: false },
  { name: 'ip limit: no probation for a fresh account', subject: { account: FRESH, ip: HOME }, key: 'registrationsPerIp', max: 5, basis: 'base', privileged: false, probation: false },
  { name: 'ip limit: overrides ignored', subject: { account: MATURE, ip: HOME }, key: 'registrationsPerIp', overrides: { mature: { registrationsPerIp: 99 } }, max: 5, basis: 'base', privileged: false, probation: false },
  { name: 'ip limit: office IP ×10', subject: { ip: OFFICE }, key: 'registrationsPerIp', max: 50, basis: 'base', privileged: true, probation: false },
];

describe('LimitResolver.resolve', () => {
  it.each(MATRIX)('$name', async (row) => {
    const resolver = new LimitResolver(makeConfig(), stubOverrides(row.overrides ?? {}));
    const key = row.key ?? 'gamesCreated';
    expect(await resolver.resolve(row.subject, key)).toEqual({
      key,
      max: row.max,
      basis: row.basis,
      privileged: row.privileged,
      probation: row.probation,
    });
  });

  it('LIMITS_ENABLED=false lifts every limit, even for a fresh account', async () => {
    const resolver = new LimitResolver(makeConfig({ LIMITS_ENABLED: false }), stubOverrides({}));
    expect(await resolver.resolve({ account: FRESH, ip: HOME }, 'gamesCreated')).toMatchObject({ max: null, basis: 'disabled' });
  });

  it('opts.disabled (the test fixture) behaves like LIMITS_ENABLED=false', async () => {
    const resolver = new LimitResolver(makeConfig(), stubOverrides({}), { disabled: true });
    expect(await resolver.resolve({ account: FRESH, ip: HOME }, 'gamesCreated')).toMatchObject({ max: null, basis: 'disabled' });
    expect(resolver.isDisabled()).toBe(true);
  });

  it('reads every value live', async () => {
    const config = makeConfig();
    const resolver = new LimitResolver(config, stubOverrides({}));
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 20);
    config.set('LIMITS_PROBATION_PERCENT', 50);
    expect((await resolver.resolve({ account: FRESH, ip: HOME }, 'gamesCreated')).max).toBe(10);
  });

  it('resolveForUser never applies the privileged multiplier', async () => {
    const resolver = new LimitResolver(makeConfig(), stubOverrides({}));
    expect(await resolver.resolveForUser(MATURE, 'gamesCreated')).toMatchObject({ max: 10, privileged: false });
  });

  it('baseValue reads the catalogue config key', () => {
    const resolver = new LimitResolver(makeConfig(), stubOverrides({}));
    expect(resolver.baseValue('gamesCreated')).toBe(10);
    expect(resolver.baseValue('registrationsPerIp')).toBe(5);
  });
});

describe('probationValue', () => {
  it.each([
    [10, 25, 3],
    [50, 25, 13],
    [30, 25, 8],
    [60, 25, 15],
    [600, 25, 150],
    [1, 25, 1],
    [3, 1, 1],
    [7, 100, 7],
  ])('probationValue(%i, %i) = %i', (base, percent, expected) => {
    expect(probationValue(base, percent)).toBe(expected);
  });
});
```

Create `packages/server/tests/limits/enforce.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { LimitResolver, type LimitSubject } from '../../src/limits/resolver.js';
import { LimitEnforcer, secondsUntilWindowFrees } from '../../src/limits/enforce.js';
import { LimitExceededError } from '../../src/limits/errors.js';

const mature = { id: 'u1', createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), isAdmin: false };
const admin = { ...mature, id: 'a1', isAdmin: true };
const subject: LimitSubject = { account: mature, ip: '198.51.100.1' };

function setup() {
  const config = RuntimeConfig.fromEnvironment({ LIMITS_ENABLED: true, LIMIT_ACTIVE_GAMES_OWNED: 2, LIMIT_GAMES_CREATED_PER_WEEK: 2 });
  const resolver = new LimitResolver(config, { get: async () => undefined });
  const recordDenial = vi.fn();
  return { enforcer: new LimitEnforcer(resolver, recordDenial), recordDenial };
}

describe('LimitEnforcer', () => {
  it('admits while usage is below the max', async () => {
    const { enforcer, recordDenial } = setup();
    await expect(enforcer.enforceFor(subject, 'activeGamesOwned', async () => 1)).resolves.toBeUndefined();
    expect(recordDenial).not.toHaveBeenCalled();
  });

  it('throws LimitExceededError at the max and records the denial', async () => {
    const { enforcer, recordDenial } = setup();
    const err = await enforcer.enforceFor(subject, 'activeGamesOwned', async () => 2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LimitExceededError);
    expect((err as LimitExceededError).resolved).toMatchObject({ key: 'activeGamesOwned', max: 2, basis: 'base' });
    expect(recordDenial).toHaveBeenCalledWith(subject, 'activeGamesOwned');
    expect((err as LimitExceededError).recorded).toBe(true);
  });

  it('carries retryAfter from the option', async () => {
    const { enforcer } = setup();
    const err = await enforcer
      .enforceFor(subject, 'gamesCreated', async () => 2, { retryAfter: async () => 3600 })
      .catch((e: unknown) => e);
    expect((err as LimitExceededError).retryAfterSeconds).toBe(3600);
  });

  it('never counts for an admin', async () => {
    const { enforcer } = setup();
    const count = vi.fn(async () => 1_000);
    await enforcer.enforceFor({ account: admin, ip: '198.51.100.1' }, 'activeGamesOwned', count);
    expect(count).not.toHaveBeenCalled();
  });
});

describe('secondsUntilWindowFrees', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  it('is the time until the oldest counted row leaves the window, rounded up', () => {
    expect(secondsUntilWindowFrees('2026-10-14T11:00:00.000Z', 2 * 3_600_000, now)).toBe(3600);
    expect(secondsUntilWindowFrees('2026-10-14T11:00:00.500Z', 3_600_000, now)).toBe(1);
  });
  it('is at least 1 and undefined without a row', () => {
    expect(secondsUntilWindowFrees('2026-10-14T10:00:00.000Z', 3_600_000, now)).toBe(1);
    expect(secondsUntilWindowFrees(null, 3_600_000, now)).toBeUndefined();
  });
});
```

Create `packages/server/tests/limits/errors.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { LimitExceededBody } from '@markettrader/shared';
import { createTestApp } from '../helpers/app.js';
import { LimitExceededError, limitMessage, statusFor } from '../../src/limits/errors.js';

describe('limit error handling', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
    app.get('/__quota', async () => {
      throw new LimitExceededError(
        { key: 'gamesCreated', max: 3, basis: 'probation', privileged: false, probation: true },
        7200,
      );
    });
    app.get('/__concurrent', async () => {
      throw new LimitExceededError({ key: 'activeGamesOwned', max: 5, basis: 'base', privileged: false, probation: false });
    });
    app.get('/__other', async () => {
      throw app.httpErrors.badRequest('nope');
    });
    app.withTypeProvider<ZodTypeProvider>().get(
      '/__validated',
      { schema: { querystring: z.object({ n: z.coerce.number().int() }) } },
      async () => ({ ok: true }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers a quota denial with 429, Retry-After and the shared body', async () => {
    const res = await app.inject({ method: 'GET', url: '/__quota' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('7200');
    expect(res.json<LimitExceededBody>()).toEqual({
      error: 'Game creation limit reached (3 per week)',
      code: 'LIMIT_EXCEEDED',
      limit: 'gamesCreated',
      max: 3,
      probation: true,
      retryAfterSeconds: 7200,
    });
  });

  it('answers a concurrent denial with 409 and no Retry-After', async () => {
    const res = await app.inject({ method: 'GET', url: '/__concurrent' });
    expect(res.statusCode).toBe(409);
    expect(res.headers['retry-after']).toBeUndefined();
    expect(res.json<LimitExceededBody>()).toEqual({
      error: 'Active games owned limit reached (5 at once)',
      code: 'LIMIT_EXCEEDED',
      limit: 'activeGamesOwned',
      max: 5,
      probation: false,
    });
  });

  it('leaves every other error to Fastify’s default handler', async () => {
    const res = await app.inject({ method: 'GET', url: '/__other' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ statusCode: 400, error: 'Bad Request', message: 'nope' });

    const invalid = await app.inject({ method: 'GET', url: '/__validated?n=abc' });
    expect(invalid.statusCode).toBe(400);
  });

  it('statusFor maps kinds', () => {
    expect(statusFor('rate')).toBe(429);
    expect(statusFor('quota')).toBe(429);
    expect(statusFor('ip')).toBe(429);
    expect(statusFor('concurrent')).toBe(409);
    expect(limitMessage('openOrders', 13)).toBe('Open order limit reached (13 per game)');
  });

  it('exposes the limits bundle on the app', () => {
    expect(app.limits.resolver.isDisabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/limits/resolver.test.ts tests/limits/enforce.test.ts tests/limits/errors.test.ts`
Expected: FAIL. The resolver, enforce and errors modules don't exist, and `app.limits` is undefined.

- [ ] **Step 3: Implement the resolver**

Create `packages/server/src/limits/resolver.ts`:

```ts
import type { FastifyRequest } from 'fastify';
import type { LimitBasis, LimitKey } from '@markettrader/shared';
import type { ConfigReader } from '../config/runtime-config.js';
import type { RequestAccount } from './account.js';
import type { LimitOverridesService } from './overrides.js';
import { LIMIT_CATALOGUE } from './catalogue.js';
import { isMatureUser, isPrivilegedConnection } from './policy.js';

/** Who is asking: the account when authenticated, and always the connection's IP. */
export interface LimitSubject {
  account?: RequestAccount;
  ip: string;
}

/** A limit as it applies to one subject right now. `max: null` means unlimited. */
export interface ResolvedLimit {
  key: LimitKey;
  max: number | null;
  basis: LimitBasis;
  /** True when the privileged multiplier was applied. */
  privileged: boolean;
  /** True when the max was reduced because the account is new. */
  probation: boolean;
}

/** The reduced value for an account on probation: `percent`% of `base`, rounded up, at least 1. */
export function probationValue(base: number, percent: number): number {
  return Math.max(1, Math.ceil((base * percent) / 100));
}

/** The limit subject of an incoming request. */
export function subjectOf(request: FastifyRequest): LimitSubject {
  return { account: request.account, ip: request.ip };
}

/**
 * Decides one subject's limit, in this order: disabled → admin (unlimited) →
 * per-user override (exact, no multiplier) → base value, reduced while the
 * account is on probation → ×`LIMITS_PRIVILEGED_MULTIPLIER` on a privileged IP.
 * Every value is read live on each call.
 */
export class LimitResolver {
  constructor(
    private readonly config: ConfigReader,
    private readonly overrides: Pick<LimitOverridesService, 'get'>,
    private readonly opts: { disabled?: boolean } = {},
  ) {}

  /** True when every limit is lifted: by the test fixture or by `LIMITS_ENABLED=false`. */
  isDisabled(): boolean {
    return this.opts.disabled === true || !this.config.get('LIMITS_ENABLED');
  }

  /** The global value of `key`, before probation, overrides, or multipliers. */
  baseValue(key: LimitKey): number {
    return this.config.get(LIMIT_CATALOGUE[key].configKey);
  }

  async resolve(subject: LimitSubject, key: LimitKey): Promise<ResolvedLimit> {
    if (this.isDisabled()) return unlimited(key, 'disabled');
    const { account } = subject;
    if (account?.isAdmin) return unlimited(key, 'admin');

    const descriptor = LIMIT_CATALOGUE[key];
    if (account && descriptor.overridable) {
      const override = await this.overrides.get(account.id, key);
      if (override !== undefined) {
        return { key, max: override, basis: 'override', privileged: false, probation: false };
      }
    }

    let max = this.baseValue(key);
    let basis: LimitBasis = 'base';
    let probation = false;
    if (account && descriptor.probation && !isMatureUser(account, this.config)) {
      max = probationValue(max, this.config.get('LIMITS_PROBATION_PERCENT'));
      basis = 'probation';
      probation = true;
    }

    const privileged = isPrivilegedConnection(subject.ip, this.config);
    if (privileged) max *= this.config.get('LIMITS_PRIVILEGED_MULTIPLIER');
    return { key, max, basis, privileged, probation };
  }

  /**
   * The limit for `account` on an ordinary connection. For admin views, where
   * privilege depends on where a request comes from, not who sent it.
   */
  resolveForUser(account: RequestAccount, key: LimitKey): Promise<ResolvedLimit> {
    return this.resolve({ account, ip: '' }, key);
  }
}

function unlimited(key: LimitKey, basis: 'disabled' | 'admin'): ResolvedLimit {
  return { key, max: null, basis, privileged: false, probation: false };
}
```

- [ ] **Step 4: Implement errors and the enforcer**

Create `packages/server/src/limits/errors.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { LimitExceededBody, LimitKey, LimitKind } from '@markettrader/shared';
import { LIMIT_CATALOGUE } from './catalogue.js';
import type { ResolvedLimit } from './resolver.js';

/** "Game creation limit reached (3 per week)". */
export function limitMessage(key: LimitKey, max: number): string {
  const d = LIMIT_CATALOGUE[key];
  return `${d.label} limit reached (${max} ${d.per})`;
}

/** 409 for "too many open at once" (matches the existing watchlist caps); 429 for everything windowed. */
export function statusFor(kind: LimitKind): 409 | 429 {
  return kind === 'concurrent' ? 409 : 429;
}

/** Thrown by enforcement points; turned into a {@link LimitExceededBody} by {@link registerLimitErrorHandler}. */
export class LimitExceededError extends Error {
  /**
   * True once the denial has been counted (by the enforcer or the rate-limit
   * plugin's `onExceeded`). Denials thrown from elsewhere stay false and are
   * counted by the error handler instead — never both.
   */
  recorded = false;

  constructor(
    readonly resolved: ResolvedLimit & { max: number },
    readonly retryAfterSeconds?: number,
  ) {
    super(limitMessage(resolved.key, resolved.max));
    this.name = 'LimitExceededError';
  }
}

export function limitExceededBody(err: LimitExceededError): LimitExceededBody {
  return {
    error: err.message,
    code: 'LIMIT_EXCEEDED',
    limit: err.resolved.key,
    max: err.resolved.max,
    probation: err.resolved.probation,
    ...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
  };
}

/**
 * Root error handler for {@link LimitExceededError}. Must be registered before
 * any route plugin, because route contexts inherit the error handler at
 * registration. Any other error is rethrown, which hands it to Fastify's
 * default handler, so existing error bodies are unchanged.
 */
export function registerLimitErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: Error, _request, reply) => {
    if (!(err instanceof LimitExceededError)) throw err;
    if (err.retryAfterSeconds !== undefined) {
      void reply.header('retry-after', String(err.retryAfterSeconds));
    }
    return reply.code(statusFor(LIMIT_CATALOGUE[err.resolved.key].kind)).send(limitExceededBody(err));
  });
}
```

Create `packages/server/src/limits/enforce.ts`:

```ts
import type { FastifyRequest } from 'fastify';
import type { LimitKey } from '@markettrader/shared';
import { LimitExceededError } from './errors.js';
import { subjectOf, type LimitResolver, type LimitSubject } from './resolver.js';

/** Called once per denial. The usage tracker (Task 14) is the real recorder. */
export type DenialRecorder = (subject: LimitSubject, key: LimitKey | string) => void;

export interface EnforceOptions {
  /** Seconds until one more would be admitted; only computed on denial. */
  retryAfter?: () => Promise<number | undefined>;
}

/**
 * Seconds until the oldest row counted in a rolling window ages out, rounded up,
 * at least 1. Undefined when no row was counted.
 */
export function secondsUntilWindowFrees(
  oldestIso: string | null,
  windowMs: number,
  now: number = Date.now(),
): number | undefined {
  if (oldestIso === null) return undefined;
  const ms = Date.parse(oldestIso) + windowMs - now;
  return Math.max(1, Math.ceil(ms / 1000));
}

/**
 * Applies quota and concurrent limits at their call sites. Resolves first, so an
 * unlimited subject (admin, limits off) never pays for the count query.
 */
export class LimitEnforcer {
  constructor(
    private readonly resolver: LimitResolver,
    private readonly recordDenial: DenialRecorder = () => {},
  ) {}

  /** Throws {@link LimitExceededError} when `count()` has already reached the request's limit. */
  enforce(
    request: FastifyRequest,
    key: LimitKey,
    count: () => Promise<number>,
    opts?: EnforceOptions,
  ): Promise<void> {
    return this.enforceFor(subjectOf(request), key, count, opts);
  }

  async enforceFor(
    subject: LimitSubject,
    key: LimitKey,
    count: () => Promise<number>,
    opts: EnforceOptions = {},
  ): Promise<void> {
    const resolved = await this.resolver.resolve(subject, key);
    if (resolved.max === null) return;
    if ((await count()) < resolved.max) return;
    this.recordDenial(subject, key);
    const retryAfter = opts.retryAfter ? await opts.retryAfter() : undefined;
    const err = new LimitExceededError({ ...resolved, max: resolved.max }, retryAfter);
    err.recorded = true;
    throw err;
  }
}
```

Create `packages/server/src/limits/index.ts`:

```ts
import type { Db } from '../db/index.js';
import type { ConfigReader } from '../config/runtime-config.js';
import { LimitOverridesService } from './overrides.js';
import { LimitResolver } from './resolver.js';
import { LimitEnforcer } from './enforce.js';

/** Everything per-user limits need, built once per app by {@link createLimits}. */
export interface Limits {
  /** The app's live options — lets factories that only receive `limits` read `limits.config.get(...)`. */
  config: ConfigReader;
  resolver: LimitResolver;
  overrides: LimitOverridesService;
  enforcer: LimitEnforcer;
}

declare module 'fastify' {
  interface FastifyInstance {
    limits: Limits;
  }
}

/** `disabled` lifts every limit for this app — the test fixture default. */
export function createLimits(deps: { db: Db; config: ConfigReader; disabled?: boolean }): Limits {
  const overrides = new LimitOverridesService(deps.db);
  const resolver = new LimitResolver(deps.config, overrides, { disabled: deps.disabled });
  const enforcer = new LimitEnforcer(resolver);
  return { config: deps.config, resolver, overrides, enforcer };
}
```

- [ ] **Step 5: Wire into `buildApp` and the test fixture**

In `packages/server/src/app.ts`:

1. Add the imports:

```ts
import { createLimits } from './limits/index.js';
import { registerLimitErrorHandler } from './limits/errors.js';
```

2. Add to the `opts` type, after `runtimeConfig?: RuntimeConfig;`:

```ts
    /** Pass `{ disabled: true }` to lift every per-user limit. Tests only. */
    limits?: { disabled?: boolean };
```

3. Add `limits: limitOptions = {},` to the destructuring, after `runtimeConfig = RuntimeConfig.fromEnvironment(),`.

4. After `await registerSwagger(app);`, add:

```ts
  // Before any route plugin: route contexts inherit the error handler at registration.
  registerLimitErrorHandler(app);
```

5. After the `if (activeOverrides.length > 0) { … }` block, add:

```ts
  // After overrides load, so the first resolved limit already reflects them.
  const limits = createLimits({ db, config: runtimeConfig, disabled: limitOptions.disabled });
  app.decorate('limits', limits);
```

In `packages/server/tests/helpers/app.ts`:

1. Add to `TestAppOptions`:

```ts
  /**
   * Per-user limits. Disabled unless a test opts in with `{ disabled: false }`,
   * because new accounts are on probation and shared fixtures would trip the
   * reduced quotas.
   */
  limits?: { disabled?: boolean };
```

2. In `createTestAppWithDb`, add to the `buildApp({...})` call, after `runtimeConfig: config,`:

```ts
    limits: options.limits ?? { disabled: true },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/limits`
Expected: PASS.

The error handler is root-wide, so check that no existing error body changed:
`pnpm --filter server exec vitest run`
Expected: PASS, including `tests/security/f23-onerror-status-classification.test.ts` and every validation-error test.

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/limits/resolver.ts packages/server/src/limits/errors.ts \
  packages/server/src/limits/enforce.ts packages/server/src/limits/index.ts \
  packages/server/src/app.ts packages/server/tests/helpers/app.ts \
  packages/server/tests/limits/resolver.test.ts packages/server/tests/limits/enforce.test.ts \
  packages/server/tests/limits/errors.test.ts
git commit -m "feat(limits): resolver, enforcer, and LIMIT_EXCEEDED error handling

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
## Phase 2 — Enforcement (Tasks 9–11)

> Interfaces this phase consumes from Tasks 6–8:
> - `Limits` (from `S/limits/index.ts`, Task 8) exposes `config: ConfigReader`, `resolver`, `overrides`, `enforcer` (`tracker` arrives in Task 14). `config` is the reader `createLimits` was built with — factories that only receive `limits` read live options through `limits.config.get(...)`.
> - `LimitEnforcer.enforce(request, key, count, { retryAfter? })` / `enforceFor(subject, key, count, { retryAfter? })` skip `count()` entirely when the resolved max is `null`, and throw `LimitExceededError` when `count() >= max`.
> - `LimitExceededError` instances thrown anywhere (handler, hook, or service) are turned into the HTTP body by the error handler T8 registers; route code never builds the body itself.
> - `toIsoUtc(raw)` from `S/limits/account.ts` normalises a SQLite `YYYY-MM-DD HH:MM:SS` or Postgres timestamp string to an ISO UTC string.
> - Test helpers from Task 7: `registerUser(app, username, { remoteAddress? }) → { token, userId, headers }`, `ageAccount(db, userId, days)` in `T/helpers/users.ts` (do not re-create the file).
> - `secondsUntilWindowFrees(oldestIso: string | null, windowMs, now?)` from `S/limits/enforce.ts` (Task 8) is the only retry-after helper. It expects an ISO timestamp, so the `oldest*Since` helpers below return ISO (`toIsoUtc`).

---

### Task 9: Quota and concurrent caps — games, open orders, watchlists

**Files:**
- Create: `packages/server/src/limits/quota-counts.ts`
- Modify: `packages/server/src/routes/games.ts` (factory signature, `POST /games`, `POST /games/:id/join`)
- Modify: `packages/server/src/routes/trading.ts` (factory signature, working + pending branches)
- Delete: `packages/server/src/services/open-orders.ts` (Task 3's constant cap, superseded by `limits/quota-counts.ts`)
- Modify: `packages/server/src/services/working-order.ts` (drop `MAX_OPEN_ORDERS_PER_PLAYER`, take `openOrderLimit`)
- Modify: `packages/server/src/services/pending-trade.ts` (take `openOrderLimit`; replace the T3 constant check)
- Modify: `packages/server/src/providers/interface.ts` (drop `TOO_MANY_OPEN_ORDERS`)
- Modify: `packages/server/src/routes/watchlists.ts` (factory signature, both caps through the enforcer)
- Modify: `packages/server/src/app.ts` (pass `limits` to the three factories)
- Modify: 13 test files that call `buildApp` directly (add `limits: { disabled: true }`)
- Modify: `packages/frontend/playwright.config.ts` (e2e server runs with `LIMITS_ENABLED=false`)
- Modify: `packages/server/tests/security/f20-resting-order-symbol.test.ts`, `packages/server/tests/security/f18-watchlist-caps.test.ts`
- Test: `packages/server/tests/limits/quotas.test.ts`, `packages/server/tests/limits/open-orders.test.ts`

**Interfaces:**
- Consumes: `Limits` (incl. `config`), `LimitEnforcer.enforce`, `LimitResolver.resolve`, `subjectOf`, `ResolvedLimit`, `LimitExceededError`, `secondsUntilWindowFrees`, `LIMIT_CATALOGUE`, `toIsoUtc`, `registerUser`, `ageAccount`, `LimitOverridesService.set`; `gameRoutes(db, config, bus?)` and `checkGameBounds` from Task 1, the `GAME_MAX_PLAYERS` check from Task 2.
- Produces (used by T11, T16):
  ```ts
  // S/limits/quota-counts.ts
  export type Reader = Pick<Db, 'select'>;
  export function toSqlTimestamp(d: Date): string;                       // 'YYYY-MM-DD HH:MM:SS' UTC
  export function windowStart(key: LimitKey, now?: number): string;      // toSqlTimestamp(now - windowMs)
  export function countGamesCreatedSince(db: Reader, userId: string, since: string): Promise<number>;
  export function oldestGameCreatedSince(db: Reader, userId: string, since: string): Promise<string | null>; // ISO UTC
  export function countActiveGamesOwned(db: Reader, userId: string, nowIso?: string): Promise<number>;
  export function countGamesJoinedSince(db: Reader, userId: string, since: string): Promise<number>;
  export function oldestJoinSince(db: Reader, userId: string, since: string): Promise<string | null>; // ISO UTC
  export function countActiveGamesJoined(db: Reader, userId: string, nowIso?: string): Promise<number>;
  export function countOpenOrders(db: Reader, gamePlayerId: string): Promise<number>;
  export function assertOpenOrderCapacity(db: Reader, gamePlayerId: string, rowsToInsert: number, limit: ResolvedLimit | undefined): Promise<void>;
  export function countRegistrationsSince(db: Reader, ip: string, since: string): Promise<number>;   // used by T11
  export function oldestRegistrationSince(db: Reader, ip: string, since: string): Promise<string | null>; // ISO UTC, used by T11
  ```
  Route factory signatures after this task:
  `gameRoutes(db: Db, limits: Limits, bus?: EventBus)`,
  `tradingRoutes(db, provider, marketStatusProvider, config, limits: Limits, registry?, leaderboardThrottleMs?, bus?)`,
  `watchlistRoutes(db: Db, limits: Limits)`.
  Service inputs gain `openOrderLimit?: ResolvedLimit` (`PlaceWorkingOrderInput`, `ReservePendingParams`). Absent = no cap check; the trade route always passes it.

- [ ] **Step 1: Keep every non-limit suite on the old behaviour**

New accounts start on probation, so a suite that builds its own app would suddenly meet caps of 2 active games. Add `limits: { disabled: true },` directly after `disablePoller: true,` in every `buildApp({ … })` call in these files (skip any that already pass it):

```
packages/server/tests/auth.test.ts
packages/server/tests/app-workers.test.ts
packages/server/tests/security/f08-ws-revalidation.test.ts
packages/server/tests/security/f21-ws-frame-limits.test.ts
packages/server/tests/security/f06-f22-ws-token-not-in-query.test.ts
packages/server/tests/observability/analytics.test.ts
packages/server/tests/routes/rate-limit-proxy.test.ts
packages/server/tests/routes/admin/trades-achievement.test.ts
packages/server/tests/ws/live-route-connect-window.test.ts
packages/server/tests/ws/live-route-achievement-replay.test.ts
packages/server/tests/ws/global-live-route.test.ts
packages/server/tests/ws/live.test.ts
packages/server/tests/ws/admin-achievement-broadcast.test.ts
```

Find them with: `grep -rln "buildApp(" packages/server/tests | grep -v helpers`.

In `packages/frontend/playwright.config.ts`, add to the server `env` block, after `DISCOVER_REFRESH_INTERVAL_MS: '1000',`:

```ts
        // E2E specs register many accounts from one IP and create games freely;
        // limits get their own coverage in the server suite.
        LIMITS_ENABLED: 'false',
```

- [ ] **Step 2: Write the failing quota tests**

Create `packages/server/tests/limits/quotas.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { LimitExceededBody } from '@markettrader/shared';
import { createTestAppWithDb, registerAdmin } from '../helpers/app.js';
import { registerUser, ageAccount } from '../helpers/users.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { schema } from '../../src/db/index.js';

type Db = Awaited<ReturnType<typeof createTestAppWithDb>>['db'];

const DAY_MS = 86_400_000;

function gamePayload(name: string) {
  const now = Date.now();
  return {
    name,
    startDate: new Date(now - 60_000).toISOString(),
    endDate: new Date(now + 7 * DAY_MS).toISOString(),
    startingBalance: 100_000,
  };
}

function createGame(app: FastifyInstance, token: string, name: string, remoteAddress?: string) {
  return app.inject({
    method: 'POST',
    url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: gamePayload(name),
    ...(remoteAddress ? { remoteAddress } : {}),
  });
}

function joinGame(app: FastifyInstance, token: string, gameId: string) {
  return app.inject({
    method: 'POST',
    url: `/games/${gameId}/join`,
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('game quotas', () => {
  let app: FastifyInstance;
  let db: Db;
  let config: RuntimeConfig;
  let seq = 0;
  const fresh = (prefix: string) => `${prefix}-${++seq}`;

  beforeAll(async () => {
    ({ app, db, config } = await createTestAppWithDb(undefined, undefined, {
      limits: { disabled: false },
      runtimeConfig: RuntimeConfig.fromEnvironment({
        LIMIT_GAMES_CREATED_PER_WEEK: 2,
        LIMIT_ACTIVE_GAMES_OWNED: 100,
        LIMIT_GAMES_JOINED_PER_DAY: 100,
        LIMIT_ACTIVE_GAMES_JOINED: 100,
        LIMITS_PROBATION_PERCENT: 100,
      }),
    }));
  });
  afterAll(() => app.close());
  afterEach(() => {
    config.clearAll();
  });

  it('refuses the game past LIMIT_GAMES_CREATED_PER_WEEK with a 429 and Retry-After', async () => {
    const { token } = await registerUser(app, fresh('creator'));
    expect((await createGame(app, token, 'g1')).statusCode).toBe(201);
    expect((await createGame(app, token, 'g2')).statusCode).toBe(201);

    const over = await createGame(app, token, 'g3');
    expect(over.statusCode).toBe(429);
    const body = over.json<LimitExceededBody>();
    expect(body).toMatchObject({ code: 'LIMIT_EXCEEDED', limit: 'gamesCreated', max: 2, probation: false });
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(7 * 86_400);
    expect(Number(over.headers['retry-after'])).toBe(body.retryAfterSeconds);
  });

  it('stops counting games once they fall outside the 7-day window', async () => {
    const { token, userId } = await registerUser(app, fresh('window'));
    await createGame(app, token, 'w1');
    await createGame(app, token, 'w2');
    expect((await createGame(app, token, 'w3')).statusCode).toBe(429);

    await db
      .update(schema.games)
      .set({ createdAt: '2000-01-01 00:00:00' })
      .where(eq(schema.games.createdBy, userId));

    expect((await createGame(app, token, 'w4')).statusCode).toBe(201);
  });

  it('caps games owned that have not ended with a 409', async () => {
    config.set('LIMIT_ACTIVE_GAMES_OWNED', 1);
    const { token } = await registerUser(app, fresh('owner'));
    expect((await createGame(app, token, 'o1')).statusCode).toBe(201);

    const over = await createGame(app, token, 'o2');
    expect(over.statusCode).toBe(409);
    expect(over.json<LimitExceededBody>()).toMatchObject({ limit: 'activeGamesOwned', max: 1 });
  });

  it('frees an owned-game slot when that game ends', async () => {
    config.set('LIMIT_ACTIVE_GAMES_OWNED', 1);
    const { token, userId } = await registerUser(app, fresh('ender'));
    await createGame(app, token, 'e1');
    await db.update(schema.games).set({ status: 'ended' }).where(eq(schema.games.createdBy, userId));

    expect((await createGame(app, token, 'e2')).statusCode).toBe(201);
  });

  it('caps active games joined, counting the creator seat', async () => {
    const host = await registerUser(app, fresh('host'));
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push((await createGame(app, host.token, `j${i}`)).json<{ id: string }>().id);
    }
    // Lowered only now: the host's own creator seats count against it too.
    config.set('LIMIT_ACTIVE_GAMES_JOINED', 2);

    const player = await registerUser(app, fresh('joiner'));
    expect((await joinGame(app, player.token, ids[0]!)).statusCode).toBe(201);
    expect((await joinGame(app, player.token, ids[1]!)).statusCode).toBe(201);
    const over = await joinGame(app, player.token, ids[2]!);
    expect(over.statusCode).toBe(409);
    expect(over.json<LimitExceededBody>()).toMatchObject({ limit: 'activeGamesJoined', max: 2 });

    // Creating a game seats the creator, so it is refused by the same cap.
    const created = await createGame(app, player.token, 'mine');
    expect(created.statusCode).toBe(409);
    expect(created.json<LimitExceededBody>().limit).toBe('activeGamesJoined');
  });

  it('caps games joined per day with a 429', async () => {
    const host = await registerUser(app, fresh('dayhost'));
    const a = (await createGame(app, host.token, 'd1')).json<{ id: string }>().id;
    const b = (await createGame(app, host.token, 'd2')).json<{ id: string }>().id;
    config.set('LIMIT_GAMES_JOINED_PER_DAY', 1);

    const player = await registerUser(app, fresh('dayjoiner'));
    expect((await joinGame(app, player.token, a)).statusCode).toBe(201);
    const over = await joinGame(app, player.token, b);
    expect(over.statusCode).toBe(429);
    expect(over.json<LimitExceededBody>()).toMatchObject({ limit: 'gamesJoined', max: 1 });
  });

  it('still reports "already joined" to a member who is at the cap', async () => {
    config.set('LIMIT_ACTIVE_GAMES_JOINED', 1);
    const host = await registerUser(app, fresh('dup-host'));
    const gameId = (await createGame(app, host.token, 'dup')).json<{ id: string }>().id;

    const res = await joinGame(app, host.token, gameId);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe('Already joined this game');
  });

  it('exempts admins', async () => {
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 1);
    const admin = await registerAdmin(app, fresh('quota-admin'));
    for (let i = 0; i < 3; i += 1) {
      expect((await createGame(app, admin.token, `a${i}`)).statusCode).toBe(201);
    }
  });

  it('honours a per-user override over the global value', async () => {
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 1);
    const admin = await registerAdmin(app, fresh('override-admin'));
    const user = await registerUser(app, fresh('overridden'));
    await app.limits.overrides.set(admin.userId, user.userId, 'gamesCreated', 3, 'quota test');

    for (let i = 0; i < 3; i += 1) {
      expect((await createGame(app, user.token, `ov${i}`)).statusCode).toBe(201);
    }
    expect((await createGame(app, user.token, 'ov3')).statusCode).toBe(429);
  });

  it('puts new accounts on probation until they mature', async () => {
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 4);
    config.set('LIMITS_PROBATION_PERCENT', 50);
    const user = await registerUser(app, fresh('rookie'));

    await createGame(app, user.token, 'r1');
    await createGame(app, user.token, 'r2');
    const over = await createGame(app, user.token, 'r3');
    expect(over.statusCode).toBe(429);
    expect(over.json<LimitExceededBody>()).toMatchObject({ max: 2, probation: true });

    await ageAccount(db, user.userId, 30);
    expect((await createGame(app, user.token, 'r4')).statusCode).toBe(201);
  });

  it('multiplies the limit on a privileged connection', async () => {
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 1);
    config.set('LIMITS_PRIVILEGED_CIDRS', '203.0.113.0/24');
    config.set('LIMITS_PRIVILEGED_MULTIPLIER', 3);
    const user = await registerUser(app, fresh('office'));

    for (let i = 0; i < 3; i += 1) {
      expect((await createGame(app, user.token, `p${i}`, '203.0.113.20')).statusCode).toBe(201);
    }
    expect((await createGame(app, user.token, 'p3', '203.0.113.20')).statusCode).toBe(429);
  });

  it('lifts every quota when LIMITS_ENABLED is false', async () => {
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 1);
    config.set('LIMITS_ENABLED', false);
    const user = await registerUser(app, fresh('killswitch'));
    for (let i = 0; i < 3; i += 1) {
      expect((await createGame(app, user.token, `k${i}`)).statusCode).toBe(201);
    }
  });

  // Review Focus #2: SQLite stores `created_at` as `YYYY-MM-DD HH:MM:SS` (UTC, no T/Z), so a
  // window boundary compared as an ISO string would be off by the 'T' vs ' ' sort order.
  it('counts a game created 6d23h ago and ignores one created 7d1h ago', async () => {
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 1);
    const { token, userId } = await registerUser(app, fresh('boundary'));
    expect((await createGame(app, token, 'b1')).statusCode).toBe(201);
    const sqliteTime = (msAgo: number) =>
      new Date(Date.now() - msAgo).toISOString().replace('T', ' ').slice(0, 19);
    const HOUR_MS = 3_600_000;

    await db
      .update(schema.games)
      .set({ createdAt: sqliteTime(7 * DAY_MS - HOUR_MS) })
      .where(eq(schema.games.createdBy, userId));
    expect((await createGame(app, token, 'b2')).statusCode).toBe(429);

    await db
      .update(schema.games)
      .set({ createdAt: sqliteTime(7 * DAY_MS + HOUR_MS) })
      .where(eq(schema.games.createdBy, userId));
    expect((await createGame(app, token, 'b3')).statusCode).toBe(201);
  });

  // Review Focus #4: an override below current usage must deny new creates without touching
  // existing rows.
  it('denies the next create when an override is lowered below current usage', async () => {
    // The suite boots with 2 creates/week; raise it so the 5 setup games are not refused by it.
    config.set('LIMIT_GAMES_CREATED_PER_WEEK', 10);
    config.set('LIMIT_ACTIVE_GAMES_OWNED', 10);
    const admin = await registerAdmin(app, fresh('lower-admin'));
    const user = await registerUser(app, fresh('lowered'));
    for (let i = 0; i < 5; i += 1) {
      expect((await createGame(app, user.token, `l${i}`)).statusCode).toBe(201);
    }
    // The app's own service: its per-user cache is already warm from the creates above.
    await app.limits.overrides.set(admin.userId, user.userId, 'activeGamesOwned', 2, 'lowered');

    const over = await createGame(app, user.token, 'l5');
    expect(over.statusCode).toBe(409);
    expect(over.json<LimitExceededBody>()).toMatchObject({ limit: 'activeGamesOwned', max: 2 });
    const owned = await db.select().from(schema.games).where(eq(schema.games.createdBy, user.userId));
    expect(owned).toHaveLength(5);
  });
});
```

Note: `RuntimeConfig.clearAll()` only clears values set with `config.set`, so the boot values passed to `fromEnvironment` survive the `afterEach`.

- [ ] **Step 3: Write the failing open-order tests**

Create `packages/server/tests/limits/open-orders.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ResolvedLimit } from '../../src/limits/resolver.js';
import { LimitExceededError } from '../../src/limits/errors.js';
import { createTestDb } from '../helpers/app.js';
import { placeWorkingOrder } from '../../src/services/working-order.js';
import { reservePendingTrade } from '../../src/services/pending-trade.js';
import { schema } from '../../src/db/index.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

function limitOf(max: number | null): ResolvedLimit {
  return { key: 'openOrders', max, basis: 'base', privileged: false, probation: false };
}

async function seed(): Promise<{ db: Db; gamePlayerId: string }> {
  const db = await createTestDb();
  const tag = Math.random().toString(36).slice(2, 10);
  const [user] = await db
    .insert(schema.users)
    .values({ username: `oo_${tag}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  const [game] = await db
    .insert(schema.games)
    .values({
      name: `oo_${tag}`,
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 1_000_000,
      status: 'active',
      createdBy: user!.id,
      allowLimitOrders: true,
      allowBracketOrders: true,
    })
    .returning({ id: schema.games.id });
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game!.id, userId: user!.id, cashBalance: 1_000_000 })
    .returning({ id: schema.gamePlayers.id });
  return { db, gamePlayerId: gp!.id };
}

function limitBuy(db: Db, gamePlayerId: string, symbol: string, limit: ResolvedLimit | undefined) {
  return placeWorkingOrder(db, {
    gamePlayerId,
    symbol,
    direction: 'buy',
    quantity: 1,
    orderType: 'limit',
    timeInForce: 'gtc',
    limitPrice: 1,
    openOrderLimit: limit,
  });
}

function pendingBuy(db: Db, gamePlayerId: string, symbol: string, limit: ResolvedLimit | undefined) {
  return reservePendingTrade(db, {
    gamePlayerId,
    symbol,
    direction: 'buy',
    quantity: 1,
    reservedPrice: 1,
    openOrderLimit: limit,
  });
}

describe('open-order cap', () => {
  it('refuses a working order past the resolved max', async () => {
    const { db, gamePlayerId } = await seed();
    await limitBuy(db, gamePlayerId, 'AAA', limitOf(2));
    await limitBuy(db, gamePlayerId, 'BBB', limitOf(2));
    await expect(limitBuy(db, gamePlayerId, 'CCC', limitOf(2))).rejects.toBeInstanceOf(LimitExceededError);
  });

  it('refuses a pending order past the resolved max', async () => {
    const { db, gamePlayerId } = await seed();
    await pendingBuy(db, gamePlayerId, 'AAA', limitOf(2));
    await pendingBuy(db, gamePlayerId, 'BBB', limitOf(2));
    await expect(pendingBuy(db, gamePlayerId, 'CCC', limitOf(2))).rejects.toBeInstanceOf(LimitExceededError);
  });

  it('counts working and pending rows together', async () => {
    const { db, gamePlayerId } = await seed();
    await limitBuy(db, gamePlayerId, 'AAA', limitOf(2));
    await pendingBuy(db, gamePlayerId, 'BBB', limitOf(2));
    await expect(pendingBuy(db, gamePlayerId, 'CCC', limitOf(2))).rejects.toBeInstanceOf(LimitExceededError);
    await expect(limitBuy(db, gamePlayerId, 'DDD', limitOf(2))).rejects.toBeInstanceOf(LimitExceededError);
  });

  it('counts all three rows of a bracket against the cap', async () => {
    const { db, gamePlayerId } = await seed();
    await limitBuy(db, gamePlayerId, 'AAA', limitOf(3));
    await expect(
      placeWorkingOrder(db, {
        gamePlayerId,
        symbol: 'BBB',
        direction: 'buy',
        quantity: 1,
        orderType: 'bracket',
        timeInForce: 'gtc',
        limitPrice: 10,
        takeProfitPrice: 12,
        stopLossPrice: 8,
        openOrderLimit: limitOf(3),
      }),
    ).rejects.toBeInstanceOf(LimitExceededError);
  });

  it('carries the resolved limit on the error', async () => {
    const { db, gamePlayerId } = await seed();
    await pendingBuy(db, gamePlayerId, 'AAA', limitOf(1));
    const err = await pendingBuy(db, gamePlayerId, 'BBB', limitOf(1)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LimitExceededError);
    expect((err as LimitExceededError).resolved).toMatchObject({ key: 'openOrders', max: 1 });
  });

  it('applies no cap when the resolved max is null (admin) or no limit is passed', async () => {
    const { db, gamePlayerId } = await seed();
    for (const symbol of ['AAA', 'BBB', 'CCC']) await limitBuy(db, gamePlayerId, symbol, limitOf(null));
    for (const symbol of ['DDD', 'EEE']) await pendingBuy(db, gamePlayerId, symbol, undefined);
  });
});
```

In `packages/server/tests/security/f20-resting-order-symbol.test.ts`, replace the import block and the `caps the number of resting orders…` test:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createTestApp, createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { placeWorkingOrder, listWorkingOrders } from '../../src/services/working-order.js';
import { LimitExceededError } from '../../src/limits/errors.js';
import type { ResolvedLimit } from '../../src/limits/resolver.js';
import { schema } from '../../src/db/index.js';

const OPEN_ORDER_LIMIT: ResolvedLimit = {
  key: 'openOrders',
  max: 50,
  basis: 'base',
  privileged: false,
  probation: false,
};
```

```ts
  it('caps the number of resting orders one player can accumulate', async () => {
    const { db, gamePlayerId } = await seed();
    const max = OPEN_ORDER_LIMIT.max!;
    for (let i = 0; i < max; i++) {
      await placeWorkingOrder(db, {
        gamePlayerId,
        symbol: junkSymbol(i),
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        timeInForce: 'gtc',
        limitPrice: 0.01,
        openOrderLimit: OPEN_ORDER_LIMIT,
      });
    }
    expect(await listWorkingOrders(db, gamePlayerId)).toHaveLength(max);

    await expect(
      placeWorkingOrder(db, {
        gamePlayerId,
        symbol: junkSymbol(max),
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        timeInForce: 'gtc',
        limitPrice: 0.01,
        openOrderLimit: OPEN_ORDER_LIMIT,
      }),
    ).rejects.toBeInstanceOf(LimitExceededError);

    expect(await listWorkingOrders(db, gamePlayerId)).toHaveLength(max);
  });
```

Then run `grep -rn "MAX_OPEN_ORDERS_PER_PLAYER\|TOO_MANY_OPEN_ORDERS" packages/server/tests` — any further hit (for example a pending-cap regression test T3 added) gets the same treatment: drop the constant import, pass `openOrderLimit: { key: 'openOrders', max: <the number it used>, basis: 'base', privileged: false, probation: false }`, and assert `rejects.toBeInstanceOf(LimitExceededError)`.

- [ ] **Step 4: Update the watchlist cap test to run with limits on**

In `packages/server/tests/security/f18-watchlist-caps.test.ts`, change the `beforeAll` so the caps (which now go through the resolver, and so vanish under the default disabled fixture) are live and fresh accounts get the full value:

```ts
import { RuntimeConfig } from '../../src/config/runtime-config.js';
```

```ts
  beforeAll(async () => {
    ({ app, config } = await createTestAppWithDb(undefined, undefined, {
      limits: { disabled: false },
      runtimeConfig: RuntimeConfig.fromEnvironment({ LIMITS_PROBATION_PERCENT: 100 }),
    }));
    token = await registerUser(app, 'f18-capped');
  });
```

(Change the existing `import type { RuntimeConfig }` line to the value import above.) After the first test's `expect(overflow.statusCode).toBe(409);` add:

```ts
    expect(overflow.json<{ code: string; limit: string }>()).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      limit: 'watchlistItems',
    });
```

and after the second test's `expect(overflow.statusCode).toBe(409);` add:

```ts
    expect(overflow.json<{ code: string; limit: string }>()).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      limit: 'watchlists',
    });
```

The existing `toContain(String(config.get('WATCHLIST_MAX_ITEMS')))` assertion stays; the error message from T8 includes the max.

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/limits/quotas.test.ts tests/limits/open-orders.test.ts tests/security/f18-watchlist-caps.test.ts tests/security/f20-resting-order-symbol.test.ts`
Expected: FAIL — `quotas.test.ts` sees 201 where it expects 429/409; `open-orders.test.ts` fails to typecheck/compile on `openOrderLimit` or resolves where it expects `LimitExceededError`; f18 sees an `error`-only body without `code`.

- [ ] **Step 6: Implement `quota-counts.ts`**

Create `packages/server/src/limits/quota-counts.ts`:

```ts
import { and, count, eq, gt, gte, inArray, min, ne } from 'drizzle-orm';
import type { LimitKey } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { LIMIT_CATALOGUE } from './catalogue.js';
import { toIsoUtc } from './account.js';
import type { ResolvedLimit } from './resolver.js';
import { LimitExceededError } from './errors.js';

/** Anything that can run a select — the app `db` or an open transaction. */
export type Reader = Pick<Db, 'select'>;

/**
 * Formats `d` the way the `created_at`/`joined_at` defaults store it.
 * SQLite's `datetime('now')` writes `YYYY-MM-DD HH:MM:SS`, and comparison there
 * is textual — an ISO string's `T` sorts after the space and would skew every
 * window. Postgres parses the same format into its timestamp column.
 */
export function toSqlTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Start of `key`'s rolling window, as a value comparable with stored timestamps. */
export function windowStart(key: LimitKey, now: number = Date.now()): string {
  const windowMs = LIMIT_CATALOGUE[key].windowMs;
  if (windowMs == null) throw new Error(`limit ${key} has no window`);
  return toSqlTimestamp(new Date(now - windowMs));
}

export async function countGamesCreatedSince(db: Reader, userId: string, since: string): Promise<number> {
  const { games } = schema;
  const [row] = await db
    .select({ n: count() })
    .from(games)
    .where(and(eq(games.createdBy, userId), gte(games.createdAt, since)));
  return Number(row?.n ?? 0);
}

export async function oldestGameCreatedSince(db: Reader, userId: string, since: string): Promise<string | null> {
  const { games } = schema;
  const [row] = await db
    .select({ at: min(games.createdAt) })
    .from(games)
    .where(and(eq(games.createdBy, userId), gte(games.createdAt, since)));
  // ISO, because `secondsUntilWindowFrees` parses it and the stored SQLite
  // format would be read as local time.
  return row?.at ? toIsoUtc(row.at) : null;
}

/**
 * Games the user created that are still running. Stored `status` can lag
 * behind the clock (it is recomputed lazily), so a game past its `endDate`
 * is excluded by date as well as by status.
 */
export async function countActiveGamesOwned(
  db: Reader,
  userId: string,
  nowIso: string = new Date().toISOString(),
): Promise<number> {
  const { games } = schema;
  const [row] = await db
    .select({ n: count() })
    .from(games)
    .where(and(eq(games.createdBy, userId), ne(games.status, 'ended'), gt(games.endDate, nowIso)));
  return Number(row?.n ?? 0);
}

export async function countGamesJoinedSince(db: Reader, userId: string, since: string): Promise<number> {
  const { gamePlayers } = schema;
  const [row] = await db
    .select({ n: count() })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.userId, userId), gte(gamePlayers.joinedAt, since)));
  return Number(row?.n ?? 0);
}

export async function oldestJoinSince(db: Reader, userId: string, since: string): Promise<string | null> {
  const { gamePlayers } = schema;
  const [row] = await db
    .select({ at: min(gamePlayers.joinedAt) })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.userId, userId), gte(gamePlayers.joinedAt, since)));
  // ISO, because `secondsUntilWindowFrees` parses it and the stored SQLite
  // format would be read as local time.
  return row?.at ? toIsoUtc(row.at) : null;
}

/** Seats the user holds in games that are still running (same lag caveat as {@link countActiveGamesOwned}). */
export async function countActiveGamesJoined(
  db: Reader,
  userId: string,
  nowIso: string = new Date().toISOString(),
): Promise<number> {
  const { games, gamePlayers } = schema;
  const [row] = await db
    .select({ n: count() })
    .from(gamePlayers)
    .innerJoin(games, eq(gamePlayers.gameId, games.id))
    .where(and(eq(gamePlayers.userId, userId), ne(games.status, 'ended'), gt(games.endDate, nowIso)));
  return Number(row?.n ?? 0);
}

/** `working` + `pending` rows one game-player holds — both are re-quoted every tick. */
export async function countOpenOrders(db: Reader, gamePlayerId: string): Promise<number> {
  const { trades } = schema;
  const [row] = await db
    .select({ n: count() })
    .from(trades)
    .where(and(eq(trades.gamePlayerId, gamePlayerId), inArray(trades.status, ['working', 'pending'])));
  return Number(row?.n ?? 0);
}

/**
 * Throws {@link LimitExceededError} when adding `rowsToInsert` open orders
 * would pass `limit.max`. A bracket inserts three rows, so the check is on the
 * total after insert rather than the usual `count >= max`. Call it inside the
 * transaction that inserts, so SQLite's single writer makes it exact.
 */
export async function assertOpenOrderCapacity(
  db: Reader,
  gamePlayerId: string,
  rowsToInsert: number,
  limit: ResolvedLimit | undefined,
): Promise<void> {
  if (!limit || limit.max === null) return;
  const open = await countOpenOrders(db, gamePlayerId);
  if (open + rowsToInsert > limit.max) {
    throw new LimitExceededError({ ...limit, max: limit.max });
  }
}

export async function countRegistrationsSince(db: Reader, ip: string, since: string): Promise<number> {
  const { users } = schema;
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.registrationIp, ip), gte(users.createdAt, since)));
  return Number(row?.n ?? 0);
}

export async function oldestRegistrationSince(db: Reader, ip: string, since: string): Promise<string | null> {
  const { users } = schema;
  const [row] = await db
    .select({ at: min(users.createdAt) })
    .from(users)
    .where(and(eq(users.registrationIp, ip), gte(users.createdAt, since)));
  // ISO, because `secondsUntilWindowFrees` parses it and the stored SQLite
  // format would be read as local time.
  return row?.at ? toIsoUtc(row.at) : null;
}
```

- [ ] **Step 7: Enforce in `POST /games` and `POST /games/:id/join`**

In `packages/server/src/routes/games.ts`, add imports:

```ts
import type { FastifyRequest } from 'fastify';
import type { Limits } from '../limits/index.js';
import { LIMIT_CATALOGUE } from '../limits/catalogue.js';
import {
  countActiveGamesJoined,
  countActiveGamesOwned,
  countGamesCreatedSince,
  countGamesJoinedSince,
  oldestGameCreatedSince,
  oldestJoinSince,
  windowStart,
} from '../limits/quota-counts.js';
import { secondsUntilWindowFrees } from '../limits/enforce.js';
```

Remove `import type { ConfigReader } from '../config/runtime-config.js';` (added by Task 1) — the config now arrives inside `limits`.

(merge `FastifyRequest` into the existing `import type { FastifyInstance } from 'fastify';` line.) Add above `gameRoutes`:

```ts
/**
 * Both limits a new seat counts against. Creating a game seats its creator,
 * so `POST /games` runs these too.
 */
async function enforceSeatLimits(db: Db, limits: Limits, request: FastifyRequest, userId: string): Promise<void> {
  const now = Date.now();
  await limits.enforcer.enforce(request, 'activeGamesJoined', () => countActiveGamesJoined(db, userId));
  const since = windowStart('gamesJoined', now);
  await limits.enforcer.enforce(request, 'gamesJoined', () => countGamesJoinedSince(db, userId, since), {
    retryAfter: async () =>
      secondsUntilWindowFrees(await oldestJoinSince(db, userId, since), LIMIT_CATALOGUE.gamesJoined.windowMs!, now),
  });
}
```

Change the factory signature Task 1 left as `gameRoutes(db: Db, config: ConfigReader, bus?: EventBus)` — `config` is replaced by `limits`, which carries the same reader as `limits.config` — and its JSDoc line:

```ts
 * `limits` enforces the per-user game creation and join caps; `limits.config`
 * supplies the live game bounds.
 */
export function gameRoutes(db: Db, limits: Limits, bus?: EventBus) {
```

Then update the two Task 1/Task 2 reads in the same file:

```ts
      const boundsError = checkGameBounds({ startDate, endDate, startingBalance }, limits.config);
```

```ts
      if (Number(players) >= limits.config.get('GAME_MAX_PLAYERS')) {
```

After this edit `grep -n "config\.get(\|, config)" packages/server/src/routes/games.ts` must show only `limits.config` reads.

In `POST /games`, directly after `const userId = request.user.id;` and before the invite-code comment, insert:

```ts
      // Checked before any insert, outside a transaction: the insert loop below
      // retries on a unique-constraint error, which would abort a Postgres
      // transaction. The only overshoot this allows is one user racing
      // their own concurrent creates.
      const now = Date.now();
      await limits.enforcer.enforce(request, 'activeGamesOwned', () => countActiveGamesOwned(db, userId));
      const createdSince = windowStart('gamesCreated', now);
      await limits.enforcer.enforce(
        request,
        'gamesCreated',
        () => countGamesCreatedSince(db, userId, createdSince),
        {
          retryAfter: async () =>
            secondsUntilWindowFrees(
              await oldestGameCreatedSince(db, userId, createdSince),
              LIMIT_CATALOGUE.gamesCreated.windowMs!,
              now,
            ),
        },
      );
      await enforceSeatLimits(db, limits, request, userId);
```

In `POST /games/:id/join`, replace

```ts
      const status = await recomputeGameStatus(db, game, new Date().toISOString(), bus);
      if (status === 'ended') return reply.status(409).send({ error: 'Game has ended' });
```

with

```ts
      const status = await recomputeGameStatus(db, game, new Date().toISOString(), bus);
      if (status === 'ended') return reply.status(409).send({ error: 'Game has ended' });

      // Answered before the caps so a member at their limit still hears the
      // accurate reason rather than a quota error for a seat they already hold.
      const [already] = await db
        .select({ id: gamePlayers.id })
        .from(gamePlayers)
        .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
        .limit(1);
      if (already) return reply.status(409).send({ error: 'Already joined this game' });

      await enforceSeatLimits(db, limits, request, userId);
```

(If T2's `GAME_FULL` check sits between these lines, keep it immediately after the `already` check and before `enforceSeatLimits`.)

- [ ] **Step 8: Thread the open-order limit through both services**

Task 3 left the cap in `packages/server/src/services/open-orders.ts` (`MAX_OPEN_ORDERS_PER_PLAYER` plus `assertOpenOrderCapacity(tx, gamePlayerId, rowsToInsert, max?)`, throwing `TradeError('TOO_MANY_OPEN_ORDERS')`), imported by both services and re-exported from `working-order.ts`. This step replaces it with the resolver-driven check in `limits/quota-counts.ts`.

1. Delete `packages/server/src/services/open-orders.ts` (`git rm packages/server/src/services/open-orders.ts`).

2. In `packages/server/src/services/working-order.ts`:
   - Remove Task 3's `import { assertOpenOrderCapacity } from './open-orders.js';` and `export { MAX_OPEN_ORDERS_PER_PLAYER } from './open-orders.js';`.
   - Add imports:
     ```ts
     import type { ResolvedLimit } from '../limits/resolver.js';
     import { assertOpenOrderCapacity } from '../limits/quota-counts.js';
     ```
   - Add to `PlaceWorkingOrderInput`, after `expiresAt?: string;`:
     ```ts
       /**
        * The caller's resolved `openOrders` limit. Resting rows are re-quoted by
        * the trigger worker and the price poller every tick, so the trade route
        * always passes it; omitting it skips the cap (service-level tests only).
        */
       openOrderLimit?: ResolvedLimit;
     ```
   - In `placeWorkingOrder`, add `openOrderLimit,` to the destructuring of `input`, and replace Task 3's
     `await assertOpenOrderCapacity(tx, gamePlayerId, orderType === 'bracket' ? 3 : 1);` with:
     ```ts
      await assertOpenOrderCapacity(tx, gamePlayerId, orderType === 'bracket' ? 3 : 1, openOrderLimit);
     ```

3. In `packages/server/src/services/pending-trade.ts`:
   - Replace Task 3's `import { assertOpenOrderCapacity } from './open-orders.js';` with:
     ```ts
     import type { ResolvedLimit } from '../limits/resolver.js';
     import { assertOpenOrderCapacity } from '../limits/quota-counts.js';
     ```
   - Add to `ReservePendingParams`, after `reservedPrice: number;`:
     ```ts
       /** The caller's resolved `openOrders` limit — see `PlaceWorkingOrderInput.openOrderLimit`. */
       openOrderLimit?: ResolvedLimit;
     ```
   - Change the destructuring to `const { gamePlayerId, symbol, direction, quantity, reservedPrice, openOrderLimit } = params;`.
   - Replace Task 3's first transaction statement `await assertOpenOrderCapacity(tx, gamePlayerId, 1);` with:
     ```ts
    await assertOpenOrderCapacity(tx, gamePlayerId, 1, openOrderLimit);
     ```
   - In the `@throws` JSDoc of `reservePendingTrade`, replace the `TOO_MANY_OPEN_ORDERS` mention Task 3 added with `{@link LimitExceededError} when the open-order cap is reached.`

4. `grep -rn "open-orders\|MAX_OPEN_ORDERS_PER_PLAYER" packages/server/src` must return nothing.

In `packages/server/src/providers/interface.ts`, remove the `TOO_MANY_OPEN_ORDERS` line from the doc list and the `| 'TOO_MANY_OPEN_ORDERS'` member of the union.

- [ ] **Step 9: Resolve the limit in the trade route**

In `packages/server/src/routes/trading.ts`, add imports:

```ts
import type { Limits } from '../limits/index.js';
import { subjectOf } from '../limits/resolver.js';
```

Change the factory signature (and add a JSDoc line `` `limits` supplies the caller's open-order cap.``):

```ts
export function tradingRoutes(
  db: Db,
  provider: StockProvider,
  marketStatusProvider: MarketStatusProvider,
  config: ConfigReader,
  limits: Limits,
  registry?: GameClientRegistry,
  leaderboardThrottleMs = LEADERBOARD_THROTTLE_MS,
  bus?: EventBus,
) {
```

After the `GAME_NOT_ACTIVE` early return, insert:

```ts
        // Resolved once for both resting branches; the services count and
        // compare inside the transaction that inserts.
        const openOrderLimit = await limits.resolver.resolve(subjectOf(request), 'openOrders');
```

Add `openOrderLimit,` as the last property in the `placeWorkingOrder(db, { … })` call and in the `reservePendingTrade(db, { … })` call. Nothing else changes: both `catch` blocks only map `TradeError`, so the `LimitExceededError` the services throw is rethrown to T8's error handler (409 + `LimitExceededBody`).

- [ ] **Step 10: Watchlist caps through the enforcer**

In `packages/server/src/routes/watchlists.ts`, replace `import type { ConfigReader } from '../config/runtime-config.js';` with:

```ts
import type { Limits } from '../limits/index.js';
```

Change the JSDoc line `` `config` supplies the live watchlist caps.`` to `` `limits` enforces the per-user watchlist caps.`` and the signature to:

```ts
export function watchlistRoutes(db: Db, limits: Limits) {
```

Replace the per-user check in `POST /watchlists`:

```ts
      // Checked only on the branch that inserts, so a user at the cap can still
      // fetch an existing list by name above.
      await limits.enforcer.enforce(request, 'watchlists', async () => {
        const [owned] = await db
          .select({ total: count() })
          .from(watchlists)
          .where(eq(watchlists.userId, userId));
        return Number(owned?.total ?? 0);
      });
```

Replace the per-list check in `POST /watchlists/:id/items`:

```ts
        if (!existing.symbols.includes(symbol)) {
          await limits.enforcer.enforce(request, 'watchlistItems', async () => existing.symbols.length);
          try {
```

(the `try` and everything after it are unchanged).

- [ ] **Step 11: Wire `limits` into the factories**

In `packages/server/src/app.ts`, change the three registrations (the first replaces Task 1's `gameRoutes(db, runtimeConfig, bus)`):

```ts
  await app.register(gameRoutes(db, limits, bus));
```

```ts
  await app.register(
    tradingRoutes(db, provider, marketStatusProvider, runtimeConfig, limits, registry, leaderboardThrottleMs, bus),
  );
```

```ts
  await app.register(watchlistRoutes(db, limits));
```

(`limits` is the object T8 builds with `createLimits(...)` before route registration.)

- [ ] **Step 12: Run the tests to verify they pass**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/limits tests/security/f18-watchlist-caps.test.ts tests/security/f20-resting-order-symbol.test.ts tests/routes/games.test.ts tests/routes/watchlists.test.ts tests/routes/trading.test.ts tests/routes/trading-advanced-orders.test.ts tests/routes/trading-market-hours.test.ts tests/services`
Expected: PASS.

Then the whole server suite plus typecheck and lint, since three factory signatures changed:

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. A failure in a suite that builds its own app means Step 1 missed a file; a typecheck failure naming `gameRoutes`/`tradingRoutes`/`watchlistRoutes` means a caller still uses the old signature.

- [ ] **Step 13: Commit**

```bash
git add packages/server/src/limits/quota-counts.ts packages/server/src/routes/games.ts \
  packages/server/src/routes/trading.ts packages/server/src/routes/watchlists.ts \
  packages/server/src/services/working-order.ts packages/server/src/services/pending-trade.ts \
  packages/server/src/providers/interface.ts packages/server/src/app.ts \
  packages/server/src/services/open-orders.ts \
  packages/server/tests packages/frontend/playwright.config.ts
git commit -m "feat(limits): enforce game, open-order and watchlist quotas per user

Games created per week, active games owned, games joined per day and
active games joined are counted from the source tables. The open-order
cap is now the per-user openOrders limit and covers pending rows too.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Per-user rate limits and the privileged IP layer

**Files:**
- Create: `packages/server/src/limits/rate.ts`
- Modify: `packages/server/src/plugins/rate-limit.ts` (accept `onExceeded`)
- Modify: `packages/server/src/app.ts` (pass `onExceeded`; pass `limits` to `authRoutes`)
- Modify: `packages/server/src/routes/trading.ts` (trades + both cancel routes)
- Modify: `packages/server/src/routes/games.ts` (`GET /games/by-code/:code`)
- Modify: `packages/server/src/routes/auth.ts` (four per-IP configs; factory signature)
- Modify: `packages/server/src/routes/stocks.ts` (two per-IP configs)
- Modify: `packages/server/src/routes/watchlists.ts` (two per-IP configs)
- Test: `packages/server/tests/limits/rate.test.ts`, `packages/server/tests/limits/rate-routes.test.ts`

**Interfaces:**
- Consumes: `Limits` (incl. `config`), `LimitResolver.resolve`, `subjectOf`, `ResolvedLimit`, `LimitExceededError`, `LIMIT_CATALOGUE`, `isPrivilegedConnection`, `registerUser`.
- Produces:
  ```ts
  // S/limits/rate.ts
  export type RateLimitKey = 'trades' | 'orderCancels' | 'codeLookups';
  export function rateLimitFor(limits: Limits, key: RateLimitKey): RateLimitOptions;
  export function withPrivilegedIp(config: ConfigReader, opts: { max: number; timeWindow: string | number }): RateLimitOptions;
  export function rateDenialLabel(request: FastifyRequest): string;   // LimitKey for per-user configs, `ip:<METHOD> <route>` otherwise
  // S/plugins/rate-limit.ts
  export async function registerRateLimit(app, opts?: { disabled?: boolean; onExceeded?: (request: FastifyRequest) => void }): Promise<void>;
  ```
  Factory signature after this task: `authRoutes(db, loginThrottle, limits: Limits)`. The WebSocket routes are **not** touched here: Task 12 owns their signatures (an optional trailing `wsLimits`) and wraps their per-IP upgrade configs in `withPrivilegedIp` itself.
  - Errors built by `rateLimitFor`'s `errorResponseBuilder` are marked `recorded = true`: the plugin's `onExceeded` has already seen that denial (Task 14 counts it there), so the error-handler fallback must not count it again.
  **For T14:** the `onExceeded` callback wired in `buildApp` is the single place every rate-limit denial (per-user and per-IP) passes through. Extend it there with `tracker.recordDenial` and the OTel counter.

Behaviour notes:
- `@fastify/rate-limit` allows one `config.rateLimit` per route, so `POST /games/:id/trades` swaps its old per-IP 30/min for the per-user `trades` limit. Everything else keeps its per-IP number. The global `apiRequests` ceiling (T14) still bounds any one user.
- A route-level `allowList` replaces the plugin-level `() => true` that test fixtures rely on. `rateLimitFor` therefore defines `allowList` from the resolver: when limits are disabled (fixture default, or `LIMITS_ENABLED=false`) or the caller is an admin, `max` resolves to `null` and the request is allowed. `withPrivilegedIp` defines **no** `allowList`, so the fixture's plugin-level bypass still applies to the IP layer; admin immunity there lives in `max`.
- The IP layer is not switched off by `LIMITS_ENABLED=false`. It predates this feature and is the floor under it.
- Each route gets its own store, so `orderCancels` is counted separately on the working-order and pending-order cancel routes.

- [ ] **Step 1: Write the failing unit tests**

Create `packages/server/tests/limits/rate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { withPrivilegedIp, rateDenialLabel } from '../../src/limits/rate.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import type { RequestAccount } from '../../src/limits/account.js';

function fakeRequest(ip: string, account?: RequestAccount): FastifyRequest {
  return {
    ip,
    account,
    method: 'POST',
    routeOptions: { url: '/auth/login' },
  } as unknown as FastifyRequest;
}

const member: RequestAccount = { id: 'u1', createdAt: '2020-01-01T00:00:00.000Z', isAdmin: false };
const admin: RequestAccount = { id: 'a1', createdAt: '2020-01-01T00:00:00.000Z', isAdmin: true };

describe('withPrivilegedIp', () => {
  const config = RuntimeConfig.fromEnvironment({
    LIMITS_PRIVILEGED_CIDRS: '203.0.113.0/24',
    LIMITS_PRIVILEGED_MULTIPLIER: 10,
  });
  const opts = withPrivilegedIp(config, { max: 5, timeWindow: '1 minute' });
  const max = opts.max as (req: FastifyRequest, key: string) => number;

  it('keeps the hard-coded value for an ordinary address', () => {
    expect(max(fakeRequest('198.51.100.4'), 'k')).toBe(5);
  });

  it('multiplies it for an allowlisted address', () => {
    expect(max(fakeRequest('203.0.113.9'), 'k')).toBe(50);
  });

  it('lifts it for an authenticated admin', () => {
    expect(max(fakeRequest('198.51.100.4', admin), 'k')).toBe(Number.MAX_SAFE_INTEGER);
    expect(max(fakeRequest('198.51.100.4', member), 'k')).toBe(5);
  });

  it('reads the allowlist per request, so a live change applies at once', () => {
    config.set('LIMITS_PRIVILEGED_MULTIPLIER', 2);
    expect(max(fakeRequest('203.0.113.9'), 'k')).toBe(10);
    config.clearAll();
  });

  it('keeps the original time window and adds no allowList', () => {
    expect(opts.timeWindow).toBe('1 minute');
    expect(opts.allowList).toBeUndefined();
  });
});

describe('rateDenialLabel', () => {
  it('names the route for a request no per-user limit resolved', () => {
    expect(rateDenialLabel(fakeRequest('198.51.100.4'))).toBe('ip:POST /auth/login');
  });
});
```

- [ ] **Step 2: Write the failing route tests**

Create `packages/server/tests/limits/rate-routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LimitExceededBody } from '@markettrader/shared';
import { buildApp } from '../../src/app.js';
import { createTestApp, createTestAppWithDb, createTestDb, registerAdmin } from '../helpers/app.js';
import { registerUser } from '../helpers/users.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

function lookup(app: FastifyInstance, token: string, remoteAddress?: string) {
  return app.inject({
    method: 'GET',
    url: '/games/by-code/NOSUCHCD',
    headers: { Authorization: `Bearer ${token}` },
    ...(remoteAddress ? { remoteAddress } : {}),
  });
}

describe('per-user rate limits', () => {
  let app: FastifyInstance;
  let config: RuntimeConfig;
  let seq = 0;
  const fresh = (prefix: string) => `${prefix}-${++seq}`;

  beforeAll(async () => {
    // The fixture keeps disableRateLimit: true. The per-user configs must still
    // fire, because their route-level allowList replaces the fixture bypass.
    ({ app, config } = await createTestAppWithDb(undefined, undefined, {
      limits: { disabled: false },
      runtimeConfig: RuntimeConfig.fromEnvironment({
        LIMIT_CODE_LOOKUPS_PER_MINUTE: 2,
        LIMIT_ORDER_CANCELS_PER_MINUTE: 2,
        LIMITS_PROBATION_PERCENT: 100,
      }),
    }));
  });
  afterAll(() => app.close());
  afterEach(() => {
    config.clearAll();
  });

  it('answers the request past the limit with a LimitExceededBody 429', async () => {
    const { token } = await registerUser(app, fresh('lookup'));
    expect((await lookup(app, token)).statusCode).toBe(404);
    expect((await lookup(app, token)).statusCode).toBe(404);

    const over = await lookup(app, token);
    expect(over.statusCode).toBe(429);
    const body = over.json<LimitExceededBody>();
    expect(body).toMatchObject({ code: 'LIMIT_EXCEEDED', limit: 'codeLookups', max: 2, probation: false });
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(over.headers['retry-after']).toBeDefined();
  });

  it('gives every user their own budget behind one shared IP', async () => {
    const a = await registerUser(app, fresh('shared-a'));
    const b = await registerUser(app, fresh('shared-b'));
    await lookup(app, a.token);
    await lookup(app, a.token);
    expect((await lookup(app, a.token)).statusCode).toBe(429);
    expect((await lookup(app, b.token)).statusCode).toBe(404);
  });

  it('exempts admins', async () => {
    const admin = await registerAdmin(app, fresh('rate-admin'));
    for (let i = 0; i < 5; i += 1) {
      expect((await lookup(app, admin.token)).statusCode).toBe(404);
    }
  });

  it('multiplies the budget on a privileged connection', async () => {
    config.set('LIMITS_PRIVILEGED_CIDRS', '203.0.113.0/24');
    config.set('LIMITS_PRIVILEGED_MULTIPLIER', 2);
    const { token } = await registerUser(app, fresh('office'));
    for (let i = 0; i < 4; i += 1) {
      expect((await lookup(app, token, '203.0.113.5')).statusCode).toBe(404);
    }
    const over = await lookup(app, token, '203.0.113.5');
    expect(over.statusCode).toBe(429);
    expect(over.json<LimitExceededBody>().max).toBe(4);
  });

  it('limits order cancels', async () => {
    const { token } = await registerUser(app, fresh('canceller'));
    const cancel = () =>
      app.inject({
        method: 'DELETE',
        url: '/games/no-such-game/trades/no-such-order',
        headers: { Authorization: `Bearer ${token}` },
      });
    expect((await cancel()).statusCode).toBe(404);
    expect((await cancel()).statusCode).toBe(404);
    const over = await cancel();
    expect(over.statusCode).toBe(429);
    expect(over.json<LimitExceededBody>().limit).toBe('orderCancels');
  });

  it('never fires under the default test fixture', async () => {
    const plain = await createTestApp();
    const { token } = await registerUser(plain, 'fixture-user');
    for (let i = 0; i < 30; i += 1) {
      expect((await lookup(plain, token)).statusCode).toBe(404);
    }
    await plain.close();
  });
});

describe('privileged multiplier on the per-IP layer', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      logger: false,
      db: await createTestDb(),
      provider: new MockStockProvider(),
      marketStatusProvider: new MockMarketStatusProvider(),
      disablePoller: true,
      disableRateLimit: false,
      limits: { disabled: false },
      loginThrottle: { disabled: true },
      leaderboardThrottleMs: 0,
      runtimeConfig: RuntimeConfig.fromEnvironment({
        LIMITS_PRIVILEGED_CIDRS: '203.0.113.0/24',
        LIMITS_PRIVILEGED_MULTIPLIER: 2,
      }),
    });
  });
  afterAll(() => app.close());

  const badLogin = (remoteAddress: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/login',
      remoteAddress,
      payload: { username: 'no-such-user', password: 'wrong' },
    });

  it('lets an allowlisted address make multiplier × the login attempts', async () => {
    for (let i = 0; i < 10; i += 1) {
      expect((await badLogin('203.0.113.7')).statusCode).toBe(401);
    }
    expect((await badLogin('203.0.113.7')).statusCode).toBe(429);
  });

  it('keeps the original cap for everyone else', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await badLogin('198.51.100.3')).statusCode).toBe(401);
    }
    expect((await badLogin('198.51.100.3')).statusCode).toBe(429);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/limits/rate.test.ts tests/limits/rate-routes.test.ts`
Expected: FAIL — `Cannot find module '../../src/limits/rate.js'`.

- [ ] **Step 4: Implement `rate.ts`**

Create `packages/server/src/limits/rate.ts`:

```ts
import type { FastifyRequest } from 'fastify';
import type { RateLimitOptions } from '@fastify/rate-limit';
import type { ConfigReader } from '../config/runtime-config.js';
import type { Limits } from './index.js';
import { LIMIT_CATALOGUE } from './catalogue.js';
import { isPrivilegedConnection } from './policy.js';
import { subjectOf, type ResolvedLimit } from './resolver.js';
import { LimitExceededError } from './errors.js';

/** The per-user limits enforced by `@fastify/rate-limit` rather than by a count. */
export type RateLimitKey = 'trades' | 'orderCancels' | 'codeLookups';

// The plugin calls allowList, max and errorResponseBuilder separately, and
// only the first two may be async. Resolving once and keeping the result here
// gives all three the same answer, and lets the sync error builder report the
// basis. WeakMap so a request that never reaches the builder leaks nothing.
const resolutions = new WeakMap<FastifyRequest, ResolvedLimit>();

async function resolveOnce(limits: Limits, request: FastifyRequest, key: RateLimitKey): Promise<ResolvedLimit> {
  const cached = resolutions.get(request);
  if (cached?.key === key) return cached;
  const resolved = await limits.resolver.resolve(subjectOf(request), key);
  resolutions.set(request, resolved);
  return resolved;
}

/**
 * Route `config.rateLimit` for a per-user {@link RateLimitKey}: keyed by user
 * id, sized by the resolver on every request (so overrides and live edits
 * apply at once), skipped when the resolver says unlimited, and answered with
 * a {@link LimitExceededError}. Needs `authenticate` in the route's `onRequest`,
 * which the plugin runs first.
 */
export function rateLimitFor(limits: Limits, key: RateLimitKey): RateLimitOptions {
  const windowMs = LIMIT_CATALOGUE[key].windowMs ?? 60_000;
  return {
    timeWindow: windowMs,
    keyGenerator: (request) => `u:${request.account?.id ?? `ip:${request.ip}`}`,
    allowList: async (request) => (await resolveOnce(limits, request, key)).max === null,
    max: async (request) => (await resolveOnce(limits, request, key)).max ?? Number.MAX_SAFE_INTEGER,
    errorResponseBuilder: (request, context) => {
      const resolved = resolutions.get(request) ?? {
        key,
        max: context.max,
        basis: 'base' as const,
        privileged: false,
        probation: false,
      };
      const err = new LimitExceededError({ ...resolved, max: context.max }, Math.max(1, Math.ceil(context.ttl / 1000)));
      // The plugin calls onExceeded before this builder, so the denial is
      // already counted there.
      err.recorded = true;
      return err;
    },
  };
}

/**
 * Wraps one of the original per-IP configs: the hard-coded number stands, a
 * privileged address gets it × `LIMITS_PRIVILEGED_MULTIPLIER`, and an
 * authenticated admin is unbounded. Deliberately sets no `allowList`, so the
 * test fixtures' plugin-level bypass still covers the IP layer.
 */
export function withPrivilegedIp(
  config: ConfigReader,
  opts: { max: number; timeWindow: string | number },
): RateLimitOptions {
  return {
    timeWindow: opts.timeWindow,
    max: (request) => {
      if (request.account?.isAdmin) return Number.MAX_SAFE_INTEGER;
      return isPrivilegedConnection(request.ip, config)
        ? opts.max * config.get('LIMITS_PRIVILEGED_MULTIPLIER')
        : opts.max;
    },
  };
}

/** Bounded label for a rate-limit denial: the limit key, or the route for the IP layer. */
export function rateDenialLabel(request: FastifyRequest): string {
  const resolved = resolutions.get(request);
  if (resolved) return resolved.key;
  return `ip:${request.method} ${request.routeOptions.url ?? '<unmatched>'}`;
}
```

- [ ] **Step 5: Let `registerRateLimit` take a denial callback**

Replace the body of `packages/server/src/plugins/rate-limit.ts` with:

```ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';

/**
 * Registers the rate-limit plugin. Routes opt in via `config.rateLimit`.
 *
 * When `disabled` is true, the plugin is registered with an effectively
 * infinite ceiling so per-route configs are honored but never trigger. Used
 * in tests, where shared fixtures would otherwise blow through the limits
 * (especially `/auth/register`, capped at 10/min). Per-user configs from
 * `limits/rate.ts` carry their own `allowList`, which replaces this one, so
 * they honour the separate `limits.disabled` switch instead.
 *
 * `onExceeded` runs for every denial on every route; no route overrides it.
 */
export async function registerRateLimit(
  app: FastifyInstance,
  opts: { disabled?: boolean; onExceeded?: (request: FastifyRequest) => void } = {},
): Promise<void> {
  // No keyGenerator on purpose. The default is `req.ip`, which is only as
  // trustworthy as Fastify's `trustProxy` — bounded by TRUST_PROXY (see env.ts).
  // Keying on X-Real-IP instead would be strictly weaker: that header is just as
  // client-settable whenever the app is reached without going through the proxy.
  await app.register(fastifyRateLimit, {
    global: false, // opt-in per route; avoids rate-limiting /health and future public endpoints
    // `allowList: () => true` bypasses the limiter for every request, including
    // per-route configs. Used in tests so shared-app fixtures don't hit caps
    // like /auth/register's 10/min.
    ...(opts.disabled ? { allowList: () => true } : {}),
    ...(opts.onExceeded ? { onExceeded: (request: FastifyRequest) => opts.onExceeded?.(request) } : {}),
  });
}
```

In `packages/server/src/app.ts`, add `import { rateDenialLabel } from './limits/rate.js';` and replace `await registerRateLimit(app, { disabled: disableRateLimit });` with:

```ts
  await registerRateLimit(app, {
    disabled: disableRateLimit,
    // Info, not warn: warn ships to PostHog, which bills by volume, and a
    // script hammering a limit would turn into a bill.
    onExceeded: (request) => {
      request.log.info(
        { limit: rateDenialLabel(request), ip: request.ip, userId: request.account?.id },
        'rate limit exceeded',
      );
    },
  });
```

- [ ] **Step 6: Apply the per-user configs**

`packages/server/src/routes/trading.ts` — add `import { rateLimitFor } from '../limits/rate.js';`, then:

```ts
        onRequest: rawApp.authenticate,
        config: { rateLimit: rateLimitFor(limits, 'trades') },
```

in `POST /games/:id/trades` (replacing `config: { rateLimit: { max: 30, timeWindow: '1 minute' } },`), and add `config: { rateLimit: rateLimitFor(limits, 'orderCancels') },` directly after `onRequest: rawApp.authenticate,` in both `DELETE /games/:id/trades/:tradeId` and `DELETE /games/:id/trades/pending/:pendingId`.

`packages/server/src/routes/games.ts` — add `import { rateLimitFor } from '../limits/rate.js';`, and in `GET /games/by-code/:code` add after `onRequest: rawApp.authenticate,`:

```ts
      // Invite codes are the only secret on a private game; this bounds how
      // fast one account can guess at them.
      config: { rateLimit: rateLimitFor(limits, 'codeLookups') },
```

- [ ] **Step 7: Wrap every remaining per-IP config**

`packages/server/src/routes/auth.ts`:

```ts
import type { Limits } from '../limits/index.js';
import { withPrivilegedIp } from '../limits/rate.js';
```

Signature: `export function authRoutes(db: Db, loginThrottle: FailedLoginTracker, limits: Limits) {`, and add a sentence to the JSDoc paragraph on rate limits: `Per-IP caps are multiplied for privileged addresses via {@link withPrivilegedIp}.` Then, inside the returned function after `const { users } = schema;`:

```ts
    const perIp = (max: number) => ({ rateLimit: withPrivilegedIp(limits.config, { max, timeWindow: '1 minute' }) });
```

and replace the four configs:

| route | old | new |
|---|---|---|
| `/auth/register` | `config: { rateLimit: { max: 10, timeWindow: '1 minute' } },` | `config: perIp(10),` |
| `/auth/login` | `config: { rateLimit: { max: 5, timeWindow: '1 minute' } },` | `config: perIp(5),` |
| `/auth/logout` | `config: { rateLimit: { max: 20, timeWindow: '1 minute' } },` | `config: perIp(20),` |
| `/auth/refresh` | `config: { rateLimit: { max: 20, timeWindow: '1 minute' } },` | `config: perIp(20),` |

`packages/server/src/routes/stocks.ts` — add `import { withPrivilegedIp } from '../limits/rate.js';` and replace the two constants:

```ts
    const searchRateLimit = { rateLimit: withPrivilegedIp(config, { max: 30, timeWindow: '1 minute' }) };
    const lookupRateLimit = { rateLimit: withPrivilegedIp(config, { max: 120, timeWindow: '1 minute' }) };
```

`packages/server/src/routes/watchlists.ts` — add `import { withPrivilegedIp } from '../limits/rate.js';` and replace:

```ts
        config: { rateLimit: withPrivilegedIp(limits.config, { max: 60, timeWindow: '1 minute' }) },
```

(`POST /watchlists/:id/items`) and

```ts
        config: { rateLimit: withPrivilegedIp(limits.config, { max: 120, timeWindow: '1 minute' }) },
```

(`PATCH /watchlists/:id/items/:symbol`).

`packages/server/src/app.ts`:

```ts
  await app.register(authRoutes(db, new FailedLoginTracker(runtimeConfig, loginThrottle), limits));
```

Leave `ws/live-route.ts`, `ws/global-live-route.ts` and their `app.ts` registrations alone — Task 12 wraps their upgrade configs.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/limits tests/routes/rate-limit-proxy.test.ts tests/auth.test.ts tests/routes/stocks.test.ts tests/security tests/ws`
Expected: PASS. `rate-limit-proxy.test.ts` must still see `[401, 401, 401, 401, 401, 429]`; the IP layer's numbers did not change.

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/limits/rate.ts packages/server/src/plugins/rate-limit.ts packages/server/src/app.ts \
  packages/server/src/routes packages/server/tests
git commit -m "feat(limits): per-user rate limits and privileged multiplier on the IP layer

Trades, order cancels and invite-code lookups are rate limited per user
through the resolver; the existing per-IP caps keep their numbers but
scale for privileged addresses and skip admins. Every rate-limit denial
is now logged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Registration IP and the per-IP daily registration cap

**Files:**
- Modify: `packages/server/src/routes/auth.ts` (`POST /auth/register`)
- Test: `packages/server/tests/limits/registration.test.ts`

**Interfaces:**
- Consumes: `users.registrationIp` column (T7), `registerUser(app, username, { remoteAddress })` (T7), `LimitEnforcer.enforceFor`, `secondsUntilWindowFrees` (T8), `countRegistrationsSince`, `oldestRegistrationSince`, `windowStart` (T9), `authRoutes(db, loginThrottle, limits)` (T10).
- Produces: every new `users` row carries `registration_ip = request.ip`. T16 reads it for sibling accounts.

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/limits/registration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { LimitExceededBody } from '@markettrader/shared';
import { createTestAppWithDb } from '../helpers/app.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { schema } from '../../src/db/index.js';

type Db = Awaited<ReturnType<typeof createTestAppWithDb>>['db'];

describe('registrations per IP per day', () => {
  let app: FastifyInstance;
  let db: Db;
  let config: RuntimeConfig;
  let seq = 0;

  const register = (remoteAddress: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/register',
      remoteAddress,
      payload: { username: `reg-${++seq}`, password: 'password123' },
    });

  beforeAll(async () => {
    ({ app, db, config } = await createTestAppWithDb(undefined, undefined, {
      limits: { disabled: false },
      runtimeConfig: RuntimeConfig.fromEnvironment({ LIMIT_REGISTRATIONS_PER_IP_PER_DAY: 2 }),
    }));
  });
  afterAll(() => app.close());
  afterEach(() => {
    config.clearAll();
  });

  it('stores the address the account registered from', async () => {
    const res = await register('198.51.100.10');
    expect(res.statusCode).toBe(201);
    const id = res.json<{ user: { id: string } }>().user.id;
    const [row] = await db
      .select({ ip: schema.users.registrationIp })
      .from(schema.users)
      .where(eq(schema.users.id, id));
    expect(row?.ip).toBe('198.51.100.10');
  });

  it('refuses the registration past the cap with a 429 and Retry-After', async () => {
    expect((await register('198.51.100.20')).statusCode).toBe(201);
    expect((await register('198.51.100.20')).statusCode).toBe(201);

    const over = await register('198.51.100.20');
    expect(over.statusCode).toBe(429);
    const body = over.json<LimitExceededBody>();
    expect(body).toMatchObject({ code: 'LIMIT_EXCEEDED', limit: 'registrationsPerIp', max: 2, probation: false });
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(86_400);
  });

  it('counts each address separately', async () => {
    await register('198.51.100.30');
    await register('198.51.100.30');
    expect((await register('198.51.100.31')).statusCode).toBe(201);
  });

  it('forgets registrations older than 24 hours', async () => {
    await register('198.51.100.40');
    await register('198.51.100.40');
    expect((await register('198.51.100.40')).statusCode).toBe(429);

    await db
      .update(schema.users)
      .set({ createdAt: '2000-01-01 00:00:00' })
      .where(eq(schema.users.registrationIp, '198.51.100.40'));

    expect((await register('198.51.100.40')).statusCode).toBe(201);
  });

  it('multiplies the cap for a privileged address', async () => {
    config.set('LIMITS_PRIVILEGED_CIDRS', '203.0.113.0/24');
    config.set('LIMITS_PRIVILEGED_MULTIPLIER', 3);
    for (let i = 0; i < 6; i += 1) {
      expect((await register('203.0.113.50')).statusCode).toBe(201);
    }
    expect((await register('203.0.113.50')).statusCode).toBe(429);
  });

  it('is lifted by LIMITS_ENABLED=false', async () => {
    config.set('LIMITS_ENABLED', false);
    for (let i = 0; i < 4; i += 1) {
      expect((await register('198.51.100.60')).statusCode).toBe(201);
    }
  });

  it('is checked before the username is claimed', async () => {
    await register('198.51.100.70');
    await register('198.51.100.70');
    const over = await app.inject({
      method: 'POST',
      url: '/auth/register',
      remoteAddress: '198.51.100.70',
      payload: { username: 'never-created', password: 'password123' },
    });
    expect(over.statusCode).toBe(429);
    const [row] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, 'never-created'));
    expect(row).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/limits/registration.test.ts`
Expected: FAIL — the stored IP is `null`, and the third registration from one address returns 201.

- [ ] **Step 3: Enforce and record in `POST /auth/register`**

In `packages/server/src/routes/auth.ts`, add:

```ts
import { LIMIT_CATALOGUE } from '../limits/catalogue.js';
import {
  countRegistrationsSince,
  oldestRegistrationSince,
  windowStart,
} from '../limits/quota-counts.js';
import { secondsUntilWindowFrees } from '../limits/enforce.js';
```

Replace the start of the register handler:

```ts
    }, async (request, reply) => {
      const { username, password } = request.body;

      const passwordHash = await hash(password);
```

with:

```ts
    }, async (request, reply) => {
      const { username, password } = request.body;
      const ip = request.ip;

      // Before hashing: argon2 is the expensive step, and a refused address
      // should not get to spend it. Counted from `users.registration_ip`, so a
      // restart does not hand out a fresh day.
      const now = Date.now();
      const since = windowStart('registrationsPerIp', now);
      await limits.enforcer.enforceFor(
        { ip },
        'registrationsPerIp',
        () => countRegistrationsSince(db, ip, since),
        {
          retryAfter: async () =>
            secondsUntilWindowFrees(
              await oldestRegistrationSince(db, ip, since),
              LIMIT_CATALOGUE.registrationsPerIp.windowMs!,
              now,
            ),
        },
      );

      const passwordHash = await hash(password);
```

and change the insert to:

```ts
        [user] = await db
          .insert(users)
          .values({ username, passwordHash, registrationIp: ip })
          .returning({ id: users.id, username: users.username });
```

Extend the route list in the `authRoutes` JSDoc: `` - `POST /auth/register` — … also refused once an address has registered `LIMIT_REGISTRATIONS_PER_IP_PER_DAY` accounts in 24 h.``

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/limits/registration.test.ts tests/auth.test.ts tests/admin`
Expected: PASS.

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/auth.ts packages/server/tests/limits/registration.test.ts
git commit -m "feat(limits): record registration IP and cap registrations per IP per day

The count comes from users.registration_ip, so it survives a restart, and
is checked before the argon2 hash so a refused address costs nothing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 12: WebSocket limits — connections per user, subscribe rate, close code 4429

Two limits on the live sockets:
- **`wsConnections`** is checked at upgrade, across both registries. A socket over the cap is closed with the new `4429` code.
- **`wsSubscribes`** is counted per user, across all of their sockets. An over-limit `subscribe` is dropped: the previous subscription stays, and the server answers with an error frame.

The frontend treats `4429` as an ordinary backoff case. `isStaleCredentialClose` already returns false for every code except 1008, so this task only pins that behaviour. It also debounces subscribe sends to 250 ms, so honest clients never come near the cap.

Also adds `SlidingWindowCounter`, which Task 14 reuses for the global request ceiling.

**Files:**
- Create: `packages/server/src/limits/sliding-window.ts`
- Create: `packages/server/src/ws/limits.ts`
- Modify: `packages/server/src/ws/close-codes.ts`
- Modify: `packages/server/src/ws/registry.ts` (add `countForUser`)
- Modify: `packages/server/src/ws/global-registry.ts` (add `countForUser`)
- Modify: `packages/server/src/ws/live-route.ts`
- Modify: `packages/server/src/ws/global-live-route.ts`
- Modify: `packages/server/src/app.ts` (WS route registration)
- Modify: `packages/shared/src/types/websocket.ts` (add `WsErrorEvent`)
- Modify: `packages/frontend/src/lib/wsAuth.ts`
- Modify: `packages/frontend/src/hooks/useGameSocket.ts`
- Test: `packages/server/tests/limits/sliding-window.test.ts`
- Test: `packages/server/tests/ws/close-codes.test.ts`
- Test: `packages/server/tests/ws/registry.test.ts`
- Test: `packages/server/tests/ws/global-registry.test.ts`
- Test: `packages/server/tests/ws/ws-limits.test.ts`
- Test: `packages/frontend/tests/lib/wsAuth.test.ts`
- Test: `packages/frontend/tests/useGameSocket.test.tsx`

**Interfaces:**
- Consumes:
  - from T7: `loadAccount(db, userId)`. After T7, both upgrade handlers read `const account = await loadAccount(db, payload.id)`, and `account` is `RequestAccount & { disabled: boolean }`.
  - from T8: `Limits` and `createLimits`, `LimitEnforcer.enforceFor(subject, key, count, opts?)`, `LimitExceededError`, `LimitSubject`.
  - from T10: `withPrivilegedIp(config, { max, timeWindow })`.
  - from T6: `LIMIT_CATALOGUE`, `LimitKey`.
- Produces:
  - `SlidingWindowCounter` (`new SlidingWindowCounter(windowMs, now?)`, `.hit(key): number`, `.peek(key): number`, `.prune()`, `.size`). Reused by T14.
  - `WS_LIMIT_EXCEEDED_CLOSE_CODE = 4429` on both server and frontend.
  - `WsLimitDeps { limits: Limits; config: ConfigReader; countUserSockets(userId): number }`.
  - New route signatures: `liveRoute(db, registry, engine, revalidateIntervalMs?, wsLimits?)` and `globalLiveRoute(db, registry, revalidateIntervalMs?, wsLimits?)`. `wsLimits` is optional, so existing direct callers in tests keep working unchanged.
  - `GameClientRegistry.countForUser(userId)` and `GlobalClientRegistry.countForUser(userId)`.
  - `WsErrorEvent` in shared.

- [ ] **Step 1: Write the failing sliding-window test**

`packages/server/tests/limits/sliding-window.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SlidingWindowCounter } from '../../src/limits/sliding-window.js';

describe('SlidingWindowCounter', () => {
  function clock(start = 0) {
    let t = start;
    return { now: () => t, set: (v: number) => { t = v; } };
  }

  it('counts hits inside the window', () => {
    const c = clock();
    const counter = new SlidingWindowCounter(60_000, c.now);
    expect(counter.hit('u1')).toBe(1);
    expect(counter.hit('u1')).toBe(2);
    expect(counter.hit('u1')).toBe(3);
    expect(counter.peek('u1')).toBe(3);
    expect(counter.peek('u2')).toBe(0);
  });

  it('keeps counts separate per key', () => {
    const c = clock();
    const counter = new SlidingWindowCounter(60_000, c.now);
    counter.hit('a');
    counter.hit('a');
    counter.hit('b');
    expect(counter.peek('a')).toBe(2);
    expect(counter.peek('b')).toBe(1);
  });

  it('decays the oldest half-window linearly and forgets it after a full window', () => {
    const c = clock();
    const counter = new SlidingWindowCounter(60_000, c.now);
    counter.hit('u');
    counter.hit('u');
    counter.hit('u'); // bucket 0: 3
    c.set(30_000);
    expect(counter.hit('u')).toBe(4); // bucket 1: 1, bucket 0 still fully inside
    c.set(60_000);
    expect(counter.peek('u')).toBe(4); // bucket 0 is now the oldest, weight 1
    c.set(75_000);
    expect(counter.peek('u')).toBe(2.5); // 1 + 3 × 0.5
    c.set(90_000);
    expect(counter.peek('u')).toBe(1); // bucket 0 gone, bucket 1 is the oldest
    c.set(200_000);
    expect(counter.peek('u')).toBe(0);
  });

  it('prunes keys idle for more than a window', () => {
    const c = clock();
    const counter = new SlidingWindowCounter(60_000, c.now);
    counter.hit('stale');
    c.set(120_000);
    counter.hit('fresh');
    counter.prune();
    expect(counter.size).toBe(1);
    expect(counter.peek('fresh')).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/limits/sliding-window.test.ts`
Expected: FAIL, `Cannot find module '../../src/limits/sliding-window.js'`

- [ ] **Step 3: Implement `SlidingWindowCounter`**

`packages/server/src/limits/sliding-window.ts`:

```ts
/** How many hits pass between opportunistic prunes of idle keys. */
const PRUNE_EVERY = 1_000;

interface Entry {
  bucket: number;
  /** Newest first: current half-window, previous one, the one before that. */
  counts: [number, number, number];
}

/**
 * Approximate per-key sliding-window counter with O(1) memory per key.
 *
 * Hits land in half-window buckets. The window total is the current and previous
 * bucket plus the oldest bucket weighted by how much of it still overlaps the
 * window — accurate to within one bucket's skew, and immune to the burst-at-the-
 * boundary doubling a single fixed window allows.
 */
export class SlidingWindowCounter {
  private readonly entries = new Map<string, Entry>();
  private readonly half: number;
  private hitsSincePrune = 0;

  constructor(
    windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.half = windowMs / 2;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Records one hit for `key` and returns the window total including it. */
  hit(key: string): number {
    const entry = this.roll(key) ?? this.create(key);
    entry.counts[0] += 1;
    if (++this.hitsSincePrune >= PRUNE_EVERY) this.prune();
    return this.total(entry);
  }

  /** The window total for `key` without recording a hit. */
  peek(key: string): number {
    const entry = this.roll(key);
    return entry ? this.total(entry) : 0;
  }

  /** Drops keys whose newest hit has left the window entirely. */
  prune(): void {
    this.hitsSincePrune = 0;
    const bucket = this.bucketNow();
    for (const [key, entry] of this.entries) {
      if (bucket - entry.bucket > 2) this.entries.delete(key);
    }
  }

  private bucketNow(): number {
    return Math.floor(this.now() / this.half);
  }

  private create(key: string): Entry {
    const entry: Entry = { bucket: this.bucketNow(), counts: [0, 0, 0] };
    this.entries.set(key, entry);
    return entry;
  }

  private roll(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const bucket = this.bucketNow();
    const shift = bucket - entry.bucket;
    if (shift > 0) {
      const [c0, c1] = entry.counts;
      entry.counts = shift === 1 ? [0, c0, c1] : shift === 2 ? [0, 0, c0] : [0, 0, 0];
      entry.bucket = bucket;
    }
    return entry;
  }

  private total(entry: Entry): number {
    const into = (this.now() % this.half) / this.half;
    return entry.counts[0] + entry.counts[1] + entry.counts[2] * (1 - into);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter server exec vitest run tests/limits/sliding-window.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing close-code and registry tests**

Append to the `describe('WebSocket close codes', …)` block in `packages/server/tests/ws/close-codes.test.ts`, and add `WS_LIMIT_EXCEEDED_CLOSE_CODE` to its import:

```ts
  it('pins the limit-exceeded close code', () => {
    expect(WS_LIMIT_EXCEEDED_CLOSE_CODE).toBe(4429);
  });

  it('keeps the three codes disjoint', () => {
    expect(new Set([WS_POLICY_CLOSE_CODE, WS_INVALID_FRAME_CLOSE_CODE, WS_LIMIT_EXCEEDED_CLOSE_CODE]).size).toBe(3);
  });

  it('keeps the limit code inside the private range ws will send', () => {
    expect(WS_LIMIT_EXCEEDED_CLOSE_CODE).toBeGreaterThanOrEqual(3000);
    expect(WS_LIMIT_EXCEEDED_CLOSE_CODE).toBeLessThanOrEqual(4999);
  });
```

Append inside `describe('GameClientRegistry', …)` in `packages/server/tests/ws/registry.test.ts`:

```ts
  it('counts a user’s sockets across every game', () => {
    registry.add('game-1', 'user-1', makeMockSocket());
    registry.add('game-2', 'user-1', makeMockSocket());
    registry.add('game-1', 'user-2', makeMockSocket());
    expect(registry.countForUser('user-1')).toBe(2);
    expect(registry.countForUser('user-2')).toBe(1);
    expect(registry.countForUser('nobody')).toBe(0);
  });
```

Append inside `describe('GlobalClientRegistry', …)` in `packages/server/tests/ws/global-registry.test.ts`:

```ts
  it('counts a user’s sockets', () => {
    const a = { readyState: 1, send: () => {} } as unknown as WebSocket;
    const b = { readyState: 1, send: () => {} } as unknown as WebSocket;
    const c = { readyState: 1, send: () => {} } as unknown as WebSocket;
    registry.add('u1', a);
    registry.add('u1', b);
    registry.add('u2', c);
    expect(registry.countForUser('u1')).toBe(2);
    expect(registry.countForUser('u3')).toBe(0);
  });
```

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm --filter server exec vitest run tests/ws/close-codes.test.ts tests/ws/registry.test.ts tests/ws/global-registry.test.ts`
Expected: FAIL. The close-code import is undefined (`expected undefined to be 4429`), and `registry.countForUser is not a function`.

- [ ] **Step 7: Add the close code and the counting methods**

Append to `packages/server/src/ws/close-codes.ts`:

```ts
/**
 * Close code for a connection refused because the account already holds its
 * maximum number of live sockets (`wsConnections`).
 *
 * Disjoint from {@link WS_POLICY_CLOSE_CODE} on purpose: the credential is fine,
 * so the client must back off rather than spend a refresh. Mirrored in
 * `packages/frontend/src/lib/wsAuth.ts`.
 */
export const WS_LIMIT_EXCEEDED_CLOSE_CODE = 4429;
```

In `packages/server/src/ws/registry.ts`, add after `getActiveGameIds()`:

```ts
  /** Live sockets `userId` holds across every game — read by the `wsConnections` limit. */
  countForUser(userId: string): number {
    let count = 0;
    for (const clients of this.games.values()) {
      for (const entry of clients.values()) if (entry.playerId === userId) count += 1;
    }
    return count;
  }
```

In `packages/server/src/ws/global-registry.ts`, add after the `size` getter:

```ts
  /** Live `/ws/live` sockets `userId` holds — read by the `wsConnections` limit. */
  countForUser(userId: string): number {
    let count = 0;
    for (const entry of this.clients.values()) if (entry.userId === userId) count += 1;
    return count;
  }
```

- [ ] **Step 8: Run them to verify they pass**

Run: `pnpm --filter server exec vitest run tests/ws/close-codes.test.ts tests/ws/registry.test.ts tests/ws/global-registry.test.ts`
Expected: PASS

- [ ] **Step 9: Add the shared error event**

In `packages/shared/src/types/websocket.ts`, add at the top: `import type { LimitKey } from './limits.js';`. Then add this before `/** Union of all event shapes the server can push to a connected client. */`:

```ts
/**
 * Sent to one socket when the server refuses a client frame for exceeding a
 * limit. The refused frame has no effect — the previous subscription stays.
 */
export interface WsErrorEvent {
  event: 'error';
  data: { code: 'LIMIT_EXCEEDED'; limit: LimitKey };
}
```

and add `| WsErrorEvent` as the last member of the `WsServerEvent` union.

Run: `pnpm build:shared`
Expected: exits 0

- [ ] **Step 10: Write the failing WS limits integration test**

`packages/server/tests/ws/ws-limits.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type { AddressInfo } from 'net';
import { buildApp } from '../../src/app.js';
import { createTestDb, registerAdmin } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';
import { registerWebsocket } from '../../src/plugins/websocket.js';
import { registerJwt } from '../../src/plugins/jwt.js';
import { GameClientRegistry } from '../../src/ws/registry.js';
import { GlobalClientRegistry } from '../../src/ws/global-registry.js';
import { liveRoute } from '../../src/ws/live-route.js';
import { globalLiveRoute } from '../../src/ws/global-live-route.js';
import { AchievementEngine } from '../../src/achievements/engine.js';
import { EventBus } from '../../src/events/bus.js';
import { SystemSettingsService } from '../../src/services/system-settings.js';
import { WS_AUTH_SUBPROTOCOL } from '../../src/ws/subprotocol.js';
import { WS_LIMIT_EXCEEDED_CLOSE_CODE } from '../../src/ws/close-codes.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { createLimits } from '../../src/limits/index.js';
import type { Db } from '../../src/db/index.js';

function waitForOpen(ws: WebSocket, ms = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS open timeout')), ms);
    ws.once('open', () => { clearTimeout(t); resolve(); });
    ws.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function waitForClose(ws: WebSocket, ms = 2000): Promise<number> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS close timeout')), ms);
    ws.once('close', (code) => { clearTimeout(t); resolve(code); });
  });
}

function waitForEvent(ws: WebSocket, eventName: string, ms = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${eventName}`)), ms);
    const handler = (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as { event: string };
      if (msg.event === eventName) {
        clearTimeout(t);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('WebSocket limits', () => {
  let restApp: FastifyInstance;
  let wsApp: FastifyInstance;
  let db: Db;
  let registry: GameClientRegistry;
  let globalRegistry: GlobalClientRegistry;
  let port: number;

  beforeAll(async () => {
    db = await createTestDb();
    // Mints fixtures over the real routes with limits off; never listens.
    restApp = await buildApp({
      logger: false,
      db,
      provider: new MockStockProvider(),
      marketStatusProvider: new MockMarketStatusProvider(),
      disablePoller: true,
      disableRateLimit: true,
      leaderboardThrottleMs: 0,
      limits: { disabled: true },
    });

    const config = RuntimeConfig.fromEnvironment({
      LIMIT_WS_CONNECTIONS_PER_USER: 2,
      LIMIT_WS_SUBSCRIBES_PER_MINUTE: 2,
      LIMITS_PROBATION_PERCENT: 100,
    });
    const limits = createLimits({ db, config });

    wsApp = Fastify({ logger: false });
    await registerWebsocket(wsApp);
    await registerJwt(wsApp, db);
    registry = new GameClientRegistry();
    globalRegistry = new GlobalClientRegistry();
    const engine = new AchievementEngine(db, new EventBus(), registry, new SystemSettingsService(db), []);
    const wsLimits = {
      limits,
      config,
      countUserSockets: (userId: string) =>
        registry.countForUser(userId) + globalRegistry.countForUser(userId),
    };
    await wsApp.register(liveRoute(db, registry, engine, 3_600_000, wsLimits));
    await wsApp.register(globalLiveRoute(db, globalRegistry, 3_600_000, wsLimits));
    await wsApp.listen({ port: 0, host: '127.0.0.1' });
    port = (wsApp.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await wsApp.close();
    await restApp.close();
  });

  async function makePlayer(username: string, asAdmin = false) {
    let token: string;
    let userId: string;
    if (asAdmin) {
      ({ token, userId } = await registerAdmin(restApp, username));
    } else {
      const res = await restApp.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username, password: 'password123' },
      });
      const body = res.json<{ token: string; user: { id: string } }>();
      token = body.token;
      userId = body.user.id;
    }
    const created = await restApp.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        name: `Limits ${username}`,
        // Relative dates: GAME_MAX_DURATION_DAYS (T1) rejects spans over a year.
        startDate: new Date(Date.now() - 86_400_000).toISOString(),
        endDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        startingBalance: 10000,
      },
    });
    const { id: gameId } = created.json<{ id: string }>();
    return { token, userId, gameId };
  }

  const gameSocket = (gameId: string, token: string) =>
    new WebSocket(`ws://127.0.0.1:${port}/games/${gameId}/live`, [WS_AUTH_SUBPROTOCOL, token]);
  const globalSocket = (token: string) =>
    new WebSocket(`ws://127.0.0.1:${port}/ws/live`, [WS_AUTH_SUBPROTOCOL, token]);

  it('refuses a connection past the per-user cap with 4429, counting both routes', async () => {
    const p = await makePlayer('ws-cap');
    const a = gameSocket(p.gameId, p.token);
    await waitForOpen(a);
    const b = globalSocket(p.token);
    await waitForOpen(b);

    const c = gameSocket(p.gameId, p.token);
    expect(await waitForClose(c)).toBe(WS_LIMIT_EXCEEDED_CLOSE_CODE);
    const d = globalSocket(p.token);
    expect(await waitForClose(d)).toBe(WS_LIMIT_EXCEEDED_CLOSE_CODE);

    // A freed slot is usable again.
    a.close();
    await waitForClose(a);
    await new Promise((r) => setTimeout(r, 20));
    const e = gameSocket(p.gameId, p.token);
    await waitForOpen(e);
    e.close();
    b.close();
    await Promise.all([waitForClose(e), waitForClose(b)]);
  });

  it('never caps an admin', async () => {
    const p = await makePlayer('ws-cap-admin', true);
    const sockets = [gameSocket(p.gameId, p.token), gameSocket(p.gameId, p.token), globalSocket(p.token)];
    await Promise.all(sockets.map((s) => waitForOpen(s)));
    for (const s of sockets) s.close();
    await Promise.all(sockets.map((s) => waitForClose(s)));
  });

  it('drops an over-limit subscribe, answers with an error frame, and keeps the previous set', async () => {
    const p = await makePlayer('ws-subscribe');
    const ws = gameSocket(p.gameId, p.token);
    await waitForOpen(ws);

    ws.send(JSON.stringify({ event: 'subscribe', data: { symbols: ['AAPL'] } }));
    ws.send(JSON.stringify({ event: 'subscribe', data: { symbols: ['MSFT'] } }));
    const error = waitForEvent(ws, 'error');
    ws.send(JSON.stringify({ event: 'subscribe', data: { symbols: ['TSLA'] } }));

    expect(await error).toEqual({ event: 'error', data: { code: 'LIMIT_EXCEEDED', limit: 'wsSubscribes' } });
    const [entry] = [...registry.getClients(p.gameId).values()];
    expect([...entry!.subscriptions]).toEqual(['MSFT']);
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
    await waitForClose(ws);
  });
});
```

- [ ] **Step 11: Run it to verify it fails**

Run: `pnpm --filter server exec vitest run tests/ws/ws-limits.test.ts`
Expected: FAIL. The third socket opens instead of closing (`WS close timeout`), and the subscribe test times out waiting for `error`.

- [ ] **Step 12: Implement the admission helpers**

`packages/server/src/ws/limits.ts`:

```ts
import type { ConfigReader } from '../config/runtime-config.js';
import type { Limits } from '../limits/index.js';
import type { LimitSubject } from '../limits/resolver.js';
import type { RequestAccount } from '../limits/account.js';
import { LimitExceededError } from '../limits/errors.js';
import type { SlidingWindowCounter } from '../limits/sliding-window.js';

/**
 * What the socket routes need to enforce per-user limits. Optional on both
 * route factories so tests that mount a bare route keep their exact query
 * sequence (see `live-route-connect-window.test.ts`).
 */
export interface WsLimitDeps {
  limits: Limits;
  config: ConfigReader;
  /** Live sockets the user holds across both registries. */
  countUserSockets: (userId: string) => number;
}

/** A WS subject always has an account — sockets authenticate before any limit runs. */
export type WsSubject = LimitSubject & { account: RequestAccount };

async function admitted(check: () => Promise<void>): Promise<boolean> {
  try {
    await check();
    return true;
  } catch (err) {
    if (err instanceof LimitExceededError) return false;
    throw err;
  }
}

/** False when opening one more socket would exceed the user's `wsConnections` limit. */
export function admitConnection(deps: WsLimitDeps, subject: WsSubject): Promise<boolean> {
  return admitted(() =>
    deps.limits.enforcer.enforceFor(subject, 'wsConnections', async () =>
      deps.countUserSockets(subject.account.id),
    ),
  );
}

/**
 * Counts one `subscribe` against the user's `wsSubscribes` window and reports
 * whether it may be applied. The hit is recorded even when refused, so a client
 * that keeps hammering stays refused.
 */
export function admitSubscribe(
  deps: WsLimitDeps,
  counter: SlidingWindowCounter,
  subject: WsSubject,
): Promise<boolean> {
  const afterHit = counter.hit(subject.account.id);
  return admitted(() =>
    deps.limits.enforcer.enforceFor(subject, 'wsSubscribes', async () => afterHit - 1),
  );
}
```

- [ ] **Step 13: Wire limits into `/games/:id/live`**

In `packages/server/src/ws/live-route.ts`:

1. Imports. Change the close-codes import to `import { WS_INVALID_FRAME_CLOSE_CODE, WS_LIMIT_EXCEEDED_CLOSE_CODE, WS_POLICY_CLOSE_CODE } from './close-codes.js';` and add:

```ts
import { withPrivilegedIp } from '../limits/rate.js';
import { LIMIT_CATALOGUE } from '../limits/catalogue.js';
import { SlidingWindowCounter } from '../limits/sliding-window.js';
import { admitConnection, admitSubscribe, type WsLimitDeps, type WsSubject } from './limits.js';
```

2. Replace the `@param revalidateIntervalMs` doc line and the signature with:

```ts
 * @param revalidateIntervalMs - Overrides `WS_REVALIDATE_INTERVAL_MS`; tests
 *   pass a small value to observe a sweep without waiting.
 * @param wsLimits - Per-user socket limits (`wsConnections`, `wsSubscribes`).
 *   Omitted only by tests that mount the bare route.
 */
export function liveRoute(
  db: Db,
  registry: GameClientRegistry,
  engine: AchievementEngine,
  revalidateIntervalMs: number = env.WS_REVALIDATE_INTERVAL_MS,
  wsLimits?: WsLimitDeps,
) {
```

3. Directly after `const expiryOf = new WeakMap<WebSocket, number>();`, add:

```ts
    // One window per app instance, keyed by user, so a client cannot reset its
    // budget by reconnecting.
    const subscribeCounter = new SlidingWindowCounter(LIMIT_CATALOGUE.wsSubscribes.windowMs);
```

4. Replace the route options object:

```ts
      {
        websocket: true,
        config: {
          rateLimit: wsLimits
            ? withPrivilegedIp(wsLimits.config, { max: 10, timeWindow: '1 minute' })
            : { max: 10, timeWindow: '1 minute' },
          otel: false,
        },
      },
```

5. Directly after the membership check block (the `if (!membership) { … return; }` ending at "Not a game member"), insert:

```ts
        const subject: WsSubject = { account, ip: request.ip };
        // Before registering, so a refused socket never enters the registry and
        // never counts against its own admission.
        if (wsLimits && !(await admitConnection(wsLimits, subject))) {
          closeSocket(socket, WS_LIMIT_EXCEEDED_CLOSE_CODE, 'Connection limit reached');
          return;
        }
```

6. Replace the entire `socket.on('message', (raw: Buffer) => { … });` block with:

```ts
        const applySubscribe = async (raw: Buffer): Promise<void> => {
          let symbols: string[];
          try {
            const parsed = clientFrameSchema.safeParse(JSON.parse(raw.toString()));
            if (!parsed.success) {
              closeSocket(socket, WS_INVALID_FRAME_CLOSE_CODE, 'Invalid frame');
              return;
            }
            symbols = parsed.data.data.symbols;
          } catch {
            // Unparseable JSON. Same disposition as a schema failure — no
            // legitimate client sends one, and answering nothing lets a peer
            // keep probing for free.
            closeSocket(socket, WS_INVALID_FRAME_CLOSE_CODE, 'Invalid frame');
            return;
          }

          // Dropped rather than closed: a close hands the client a fresh socket
          // whose first act is to re-subscribe, which throttles nothing.
          if (wsLimits && !(await admitSubscribe(wsLimits, subscribeCounter, subject))) {
            registry.sendToSocket(socket, {
              event: 'error',
              data: { code: 'LIMIT_EXCEEDED', limit: 'wsSubscribes' },
            });
            return;
          }

          const entry = registry.getEntry(gameId, socket);
          if (!entry) return;
          // Replace, not append: the client sends the full active set on
          // every change, and additive merging would broadcast forever
          // to symbols the user has dropped (e.g. when switching lists).
          entry.subscriptions.clear();
          for (const symbol of symbols) entry.subscriptions.add(symbol.toUpperCase());
        };

        // Chained so frames apply in arrival order even though admission awaits.
        let frames: Promise<void> = Promise.resolve();
        socket.on('message', (raw: Buffer) => {
          frames = frames.then(() => applySubscribe(raw)).catch((err: unknown) => {
            app.log.error({ err, gameId }, 'ws subscribe handling failed');
          });
        });
```

Keep the existing comment above the listener ("Attached before the replay `await` below…") directly above `const applySubscribe`.

- [ ] **Step 14: Wire `wsConnections` into `/ws/live`**

In `packages/server/src/ws/global-live-route.ts`:

1. Add imports:

```ts
import { WS_LIMIT_EXCEEDED_CLOSE_CODE } from './close-codes.js';
import { withPrivilegedIp } from '../limits/rate.js';
import { admitConnection, type WsLimitDeps } from './limits.js';
```

(If the file already imports `WS_POLICY_CLOSE_CODE` from `./close-codes.js`, add `WS_LIMIT_EXCEEDED_CLOSE_CODE` to that import instead.)

2. Change the signature and its doc:

```ts
 * @param revalidateIntervalMs - Overrides `WS_REVALIDATE_INTERVAL_MS`; tests
 *   pass a small value to observe a sweep without waiting.
 * @param wsLimits - Per-user socket limits; omitted only by tests that mount the bare route.
 */
export function globalLiveRoute(
  db: Db,
  registry: GlobalClientRegistry,
  revalidateIntervalMs: number = env.WS_REVALIDATE_INTERVAL_MS,
  wsLimits?: WsLimitDeps,
) {
```

3. Replace the route options:

```ts
      {
        websocket: true,
        config: {
          rateLimit: wsLimits
            ? withPrivilegedIp(wsLimits.config, { max: 20, timeWindow: '1 minute' })
            : { max: 20, timeWindow: '1 minute' },
          otel: false,
        },
      },
```

4. Directly after the `if (!account || account.disabled) { … return; }` block, before `identityOf.set(...)`, insert:

```ts
        if (wsLimits && !(await admitConnection(wsLimits, { account, ip: request.ip }))) {
          socket.close(WS_LIMIT_EXCEEDED_CLOSE_CODE, 'Connection limit reached');
          return;
        }
```

- [ ] **Step 15: Pass the deps from `buildApp`**

In `packages/server/src/app.ts`, replace

```ts
  await app.register(liveRoute(db, registry, achievementEngine));
  await app.register(globalLiveRoute(db, globalRegistry));
```

with

```ts
  const wsLimits = {
    limits,
    config: runtimeConfig,
    countUserSockets: (userId: string) =>
      registry.countForUser(userId) + globalRegistry.countForUser(userId),
  };
  await app.register(
    liveRoute(db, registry, achievementEngine, env.WS_REVALIDATE_INTERVAL_MS, wsLimits),
  );
  await app.register(globalLiveRoute(db, globalRegistry, env.WS_REVALIDATE_INTERVAL_MS, wsLimits));
```

`limits` is the `createLimits(...)` result T8 binds in `buildApp`.

- [ ] **Step 16: Run the WS suites to verify they pass**

Run: `pnpm --filter server exec vitest run tests/ws tests/security/f08-ws-revalidation.test.ts`
Expected: PASS. This includes `ws-limits.test.ts`, `live-route-connect-window.test.ts` (which still mounts the bare route) and the revalidation suite.

- [ ] **Step 17: Write the failing frontend tests**

In `packages/frontend/tests/lib/wsAuth.test.ts`, add `WS_LIMIT_EXCEEDED_CLOSE_CODE` to the import. Add to `describe('the WebSocket wire contract', …)`:

```ts
  it('pins the limit-exceeded close code', () => {
    expect(WS_LIMIT_EXCEEDED_CLOSE_CODE).toBe(4429);
  });

  it('keeps all three codes distinct', () => {
    expect(new Set([WS_POLICY_CLOSE_CODE, WS_INVALID_FRAME_CLOSE_CODE, WS_LIMIT_EXCEEDED_CLOSE_CODE]).size).toBe(3);
  });
```

and to `describe('isStaleCredentialClose', …)`:

```ts
  it('never spends a refresh on a connection-limit close', () => {
    // 4429 means "too many sockets"; the token is fine, so the hook must back off.
    expect(isStaleCredentialClose(WS_LIMIT_EXCEEDED_CLOSE_CODE, longAgo())).toBe(false);
  });
```

In `packages/frontend/tests/useGameSocket.test.tsx`, add inside `describe('useGameSocket', …)`:

```ts
  it('backs off instead of refreshing on a connection-limit close', async () => {
    render(withQueryClient(<Harness symbols={['AAPL']} />));
    await tick(0);
    await tick(6_000); // well past the credential-stale threshold
    const ws = MockWebSocket.instances[0]!;
    await act(async () => ws.closeWith(4429));
    expect(vi.mocked(tryRefresh)).not.toHaveBeenCalled();
    await tick(30_001);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('debounces subscribe sends while the symbol set is changing', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (symbols: string[]) => (
      <QueryClientProvider client={qc}>
        <Harness symbols={symbols} />
      </QueryClientProvider>
    );
    const view = render(wrap(['AAPL']));
    await tick(0);
    const ws = MockWebSocket.instances[0]!;
    expect(ws.sent).toHaveLength(1); // the on-open subscribe is immediate

    view.rerender(wrap(['AAPL', 'TSLA']));
    await tick(100);
    view.rerender(wrap(['AAPL', 'TSLA', 'MSFT']));
    await tick(100);
    expect(ws.sent).toHaveLength(1);

    await tick(250);
    expect(ws.sent).toHaveLength(2);
    expect(JSON.parse(ws.sent[1]!)).toEqual({
      event: 'subscribe',
      data: { symbols: ['AAPL', 'TSLA', 'MSFT'] },
    });
  });

  it('does not re-send when a re-render passes an equal symbol set', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (symbols: string[]) => (
      <QueryClientProvider client={qc}>
        <Harness symbols={symbols} />
      </QueryClientProvider>
    );
    const view = render(wrap(['AAPL', 'TSLA']));
    await tick(0);
    const ws = MockWebSocket.instances[0]!;
    view.rerender(wrap(['TSLA', 'AAPL']));
    await tick(500);
    expect(ws.sent).toHaveLength(1);
  });
```

- [ ] **Step 18: Run them to verify they fail**

Run: `pnpm --filter frontend exec vitest run tests/lib/wsAuth.test.ts tests/useGameSocket.test.tsx`
Expected: FAIL. `WS_LIMIT_EXCEEDED_CLOSE_CODE` is undefined, and the debounce test sees `ws.sent` length 3 rather than 1 after the two rerenders.

- [ ] **Step 19: Implement the frontend changes**

Append to `packages/frontend/src/lib/wsAuth.ts`:

```ts
/**
 * Close code for a socket refused because the account already holds its
 * maximum number of live connections. The credential is fine, so this takes
 * the ordinary backoff path — {@link isStaleCredentialClose} only ever matches
 * {@link WS_POLICY_CLOSE_CODE}. Keep in step with `WS_LIMIT_EXCEEDED_CLOSE_CODE`
 * in `packages/server/src/ws/close-codes.ts`.
 */
export const WS_LIMIT_EXCEEDED_CLOSE_CODE = 4429;
```

In `packages/frontend/src/hooks/useGameSocket.ts`, add above the hook function:

```ts
/**
 * Quiet period before a changed symbol set is pushed. The server caps
 * `subscribe` frames per minute, and a user flicking between watchlists would
 * otherwise send one per click.
 */
const SUBSCRIBE_DEBOUNCE_MS = 250;
```

Then replace the final `useEffect` (the one with deps `[symbols]`) with:

```ts
  // When the parent's symbol list changes, push a fresh subscribe once the set
  // has been stable for SUBSCRIBE_DEBOUNCE_MS — but only when the sorted set
  // actually differs from what was last sent. Keyed on the sorted set rather
  // than the array, so a parent that rebuilds an equal array every render
  // cannot keep resetting the timer.
  const symbolsKey = [...symbols].sort().join(',');
  useEffect(() => {
    if (symbolsKey === '') return;
    const handle = setTimeout(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (lastSentKeyRef.current === symbolsKey) return;
      const msg: WsClientEvent = { event: 'subscribe', data: { symbols: symbolsRef.current } };
      try {
        ws.send(JSON.stringify(msg));
        lastSentKeyRef.current = symbolsKey;
      } catch {
        // ignore
      }
    }, SUBSCRIBE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [symbolsKey]);
```

- [ ] **Step 20: Run the frontend suites to verify they pass**

Run: `pnpm --filter frontend exec vitest run tests/lib/wsAuth.test.ts tests/useGameSocket.test.tsx tests/useIndicesSocket.test.tsx`
Expected: PASS

- [ ] **Step 21: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint`
Expected: exits 0

```bash
git add packages/server/src/limits/sliding-window.ts packages/server/src/ws packages/server/src/app.ts \
  packages/shared/src/types/websocket.ts packages/frontend/src/lib/wsAuth.ts \
  packages/frontend/src/hooks/useGameSocket.ts packages/server/tests/limits/sliding-window.test.ts \
  packages/server/tests/ws packages/frontend/tests/lib/wsAuth.test.ts packages/frontend/tests/useGameSocket.test.tsx
git commit -m "feat(limits): cap live sockets per user and throttle subscribe frames

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Frontend — readable messages for `LIMIT_EXCEEDED`

Every surface that already funnels errors through `extractApiMessage` / `toastApiError` gains limit-aware text with no change at its call site. The text covers what was hit, when the user can retry, and whether probation is the reason. The toast gets a "Limit reached" title.

**Files:**
- Create: `packages/frontend/src/lib/limits.ts`
- Modify: `packages/frontend/src/lib/extractApiMessage.ts`
- Modify: `packages/frontend/src/lib/toastApiError.ts`
- Test: `packages/frontend/tests/lib/limits.test.ts`

**Interfaces:**
- Consumes: `LimitExceededBody` from `@markettrader/shared` (T6); `ApiError` from `@/lib/api`.
- Produces:
  - `isLimitExceeded(err): err is ApiError & { body: LimitExceededBody }`
  - `formatRetryAfter(seconds): string`
  - `formatLimitMessage(body, maturityDays?): string`

- [ ] **Step 1: Write the failing test**

`packages/frontend/tests/lib/limits.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { LimitExceededBody } from '@markettrader/shared';
import { ApiError } from '@/lib/api';
import { formatLimitMessage, formatRetryAfter, isLimitExceeded } from '@/lib/limits';
import { extractApiMessage } from '@/lib/extractApiMessage';
import { toastApiError } from '@/lib/toastApiError';
import { useToastStore } from '@/components/ui/toast';

const body: LimitExceededBody = {
  error: 'Game creation limit reached (3 per week)',
  code: 'LIMIT_EXCEEDED',
  limit: 'gamesCreated',
  max: 3,
  probation: false,
  retryAfterSeconds: 2 * 86_400,
};

describe('isLimitExceeded', () => {
  it('recognises a limit body on an ApiError', () => {
    expect(isLimitExceeded(new ApiError(429, body, '429 Too Many Requests'))).toBe(true);
  });

  it('rejects other errors and other bodies', () => {
    expect(isLimitExceeded(new ApiError(409, { error: 'nope' }, '409'))).toBe(false);
    expect(isLimitExceeded(new ApiError(429, null, '429'))).toBe(false);
    expect(isLimitExceeded(new Error('x'))).toBe(false);
  });
});

describe('formatRetryAfter', () => {
  it.each([
    [1, 'in 1 second'],
    [45, 'in 45 seconds'],
    [60, 'in 1 minute'],
    [150, 'in 3 minutes'],
    [3_600, 'in 1 hour'],
    [7_200, 'in 2 hours'],
    [86_400, 'in 1 day'],
    [2 * 86_400 + 5, 'in 3 days'],
  ])('%i s → %s', (seconds, text) => {
    expect(formatRetryAfter(seconds)).toBe(text);
  });
});

describe('formatLimitMessage', () => {
  it('states the limit and when to retry', () => {
    expect(formatLimitMessage(body)).toBe(
      'Game creation limit reached (3 per week). You can try again in 2 days.',
    );
  });

  it('omits the retry sentence when the limit is a concurrent cap', () => {
    const { retryAfterSeconds: _ignored, ...concurrent } = body;
    expect(formatLimitMessage(concurrent)).toBe('Game creation limit reached (3 per week).');
  });

  it('explains probation when it is the reason', () => {
    expect(formatLimitMessage({ ...body, probation: true }, 7)).toBe(
      'Game creation limit reached (3 per week). You can try again in 2 days. ' +
        'New accounts have lower limits for their first 7 days.',
    );
    expect(formatLimitMessage({ ...body, probation: true })).toContain(
      'New accounts have lower limits for their first few days.',
    );
  });
});

describe('error surfaces', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it('extractApiMessage formats a limit body', () => {
    expect(extractApiMessage(new ApiError(429, body, '429'))).toBe(
      'Game creation limit reached (3 per week). You can try again in 2 days.',
    );
  });

  it('toastApiError titles a limit toast "Limit reached"', () => {
    toastApiError(new ApiError(429, body, '429'), 'Failed to create game');
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      title: 'Limit reached',
      description: 'Game creation limit reached (3 per week). You can try again in 2 days.',
      variant: 'destructive',
    });
  });

  it('toastApiError keeps the caller title for other errors', () => {
    toastApiError(new ApiError(409, { error: 'Already joined' }, '409'), 'Failed to join');
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      title: 'Failed to join',
      description: 'Already joined',
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm build:shared && pnpm --filter frontend exec vitest run tests/lib/limits.test.ts`
Expected: FAIL, `Failed to resolve import "@/lib/limits"`

- [ ] **Step 3: Implement `lib/limits.ts`**

`packages/frontend/src/lib/limits.ts`:

```ts
import type { LimitExceededBody } from '@markettrader/shared';
import { ApiError } from '@/lib/api';

/** True when the server refused a request with a `LIMIT_EXCEEDED` body. */
export function isLimitExceeded(err: unknown): err is ApiError & { body: LimitExceededBody } {
  if (!(err instanceof ApiError)) return false;
  const b = err.body;
  return (
    typeof b === 'object' &&
    b !== null &&
    (b as Record<string, unknown>)['code'] === 'LIMIT_EXCEEDED' &&
    typeof (b as Record<string, unknown>)['error'] === 'string'
  );
}

const UNITS: ReadonlyArray<[seconds: number, name: string]> = [
  [86_400, 'day'],
  [3_600, 'hour'],
  [60, 'minute'],
];

/** "in 45 seconds", "in 3 minutes", "in 2 days" — rounded up, so it never promises too early. */
export function formatRetryAfter(seconds: number): string {
  for (const [size, name] of UNITS) {
    if (seconds >= size) {
      const n = Math.ceil(seconds / size);
      return `in ${n} ${name}${n === 1 ? '' : 's'}`;
    }
  }
  const n = Math.max(1, Math.ceil(seconds));
  return `in ${n} second${n === 1 ? '' : 's'}`;
}

/**
 * One readable sentence (or three) for a limit refusal: what was hit, when to
 * retry, and — for accounts still on probation — why their limit is lower.
 */
export function formatLimitMessage(body: LimitExceededBody, maturityDays?: number): string {
  const parts = [body.error.endsWith('.') ? body.error : `${body.error}.`];
  if (body.retryAfterSeconds !== undefined) {
    parts.push(`You can try again ${formatRetryAfter(body.retryAfterSeconds)}.`);
  }
  if (body.probation) {
    const span = maturityDays === undefined ? 'few' : String(maturityDays);
    parts.push(`New accounts have lower limits for their first ${span} days.`);
  }
  return parts.join(' ');
}
```

- [ ] **Step 4: Route both error surfaces through it**

In `packages/frontend/src/lib/extractApiMessage.ts`, add `import { formatLimitMessage, isLimitExceeded } from '@/lib/limits';`. Make this the first statement of `extractApiMessage`:

```ts
  if (isLimitExceeded(err)) return formatLimitMessage(err.body);
```

and append this sentence to its JSDoc: `A {@link isLimitExceeded} body is rendered with {@link formatLimitMessage}.`

Replace the body of `packages/frontend/src/lib/toastApiError.ts` with:

```ts
import { toast } from '@/components/ui/toast';
import { extractApiMessage } from '@/lib/extractApiMessage';
import { isLimitExceeded } from '@/lib/limits';

/**
 * Surface an ApiError (or any thrown value) as a destructive toast. Pulls the
 * server-side reason from the JSON body via {@link extractApiMessage} so 409
 * reasons (e.g. "User owns games — transfer ownership first") and 422 trade
 * messages are shown verbatim rather than swallowed. A limit refusal gets its
 * own title, since "Failed to create game" reads as a fault rather than a cap.
 */
export function toastApiError(err: unknown, fallbackTitle: string): void {
  toast({
    title: isLimitExceeded(err) ? 'Limit reached' : fallbackTitle,
    description: extractApiMessage(err),
    variant: 'destructive',
  });
}
```

`lib/limits.ts` imports only `lib/api`, so there is no import cycle with `extractApiMessage`.

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter frontend exec vitest run tests/lib/limits.test.ts tests/WatchlistPanel.test.tsx tests/components/admin/ConfigEntryRow.test.tsx`
Expected: PASS

- [ ] **Step 6: Typecheck, lint, commit**

Run: `pnpm --filter frontend typecheck && pnpm lint`
Expected: exits 0

```bash
git add packages/frontend/src/lib/limits.ts packages/frontend/src/lib/extractApiMessage.ts \
  packages/frontend/src/lib/toastApiError.ts packages/frontend/tests/lib/limits.test.ts
git commit -m "feat(frontend): explain limit refusals in error toasts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: `UsageTracker` — request and denial aggregation, the global per-user ceiling, `limits.denied` metric

This task adds an in-process aggregation of three things:
- **requests**, counted per subject × route pattern × hour
- **denials**, counted per subject × limit key × hour
- a **sliding 60-second count per user**, which backs `apiRequests`

The pieces that feed it:
- An `onResponse` hook records every request except `/health`, `/version` and `/docs`.
- A global `preHandler` enforces `apiRequests` for authenticated non-admins, outside `/admin`, `/health`, `/version` and `/docs`.
- Every denial is recorded **exactly once**:
  - the enforcer's `DenialRecorder` covers quotas, concurrent caps, WS and the ceiling itself, and marks the error `recorded`;
  - the rate-limit plugin's `onExceeded` (introduced by Task 10, extended here) covers per-user and per-IP rate configs; Task 10's `errorResponseBuilder` already marks those errors `recorded`;
  - the limit error handler counts any `LimitExceededError` still unrecorded when it reaches it — `assertOpenOrderCapacity` is the one source today.
- Each denial also increments `markettrader.limits.denied{limit}`.

T15 flushes the buffers.

**Files:**
- Create: `packages/server/src/limits/usage-tracker.ts`
- Create: `packages/server/src/limits/usage-hooks.ts`
- Modify: `packages/server/src/limits/index.ts` (tracker in `createLimits`, non-null `Limits.tracker`)
- Modify: `packages/server/src/limits/errors.ts` (`registerLimitErrorHandler` takes an `onUnrecorded` callback)
- Modify: `packages/server/src/observability/telemetry.ts` (`limitsDenied`)
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/tests/helpers/app.ts` (`usageTracker` option)
- Test: `packages/server/tests/limits/usage-tracker.test.ts`
- Test: `packages/server/tests/limits/usage-hooks.test.ts`
- Test: `packages/server/tests/observability/telemetry.test.ts`

**Interfaces:**
- Consumes:
  - T8: `createLimits`, `Limits`, `LimitEnforcer(resolver, recordDenial)`, `DenialRecorder`, `LimitSubject`, `LimitResolver`, `LimitOverridesService`.
  - T10: `rateLimitFor(limits, key)` and `rateDenialLabel(request)` in `limits/rate.ts`; `registerRateLimit(app, { disabled, onExceeded })` and the `onExceeded` callback in `buildApp` that logs at info.
  - T8: `LimitExceededError.recorded`, `registerLimitErrorHandler(app)`.
  - T12: `SlidingWindowCounter`.
  - T9: watchlists route uses `limits.enforcer` (exercised by the denial test).
- Produces (for T15, T16):
  - `UsageSubject { type: 'user' | 'ip'; id: string }`
  - `RequestUsageRow { subjectType; subjectId; route; hourStart: string /* ISO, e.g. 2026-10-14T13:00:00.000Z */; count }`
  - `DenialUsageRow { subjectType; subjectId; limitKey: string; hourStart; count; firstAt; lastAt /* ISO */ }`
  - `UsageSnapshot { requests: RequestUsageRow[]; denials: DenialUsageRow[]; overflow: { requests: number; denials: number } }`
  - `OVERFLOW_SUBJECT_ID = '*overflow*'`
  - `hourStartOf(ms): string`
  - `class UsageTracker { recordRequest; recordDenial; hitMinute; peekMinute; swap(); snapshotView() }`
  - `subjectForUsage(request)` and `usageSubjectOf(subject: LimitSubject)`
  - `Limits.tracker: UsageTracker` (non-null)
  - `buildApp({ usageTracker?: UsageTracker })` and `TestAppOptions.usageTracker`
  - `registerLimitErrorHandler(app, onUnrecorded?: (request: FastifyRequest, err: LimitExceededError) => void)`

- [ ] **Step 1: Write the failing tracker unit test**

`packages/server/tests/limits/usage-tracker.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OVERFLOW_SUBJECT_ID, UsageTracker, hourStartOf } from '../../src/limits/usage-tracker.js';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 14, 13, 20); // 13:20Z

function clock(start = T0) {
  let t = start;
  return { now: () => t, set: (v: number) => { t = v; } };
}

describe('hourStartOf', () => {
  it('truncates to the UTC hour', () => {
    expect(hourStartOf(T0)).toBe('2026-10-14T13:00:00.000Z');
  });
});

describe('UsageTracker', () => {
  it('aggregates requests per subject, route and hour', () => {
    const c = clock();
    const t = new UsageTracker({ now: c.now });
    t.recordRequest({ type: 'user', id: 'u1' }, 'GET /watchlists');
    t.recordRequest({ type: 'user', id: 'u1' }, 'GET /watchlists');
    t.recordRequest({ type: 'user', id: 'u1' }, 'POST /games');
    t.recordRequest({ type: 'ip', id: '10.0.0.1' }, 'GET /watchlists');
    c.set(T0 + HOUR);
    t.recordRequest({ type: 'user', id: 'u1' }, 'GET /watchlists');

    const rows = t.snapshotView().requests;
    expect(rows).toHaveLength(4);
    expect(rows).toContainEqual({
      subjectType: 'user', subjectId: 'u1', route: 'GET /watchlists',
      hourStart: '2026-10-14T13:00:00.000Z', count: 2,
    });
    expect(rows).toContainEqual({
      subjectType: 'user', subjectId: 'u1', route: 'GET /watchlists',
      hourStart: '2026-10-14T14:00:00.000Z', count: 1,
    });
  });

  it('aggregates denials with first and last timestamps', () => {
    const c = clock();
    const t = new UsageTracker({ now: c.now });
    t.recordDenial({ type: 'user', id: 'u1' }, 'trades');
    c.set(T0 + 60_000);
    t.recordDenial({ type: 'user', id: 'u1' }, 'trades');
    expect(t.snapshotView().denials).toEqual([
      {
        subjectType: 'user', subjectId: 'u1', limitKey: 'trades',
        hourStart: '2026-10-14T13:00:00.000Z', count: 2,
        firstAt: new Date(T0).toISOString(), lastAt: new Date(T0 + 60_000).toISOString(),
      },
    ]);
  });

  it('diverts new keys to an overflow subject once the bound is reached', () => {
    const t = new UsageTracker({ now: clock().now, maxRequestKeys: 2, maxDenialKeys: 1 });
    t.recordRequest({ type: 'ip', id: 'a' }, 'GET /x');
    t.recordRequest({ type: 'ip', id: 'b' }, 'GET /x');
    t.recordRequest({ type: 'ip', id: 'c' }, 'GET /x');
    t.recordRequest({ type: 'ip', id: 'd' }, 'GET /x');
    t.recordRequest({ type: 'ip', id: 'a' }, 'GET /x'); // existing key still counts normally
    t.recordDenial({ type: 'ip', id: 'a' }, 'k');
    t.recordDenial({ type: 'ip', id: 'b' }, 'k');

    const snap = t.snapshotView();
    expect(snap.requests.find((r) => r.subjectId === 'a')?.count).toBe(2);
    expect(snap.requests.find((r) => r.subjectId === OVERFLOW_SUBJECT_ID)?.count).toBe(2);
    expect(snap.requests.some((r) => r.subjectId === 'c')).toBe(false);
    expect(snap.overflow).toEqual({ requests: 2, denials: 1 });
  });

  it('swap hands over the buffers and starts empty', () => {
    const t = new UsageTracker({ now: clock().now });
    t.recordRequest({ type: 'user', id: 'u1' }, 'GET /games');
    t.recordDenial({ type: 'user', id: 'u1' }, 'trades');
    const snap = t.swap();
    expect(snap.requests).toHaveLength(1);
    expect(snap.denials).toHaveLength(1);
    expect(t.snapshotView()).toEqual({ requests: [], denials: [], overflow: { requests: 0, denials: 0 } });
  });

  it('snapshotView does not drain or alias the buffers', () => {
    const t = new UsageTracker({ now: clock().now });
    t.recordRequest({ type: 'user', id: 'u1' }, 'GET /games');
    const view = t.snapshotView();
    view.requests[0]!.count = 99;
    expect(t.snapshotView().requests[0]!.count).toBe(1);
  });

  it('counts a user’s requests over a sliding minute', () => {
    const c = clock();
    const t = new UsageTracker({ now: c.now });
    expect(t.hitMinute('u1')).toBe(1);
    expect(t.hitMinute('u1')).toBe(2);
    expect(t.peekMinute('u1')).toBe(2);
    expect(t.peekMinute('u2')).toBe(0);
    c.set(T0 + 120_000);
    expect(t.peekMinute('u1')).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter server exec vitest run tests/limits/usage-tracker.test.ts`
Expected: FAIL, `Cannot find module '../../src/limits/usage-tracker.js'`

- [ ] **Step 3: Implement `UsageTracker`**

`packages/server/src/limits/usage-tracker.ts`:

```ts
import type { FastifyRequest } from 'fastify';
import { SlidingWindowCounter } from './sliding-window.js';
import type { LimitSubject } from './resolver.js';

/** Who a request or denial is attributed to: an account, or the client IP when logged out. */
export interface UsageSubject {
  type: 'user' | 'ip';
  id: string;
}

/** Buffered request count for one subject, route pattern and UTC hour. */
export interface RequestUsageRow {
  subjectType: UsageSubject['type'];
  subjectId: string;
  /** `METHOD /registered/:pattern`, or `* <unmatched>` for a 404. */
  route: string;
  /** ISO 8601 start of the UTC hour. */
  hourStart: string;
  count: number;
}

/** Buffered denial count for one subject, limit and UTC hour. */
export interface DenialUsageRow {
  subjectType: UsageSubject['type'];
  subjectId: string;
  /** A `LimitKey`, or `ip:<METHOD /route>` for a per-IP rate config. */
  limitKey: string;
  hourStart: string;
  count: number;
  firstAt: string;
  lastAt: string;
}

/**
 * Everything buffered since the last {@link UsageTracker.swap}. `overflow`
 * counts increments diverted to {@link OVERFLOW_SUBJECT_ID} because the key bound was hit.
 */
export interface UsageSnapshot {
  requests: RequestUsageRow[];
  denials: DenialUsageRow[];
  overflow: { requests: number; denials: number };
}

/** Subject id that absorbs increments for new keys once a buffer is full. */
export const OVERFLOW_SUBJECT_ID = '*overflow*';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** ISO start of the UTC hour containing `ms`. */
export function hourStartOf(ms: number): string {
  return new Date(Math.floor(ms / HOUR_MS) * HOUR_MS).toISOString();
}

/** The account behind a request, or its IP when it carries none. */
export function subjectForUsage(request: FastifyRequest): UsageSubject {
  return request.account
    ? { type: 'user', id: request.account.id }
    : { type: 'ip', id: request.ip };
}

/** The same attribution for a limit subject (used by the denial recorder). */
export function usageSubjectOf(subject: LimitSubject): UsageSubject {
  return subject.account
    ? { type: 'user', id: subject.account.id }
    : { type: 'ip', id: subject.ip };
}

function rowKey(...parts: string[]): string {
  return parts.join('\u0000');
}

/**
 * In-process request and denial counters, flushed to the hourly rollup tables
 * by the usage-rollup worker. Writing a row per request would put a database
 * write on every call, and a row per denial would let a script hammering a
 * limit turn its refusals into a write flood — so both aggregate here first.
 *
 * Bounded: past `maxRequestKeys` / `maxDenialKeys` distinct keys, new subjects
 * are counted under {@link OVERFLOW_SUBJECT_ID} until the next swap.
 */
export class UsageTracker {
  private requests = new Map<string, RequestUsageRow>();
  private denials = new Map<string, DenialUsageRow>();
  private overflow = { requests: 0, denials: 0 };
  private readonly minute: SlidingWindowCounter;
  private readonly maxRequestKeys: number;
  private readonly maxDenialKeys: number;
  private readonly now: () => number;

  constructor(opts: { maxRequestKeys?: number; maxDenialKeys?: number; now?: () => number } = {}) {
    this.maxRequestKeys = opts.maxRequestKeys ?? 50_000;
    this.maxDenialKeys = opts.maxDenialKeys ?? 10_000;
    this.now = opts.now ?? Date.now;
    this.minute = new SlidingWindowCounter(MINUTE_MS, this.now);
  }

  recordRequest(subject: UsageSubject, route: string): void {
    const hourStart = hourStartOf(this.now());
    let subjectId = subject.id;
    let key = rowKey(subject.type, subjectId, route, hourStart);
    if (!this.requests.has(key) && this.requests.size >= this.maxRequestKeys) {
      subjectId = OVERFLOW_SUBJECT_ID;
      key = rowKey(subject.type, subjectId, route, hourStart);
      this.overflow.requests += 1;
    }
    const row = this.requests.get(key);
    if (row) row.count += 1;
    else this.requests.set(key, { subjectType: subject.type, subjectId, route, hourStart, count: 1 });
  }

  recordDenial(subject: UsageSubject, limitKey: string): void {
    const at = this.now();
    const hourStart = hourStartOf(at);
    const iso = new Date(at).toISOString();
    let subjectId = subject.id;
    let key = rowKey(subject.type, subjectId, limitKey, hourStart);
    if (!this.denials.has(key) && this.denials.size >= this.maxDenialKeys) {
      subjectId = OVERFLOW_SUBJECT_ID;
      key = rowKey(subject.type, subjectId, limitKey, hourStart);
      this.overflow.denials += 1;
    }
    const row = this.denials.get(key);
    if (row) {
      row.count += 1;
      row.lastAt = iso;
    } else {
      this.denials.set(key, {
        subjectType: subject.type, subjectId, limitKey, hourStart, count: 1, firstAt: iso, lastAt: iso,
      });
    }
  }

  /** Counts one request toward `userId`'s sliding minute and returns the total including it. */
  hitMinute(userId: string): number {
    return this.minute.hit(userId);
  }

  peekMinute(userId: string): number {
    return this.minute.peek(userId);
  }

  /** Hands the buffers to the caller and starts fresh ones, so no increment is lost mid-flush. */
  swap(): UsageSnapshot {
    const snapshot: UsageSnapshot = {
      requests: [...this.requests.values()],
      denials: [...this.denials.values()],
      overflow: this.overflow,
    };
    this.requests = new Map();
    this.denials = new Map();
    this.overflow = { requests: 0, denials: 0 };
    return snapshot;
  }

  /** A copy of what is buffered but not yet flushed — merged into admin reads so they are current. */
  snapshotView(): UsageSnapshot {
    return {
      requests: [...this.requests.values()].map((row) => ({ ...row })),
      denials: [...this.denials.values()].map((row) => ({ ...row })),
      overflow: { ...this.overflow },
    };
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter server exec vitest run tests/limits/usage-tracker.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Write the failing metric test**

Append inside `describe('telemetry instruments', …)` in `packages/server/tests/observability/telemetry.test.ts`:

```ts
  it('counts limit denials by limit key only', async () => {
    meters.limitsDenied.add(2, { limit: 'trades' });
    meters.limitsDenied.add(1, { limit: 'ip:POST /auth/login' });

    await provider.forceFlush();

    const points = pointsFor(exporter.getMetrics(), 'markettrader.limits.denied');
    const byLimit = Object.fromEntries(points.map((p) => [p.attributes.limit, p.value]));
    expect(byLimit).toMatchObject({ trades: 2, 'ip:POST /auth/login': 1 });
    // No user attribute, ever — unbounded cardinality.
    expect(points.every((p) => Object.keys(p.attributes).join() === 'limit')).toBe(true);
  });
```

Run: `pnpm --filter server exec vitest run tests/observability/telemetry.test.ts`
Expected: FAIL, `Cannot read properties of undefined (reading 'add')`

- [ ] **Step 6: Add the instrument**

In `packages/server/src/observability/telemetry.ts`, add as the last entry of the object returned by `buildInstruments()`, after `eventsEmitted`:

```ts

    limitsDenied: meter.createCounter('markettrader.limits.denied', {
      description: 'Requests, frames and connections refused by a usage limit, by limit key',
    }),
```

Run: `pnpm --filter server exec vitest run tests/observability/telemetry.test.ts`
Expected: PASS

- [ ] **Step 7: Write the failing hooks integration test**

First, extend the test fixture in `packages/server/tests/helpers/app.ts`:
- add `import type { UsageTracker } from '../../src/limits/usage-tracker.js';`
- add to `TestAppOptions`:

```ts
  /** Inject to inspect what the app's usage hooks recorded. */
  usageTracker?: UsageTracker;
```

- in `createTestAppWithDb`, add `usageTracker: options.usageTracker,` to the `buildApp({ … })` argument.

`packages/server/tests/limits/usage-hooks.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestAppWithDb, registerAdmin } from '../helpers/app.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { UsageTracker } from '../../src/limits/usage-tracker.js';

const settle = () => new Promise((r) => setImmediate(r));

async function register(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id };
}

describe('usage hooks', () => {
  let app: FastifyInstance;
  let tracker: UsageTracker;

  beforeEach(async () => {
    tracker = new UsageTracker();
    ({ app } = await createTestAppWithDb(undefined, undefined, {
      limits: { disabled: false },
      usageTracker: tracker,
      runtimeConfig: RuntimeConfig.fromEnvironment({
        LIMITS_PROBATION_PERCENT: 100,
        LIMIT_API_REQUESTS_PER_MINUTE: 3,
        LIMIT_CODE_LOOKUPS_PER_MINUTE: 1,
        WATCHLIST_MAX_PER_USER: 1,
      }),
    }));
  });

  afterEach(async () => {
    await app.close();
  });

  it('records authenticated requests against the user and the route pattern', async () => {
    const u = await register(app, 'usage-user');
    await app.inject({ method: 'GET', url: '/watchlists', headers: { Authorization: `Bearer ${u.token}` } });
    await settle();
    expect(tracker.snapshotView().requests).toContainEqual(
      expect.objectContaining({ subjectType: 'user', subjectId: u.userId, route: 'GET /watchlists', count: 1 }),
    );
  });

  it('records anonymous requests against the IP, and 404s as unmatched', async () => {
    await app.inject({ method: 'GET', url: '/market/status', remoteAddress: '203.0.113.9' });
    await app.inject({ method: 'GET', url: '/no-such-route', remoteAddress: '203.0.113.9' });
    await settle();
    const rows = tracker.snapshotView().requests.filter((r) => r.subjectId === '203.0.113.9');
    expect(rows.map((r) => r.route).sort()).toEqual(['* <unmatched>', 'GET /market/status']);
    expect(rows.every((r) => r.subjectType === 'ip')).toBe(true);
  });

  it('does not record health, version or docs probes', async () => {
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/version' });
    await settle();
    expect(tracker.snapshotView().requests.some((r) => /\/(health|version)$/.test(r.route))).toBe(false);
  });

  it('refuses a user past the per-minute ceiling with a LIMIT_EXCEEDED 429', async () => {
    const u = await register(app, 'usage-ceiling');
    const headers = { Authorization: `Bearer ${u.token}` };
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'GET', url: '/watchlists', headers })).statusCode).toBe(200);
    }
    const res = await app.inject({ method: 'GET', url: '/watchlists', headers });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.json()).toMatchObject({ code: 'LIMIT_EXCEEDED', limit: 'apiRequests', max: 3 });
    expect(tracker.snapshotView().denials).toContainEqual(
      expect.objectContaining({ subjectType: 'user', subjectId: u.userId, limitKey: 'apiRequests', count: 1 }),
    );
  });

  it('never applies the ceiling to an admin', async () => {
    const admin = await registerAdmin(app, 'usage-admin');
    const headers = { Authorization: `Bearer ${admin.token}` };
    for (let i = 0; i < 6; i++) {
      expect((await app.inject({ method: 'GET', url: '/watchlists', headers })).statusCode).toBe(200);
    }
  });

  it('records a denial raised through the enforcer', async () => {
    const u = await register(app, 'usage-enforcer');
    const headers = { Authorization: `Bearer ${u.token}` };
    await app.inject({ method: 'POST', url: '/watchlists', headers, payload: { name: 'one' } });
    const res = await app.inject({ method: 'POST', url: '/watchlists', headers, payload: { name: 'two' } });
    expect(res.statusCode).toBe(409);
    expect(tracker.snapshotView().denials).toContainEqual(
      expect.objectContaining({ subjectId: u.userId, limitKey: 'watchlists' }),
    );
  });

  it('records a denial raised by the rate-limit plugin under its limit key', async () => {
    const u = await register(app, 'usage-rate');
    const headers = { Authorization: `Bearer ${u.token}` };
    await app.inject({ method: 'GET', url: '/games/by-code/ABCDEFGH', headers });
    const res = await app.inject({ method: 'GET', url: '/games/by-code/ABCDEFGH', headers });
    expect(res.statusCode).toBe(429);
    // Exactly once: onExceeded counts it, and the error the builder returns is
    // marked recorded so the error handler does not count it again.
    const rows = tracker
      .snapshotView()
      .denials.filter((d) => d.subjectId === u.userId && d.limitKey === 'codeLookups');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subjectType: 'user', count: 1 });
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm --filter server exec vitest run tests/limits/usage-hooks.test.ts`
Expected: FAIL. No requests are recorded (`expected [] to contain …`), and the 4th `/watchlists` call returns 200 instead of 429.

- [ ] **Step 9: Let the error handler count denials nobody recorded**

Per-user rate configs need no extra labelling: Task 10's `rateDenialLabel(request)` already returns the `LimitKey` for them and `ip:<METHOD> <route>` for the per-IP layer.

In `packages/server/src/limits/errors.ts`, change `registerLimitErrorHandler` to take an optional callback and call it for errors no recorder has seen yet:

```ts
/**
 * Root error handler for {@link LimitExceededError}. Must be registered before
 * any route plugin, because route contexts inherit the error handler at
 * registration. Any other error is rethrown, which hands it to Fastify's
 * default handler, so existing error bodies are unchanged. `onUnrecorded`
 * counts denials thrown outside the enforcer and the rate-limit plugin.
 */
export function registerLimitErrorHandler(
  app: FastifyInstance,
  onUnrecorded?: (request: FastifyRequest, err: LimitExceededError) => void,
): void {
  app.setErrorHandler((err: Error, request, reply) => {
    if (!(err instanceof LimitExceededError)) throw err;
    if (!err.recorded) {
      onUnrecorded?.(request, err);
      err.recorded = true;
    }
    if (err.retryAfterSeconds !== undefined) {
      void reply.header('retry-after', String(err.retryAfterSeconds));
    }
    return reply.code(statusFor(LIMIT_CATALOGUE[err.resolved.key].kind)).send(limitExceededBody(err));
  });
}
```

(add `FastifyRequest` to the existing `import type { FastifyInstance } from 'fastify';`).

- [ ] **Step 10: Implement the hooks and the denial recorders**

`packages/server/src/limits/usage-hooks.ts`:

```ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { meters } from '../observability/telemetry.js';
import type { Limits } from './index.js';
import type { DenialRecorder } from './enforce.js';
import type { LimitExceededError } from './errors.js';
import { rateDenialLabel } from './rate.js';
import { subjectOf } from './resolver.js';
import { subjectForUsage, usageSubjectOf, type UsageTracker } from './usage-tracker.js';

/** Probes and docs: never counted, never limited. */
const UNTRACKED = ['/health', '/version', '/docs'];
/** Admin routes are immune by definition; the probes are not user traffic. */
const CEILING_EXEMPT = ['/admin', ...UNTRACKED];

/** Seconds a ceiling refusal asks the client to wait — one half-window of the sliding minute. */
const CEILING_RETRY_AFTER_SECONDS = 30;

function under(url: string | undefined, prefixes: readonly string[]): boolean {
  return url !== undefined && prefixes.some((p) => url === p || url.startsWith(`${p}/`));
}

/** `METHOD /registered/:pattern` — bounded cardinality, unlike the raw URL. */
export function usageRoute(request: FastifyRequest): string {
  const url = request.routeOptions.url;
  return url === undefined ? '* <unmatched>' : `${request.method} ${url}`;
}

/** Records every limit refusal in the tracker and the `limits.denied` metric. */
export function denialRecorderFor(tracker: UsageTracker): DenialRecorder {
  return (subject, key) => {
    tracker.recordDenial(usageSubjectOf(subject), key);
    meters.limitsDenied.add(1, { limit: key });
  };
}

/**
 * `onExceeded` for `@fastify/rate-limit`. Per-user configs are labelled with
 * their limit key; the per-IP configs underneath with `ip:<METHOD /route>`.
 */
export function recordRateLimitDenial(tracker: UsageTracker, request: FastifyRequest): void {
  const label = rateDenialLabel(request);
  tracker.recordDenial(subjectForUsage(request), label);
  meters.limitsDenied.add(1, { limit: label });
}

/** The error handler's fallback for a {@link LimitExceededError} no recorder saw (e.g. `assertOpenOrderCapacity`). */
export function recordUnrecordedDenial(tracker: UsageTracker, request: FastifyRequest, err: LimitExceededError): void {
  denialRecorderFor(tracker)(subjectOf(request), err.resolved.key);
}

/**
 * Root-level hooks: `preHandler` enforces the per-user `apiRequests` ceiling
 * (it runs after each route's `onRequest: authenticate`, so `request.account`
 * is set), and `onResponse` feeds the request counters. Must be registered
 * before any route so every route inherits them.
 */
export function registerUsageHooks(app: FastifyInstance, limits: Limits): void {
  app.addHook('preHandler', async (request) => {
    const account = request.account;
    if (!account || account.isAdmin) return;
    if (under(request.routeOptions.url, CEILING_EXEMPT)) return;
    const count = limits.tracker.hitMinute(account.id);
    await limits.enforcer.enforce(request, 'apiRequests', async () => count - 1, {
      retryAfter: async () => CEILING_RETRY_AFTER_SECONDS,
    });
  });

  app.addHook('onResponse', async (request) => {
    if (under(request.routeOptions.url, UNTRACKED)) return;
    limits.tracker.recordRequest(subjectForUsage(request), usageRoute(request));
  });
}
```

- [ ] **Step 11: Give `createLimits` a tracker and a real denial recorder**

In `packages/server/src/limits/index.ts`:
- add the imports `import { UsageTracker } from './usage-tracker.js';` and `import { denialRecorderFor } from './usage-hooks.js';`
- add to the `Limits` interface (T8 has no `tracker` field yet):

```ts
  /** In-process request/denial counters; flushed by the usage-rollup worker. */
  tracker: UsageTracker;
```

- add `tracker?: UsageTracker;` to the `createLimits` deps type
- at the top of `createLimits`, add `const tracker = deps.tracker ?? new UsageTracker();`
- replace the enforcer construction (whatever no-op recorder T8 passed) with `const enforcer = new LimitEnforcer(resolver, denialRecorderFor(tracker));`
- return `tracker` (not `null`) in the result

The resulting function reads:

```ts
export function createLimits(deps: {
  db: Db;
  config: ConfigReader;
  disabled?: boolean;
  tracker?: UsageTracker;
}): Limits {
  const tracker = deps.tracker ?? new UsageTracker();
  const overrides = new LimitOverridesService(deps.db);
  const resolver = new LimitResolver(deps.config, overrides, { disabled: deps.disabled });
  const enforcer = new LimitEnforcer(resolver, denialRecorderFor(tracker));
  return { config: deps.config, resolver, overrides, enforcer, tracker };
}
```

Keep any further fields T8 returns. Remove the `| null` narrowing (`if (limits.tracker)`) anywhere it was added.

- [ ] **Step 12: Extend Task 10's `onExceeded` and wire `buildApp`**

`packages/server/src/plugins/rate-limit.ts` is unchanged: Task 10 already gave `registerRateLimit` its `onExceeded` option.

In `packages/server/src/app.ts`:
1. Add imports:

```ts
import { UsageTracker } from './limits/usage-tracker.js';
import { recordRateLimitDenial, recordUnrecordedDenial, registerUsageHooks } from './limits/usage-hooks.js';
```

2. Add to the `buildApp` options type, after `runtimeConfig?`:

```ts
    /** Request/denial counters for this app. Tests inject one to inspect it. */
    usageTracker?: UsageTracker;
```

and to the destructuring: `usageTracker = new UsageTracker(),`.

3. Extend the `onExceeded` callback Task 10 added to `registerRateLimit` — keep its info log and add the count:

```ts
  await registerRateLimit(app, {
    disabled: disableRateLimit,
    // Info, not warn: warn ships to PostHog, which bills by volume, and a
    // script hammering a limit would turn into a bill.
    onExceeded: (request) => {
      request.log.info(
        { limit: rateDenialLabel(request), ip: request.ip, userId: request.account?.id },
        'rate limit exceeded',
      );
      recordRateLimitDenial(usageTracker, request);
    },
  });
```

and change Task 8's `registerLimitErrorHandler(app);` to:

```ts
  registerLimitErrorHandler(app, (request, err) => recordUnrecordedDenial(usageTracker, request, err));
```

4. Pass `tracker: usageTracker` into the existing `createLimits({ … })` call. Immediately after that call, before any `app.register(...Routes...)`, add:

```ts
  // Root-level, before every route: the ceiling and the usage counters must
  // cover each route registered below.
  registerUsageHooks(app, limits);
```

- [ ] **Step 13: Run it to verify it passes**

Run: `pnpm --filter server exec vitest run tests/limits/usage-hooks.test.ts tests/limits/usage-tracker.test.ts tests/observability/telemetry.test.ts`
Expected: PASS

- [ ] **Step 14: Run the full server suite**

Run: `pnpm build:shared && pnpm --filter server test`
Expected: PASS.

Verify only: Task 9 Step 1 already added `limits: { disabled: true }` to every test that calls `buildApp` directly, so the new ceiling cannot trip them. If one fails with `429 LIMIT_EXCEEDED` / `limit: 'apiRequests'`, it is a direct `buildApp` caller Task 9 missed — add the option there rather than changing the ceiling.

- [ ] **Step 15: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint`
Expected: exits 0

```bash
git add packages/server/src/limits packages/server/src/plugins/rate-limit.ts \
  packages/server/src/observability/telemetry.ts packages/server/src/app.ts \
  packages/server/tests/helpers/app.ts packages/server/tests/limits \
  packages/server/tests/observability/telemetry.test.ts
git commit -m "feat(limits): track per-user usage, enforce the request ceiling, count denials

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 15: Usage rollup tables, store, and worker

Persists what the in-memory `UsageTracker` (Task 14) counts: hourly request volume per subject × route, and hourly limit denials per subject × limit key. A worker flushes the tracker every `USAGE_FLUSH_INTERVAL_MS` and prunes rows older than `USAGE_RETENTION_DAYS`. Deleting a user removes their usage rows.

**Files:**
- Modify: `packages/server/src/env.ts` (two live options in `liveBootConfig`)
- Modify: `packages/server/src/config/registry.ts` (two descriptors)
- Modify: `packages/server/src/db/schema.sqlite.ts`, `packages/server/src/db/schema.pg.ts` (two tables)
- Generate: `packages/server/drizzle/sqlite/00NN_*.sql`, `packages/server/drizzle/pg/00NN_*.sql` (+ meta snapshots)
- Create: `packages/server/src/limits/usage-store.ts`
- Create: `packages/server/src/workers/usage-rollup.ts`
- Modify: `packages/server/src/app.ts` (start worker inside `!disablePoller`, final flush on close)
- Modify: `packages/server/src/routes/admin/users.ts` (delete usage rows in the user-delete transaction)
- Test: `packages/server/tests/limits/usage-store.test.ts`
- Test: `packages/server/tests/workers/usage-rollup.test.ts`
- Test: `packages/server/tests/limits/usage-user-delete.test.ts`

**Interfaces:**
- Consumes (Task 14, `S/limits/usage-tracker.ts`) — Task 14's shape is authoritative:
  ```ts
  export interface UsageSubject { type: 'user' | 'ip'; id: string }
  export interface RequestUsageRow { subjectType: 'user' | 'ip'; subjectId: string; route: string; hourStart: string; count: number }
  export interface DenialUsageRow {
    subjectType: 'user' | 'ip'; subjectId: string; limitKey: string; hourStart: string; count: number; firstAt: string; lastAt: string;
  }
  /** `hourStart`, `firstAt`, `lastAt` are ISO-8601 UTC; `hourStart` is truncated to the hour, e.g. `2026-10-14T13:00:00.000Z`. */
  export interface UsageSnapshot { requests: RequestUsageRow[]; denials: DenialUsageRow[]; overflow: { requests: number; denials: number } }
  export const OVERFLOW_SUBJECT_ID = '*overflow*';
  export class UsageTracker {
    constructor(opts?: { maxRequestKeys?: number; maxDenialKeys?: number; now?: () => number });
    recordRequest(subject: UsageSubject, route: string): void;
    recordDenial(subject: UsageSubject, limitKey: string): void;
    swap(): UsageSnapshot;          // returns the buffered counts and empties the buffers
    snapshotView(): UsageSnapshot;  // the buffered counts, buffers untouched
    peekMinute(userId: string): number;
  }
  ```
- Consumes (Task 8 + Task 14): `Limits` from `S/limits/index.ts`, with `config: ConfigReader` and a **non-null** `tracker: UsageTracker` (Task 14).
- Consumes (Task 7): `registerUser(app, username, opts?) → { token, userId, headers }` from `T/helpers/users.ts`.
- Produces (`S/limits/usage-store.ts`):
  ```ts
  export function truncateToHourIso(date: Date): string;
  export function windowStartIso(now: Date, hours: number): string;
  export function flushUsage(db: Db, snapshot: UsageSnapshot): Promise<void>;
  export function pruneUsage(db: Db, olderThanIso: string): Promise<void>;
  export function deleteUsageForUser(tx: Pick<Db, 'delete'>, userId: string): Promise<void>;
  export interface TopConsumerRow { subjectType: 'user' | 'ip'; subjectId: string; count: number; top: string | null }
  export function topConsumers(db: Db, tracker: UsageTracker,
    opts: { sinceIso: string; metric: 'requests' | 'denials'; limit: number }): Promise<TopConsumerRow[]>;
  export function userRequestVolume(db: Db, tracker: UsageTracker, userId: string, sinceIso: string, limit: number)
    : Promise<AdminRouteVolume[]>;
  export function userDenials(db: Db, tracker: UsageTracker, userId: string, sinceIso: string)
    : Promise<AdminDenialSummary[]>;
  ```
- Produces (`S/workers/usage-rollup.ts`):
  ```ts
  export interface UsageRollupDeps { db: Db; tracker: UsageTracker; config: ConfigReader; logger?: FastifyBaseLogger; now?: () => Date }
  export function runUsageRollupTick(deps: UsageRollupDeps): Promise<void>;
  export function startUsageRollupWorker(deps: UsageRollupDeps & { intervalMs?: number }): IntervalWorker;
  ```
- Produces: schema tables `apiUsageHourly`, `limitDenialsHourly` (both dialects); live config keys `USAGE_FLUSH_INTERVAL_MS`, `USAGE_RETENTION_DAYS`. **This task owns these two keys.** Task 6 does not add them.

- [ ] **Step 1: Add the two live options**

In `packages/server/src/env.ts`, inside `liveBootConfig`, directly after the `PRICE_POLLER_MAX_SYMBOLS` entry, add:

```ts
  /**
   * How often the usage-rollup worker writes the in-memory request and denial
   * counts to `api_usage_hourly` / `limit_denials_hourly`. A crash loses at most
   * one interval of counts — monitoring data, never enforcement state.
   */
  USAGE_FLUSH_INTERVAL_MS: parsePositiveInt(
    'USAGE_FLUSH_INTERVAL_MS',
    optional('USAGE_FLUSH_INTERVAL_MS', '60000'),
  ),
  /** Days of hourly usage and denial rows kept for the admin panel. */
  USAGE_RETENTION_DAYS: parsePositiveInt(
    'USAGE_RETENTION_DAYS',
    optional('USAGE_RETENTION_DAYS', '30'),
  ),
```

In `packages/server/src/config/registry.ts`, in the `// ── workers` section directly after `DISCOVER_REFRESH_INTERVAL_MS`, add:

```ts
  USAGE_FLUSH_INTERVAL_MS: {
    category: 'workers', kind: 'integer', unit: 'ms', mutability: 'live', min: 5 * SECOND, max: 10 * MINUTE,
    description: 'How often per-user request and denial counts are written to the usage tables.',
  },
```

and in the `// ── limits` section after `WATCHLIST_MAX_PER_USER`, add:

```ts
  USAGE_RETENTION_DAYS: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 365,
    description: 'Days of hourly usage history kept for the admin limits panel.',
  },
```

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/config`
Expected: PASS (registry test checks that live integers have bounds and that kinds match boot values).

- [ ] **Step 2: Add the tables to both schemas**

Append to `packages/server/src/db/schema.sqlite.ts`:

```ts
/**
 * Hourly request counts per subject (a user, or an IP for unauthenticated calls)
 * per registered route pattern, flushed from the in-memory `UsageTracker` by the
 * usage-rollup worker. Monitoring only; no limit reads it. Timestamps are
 * ISO-8601 UTC text on both dialects so window filters are the same string
 * comparison everywhere. No FK to users: a subject may be an IP.
 */
export const apiUsageHourly = sqliteTable(
  'api_usage_hourly',
  {
    subjectType: text('subject_type', { enum: ['user', 'ip'] }).notNull(),
    subjectId: text('subject_id').notNull(),
    route: text('route').notNull(),
    hourStart: text('hour_start').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.subjectType, t.subjectId, t.route, t.hourStart] }),
    index('api_usage_hourly_hour_idx').on(t.hourStart),
  ],
);

/**
 * Hourly count of limit denials per subject per limit key, with the first and
 * last denial in the hour. Aggregated in memory before writing, so a script
 * hammering a limit costs one row update per flush, not one insert per denial.
 */
export const limitDenialsHourly = sqliteTable(
  'limit_denials_hourly',
  {
    subjectType: text('subject_type', { enum: ['user', 'ip'] }).notNull(),
    subjectId: text('subject_id').notNull(),
    limitKey: text('limit_key').notNull(),
    hourStart: text('hour_start').notNull(),
    count: integer('count').notNull(),
    firstAt: text('first_at').notNull(),
    lastAt: text('last_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.subjectType, t.subjectId, t.limitKey, t.hourStart] }),
    index('limit_denials_hourly_hour_idx').on(t.hourStart),
  ],
);
```

Append to `packages/server/src/db/schema.pg.ts`:

```ts
/**
 * Hourly request counts per subject per route. Mirrors the SQLite variant;
 * timestamps are deliberately ISO text here too so window filters are identical.
 */
export const apiUsageHourly = pgTable(
  'api_usage_hourly',
  {
    subjectType: text('subject_type', { enum: ['user', 'ip'] }).notNull(),
    subjectId: text('subject_id').notNull(),
    route: text('route').notNull(),
    hourStart: text('hour_start').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.subjectType, t.subjectId, t.route, t.hourStart] }),
    index('api_usage_hourly_hour_idx').on(t.hourStart),
  ],
);

/** Hourly limit denials per subject per limit key. Mirrors the SQLite variant. */
export const limitDenialsHourly = pgTable(
  'limit_denials_hourly',
  {
    subjectType: text('subject_type', { enum: ['user', 'ip'] }).notNull(),
    subjectId: text('subject_id').notNull(),
    limitKey: text('limit_key').notNull(),
    hourStart: text('hour_start').notNull(),
    count: integer('count').notNull(),
    firstAt: text('first_at').notNull(),
    lastAt: text('last_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.subjectType, t.subjectId, t.limitKey, t.hourStart] }),
    index('limit_denials_hourly_hour_idx').on(t.hourStart),
  ],
);
```

- [ ] **Step 3: Generate both migrations**

Run:
```bash
cd packages/server
pnpm db:generate
DATABASE_URL=postgres://u:p@localhost:5432/x pnpm db:generate
cd ../..
```
Expected: one new `.sql` file in `drizzle/sqlite/` and one in `drizzle/pg/`, each creating `api_usage_hourly` and `limit_denials_hourly` with their composite primary keys and `hour_start` indexes, plus updated `meta/` snapshots. Read both files to confirm they contain only these two tables. Do not edit them.

- [ ] **Step 4: Write the failing store test**

Create `packages/server/tests/limits/usage-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/app.js';
import { schema } from '../../src/db/index.js';
import { UsageTracker } from '../../src/limits/usage-tracker.js';
import {
  deleteUsageForUser,
  flushUsage,
  pruneUsage,
  topConsumers,
  truncateToHourIso,
  userDenials,
  userRequestVolume,
  windowStartIso,
} from '../../src/limits/usage-store.js';

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

// 2026-10-14 13:25 UTC → hour bucket 13:00.
const T0 = Date.UTC(2026, 9, 14, 13, 25, 0);
const HOUR = 3_600_000;

describe('usage-store', () => {
  let db: TestDb;
  let clock: number;
  let tracker: UsageTracker;

  beforeEach(async () => {
    db = await createTestDb();
    // createTestDb shares one in-memory DB per file; start each test empty.
    await db.delete(schema.apiUsageHourly);
    await db.delete(schema.limitDenialsHourly);
    clock = T0;
    tracker = new UsageTracker({ now: () => clock });
  });

  it('truncates to the hour and computes window starts', () => {
    expect(truncateToHourIso(new Date(T0))).toBe('2026-10-14T13:00:00.000Z');
    expect(windowStartIso(new Date(T0), 24)).toBe('2026-10-13T13:00:00.000Z');
  });

  it('adds counts across flushes instead of overwriting them', async () => {
    const u = { type: 'user' as const, id: 'u1' };
    tracker.recordRequest(u, 'GET /games');
    tracker.recordRequest(u, 'GET /games');
    await flushUsage(db, tracker.swap());
    tracker.recordRequest(u, 'GET /games');
    await flushUsage(db, tracker.swap());

    const rows = await db.select().from(schema.apiUsageHourly);
    expect(rows).toEqual([
      { subjectType: 'user', subjectId: 'u1', route: 'GET /games', hourStart: '2026-10-14T13:00:00.000Z', count: 3 },
    ]);
  });

  it('keeps first_at and advances last_at for denials', async () => {
    const u = { type: 'user' as const, id: 'u1' };
    tracker.recordDenial(u, 'gamesCreated');
    await flushUsage(db, tracker.swap());
    clock = T0 + 10 * 60_000;
    tracker.recordDenial(u, 'gamesCreated');
    await flushUsage(db, tracker.swap());

    const [row] = await db.select().from(schema.limitDenialsHourly);
    expect(row).toMatchObject({
      limitKey: 'gamesCreated',
      count: 2,
      firstAt: new Date(T0).toISOString(),
      lastAt: new Date(T0 + 10 * 60_000).toISOString(),
    });
  });

  it('flushing an empty snapshot is a no-op', async () => {
    await flushUsage(db, tracker.swap());
    expect(await db.select().from(schema.apiUsageHourly)).toHaveLength(0);
  });

  it('prunes rows strictly older than the cutoff', async () => {
    const u = { type: 'user' as const, id: 'u1' };
    tracker.recordRequest(u, 'GET /games');
    tracker.recordDenial(u, 'trades');
    clock = T0 + 2 * HOUR;
    tracker.recordRequest(u, 'GET /games');
    await flushUsage(db, tracker.swap());

    await pruneUsage(db, '2026-10-14T14:00:00.000Z');
    const rows = await db.select().from(schema.apiUsageHourly);
    expect(rows.map((r) => r.hourStart)).toEqual(['2026-10-14T15:00:00.000Z']);
    expect(await db.select().from(schema.limitDenialsHourly)).toHaveLength(0);
  });

  it('ranks top consumers from flushed rows plus the unflushed buffer', async () => {
    const heavy = { type: 'user' as const, id: 'heavy' };
    const light = { type: 'user' as const, id: 'light' };
    const anon = { type: 'ip' as const, id: '198.51.100.9' };
    for (let i = 0; i < 5; i++) tracker.recordRequest(heavy, 'POST /games/:id/trades');
    tracker.recordRequest(heavy, 'GET /games');
    tracker.recordRequest(light, 'GET /games');
    await flushUsage(db, tracker.swap());
    // Not flushed yet: must still count.
    for (let i = 0; i < 3; i++) tracker.recordRequest(anon, 'GET /stocks/search');

    const rows = await topConsumers(db, tracker, {
      sinceIso: windowStartIso(new Date(clock), 24),
      metric: 'requests',
      limit: 10,
    });
    expect(rows).toEqual([
      { subjectType: 'user', subjectId: 'heavy', count: 6, top: 'POST /games/:id/trades' },
      { subjectType: 'ip', subjectId: '198.51.100.9', count: 3, top: 'GET /stocks/search' },
      { subjectType: 'user', subjectId: 'light', count: 1, top: 'GET /games' },
    ]);
  });

  it('excludes rows before the window and honours the limit', async () => {
    const old = { type: 'user' as const, id: 'old' };
    const now = { type: 'user' as const, id: 'now' };
    tracker.recordRequest(old, 'GET /games');
    await flushUsage(db, tracker.swap());
    clock = T0 + 30 * HOUR;
    tracker.recordRequest(now, 'GET /games');
    tracker.recordRequest(now, 'GET /games');

    const rows = await topConsumers(db, tracker, {
      sinceIso: windowStartIso(new Date(clock), 24),
      metric: 'requests',
      limit: 1,
    });
    expect(rows.map((r) => r.subjectId)).toEqual(['now']);
  });

  it('ranks denials by limit key', async () => {
    const u = { type: 'user' as const, id: 'u1' };
    tracker.recordDenial(u, 'trades');
    tracker.recordDenial(u, 'trades');
    tracker.recordDenial(u, 'gamesCreated');
    await flushUsage(db, tracker.swap());

    const rows = await topConsumers(db, tracker, {
      sinceIso: windowStartIso(new Date(clock), 24),
      metric: 'denials',
      limit: 10,
    });
    expect(rows).toEqual([{ subjectType: 'user', subjectId: 'u1', count: 3, top: 'trades' }]);
  });

  it('reports one user’s request volume by route and denials, merged with the buffer', async () => {
    const u = { type: 'user' as const, id: 'u1' };
    const other = { type: 'user' as const, id: 'u2' };
    tracker.recordRequest(u, 'GET /games');
    tracker.recordRequest(u, 'GET /games');
    tracker.recordRequest(other, 'GET /games');
    tracker.recordDenial(u, 'trades');
    await flushUsage(db, tracker.swap());
    tracker.recordRequest(u, 'POST /games');
    tracker.recordDenial(u, 'trades');

    const since = windowStartIso(new Date(clock), 24 * 7);
    expect(await userRequestVolume(db, tracker, 'u1', since, 10)).toEqual([
      { route: 'GET /games', count: 2 },
      { route: 'POST /games', count: 1 },
    ]);
    const denials = await userDenials(db, tracker, 'u1', since);
    expect(denials).toEqual([{ limitKey: 'trades', count: 2, lastAt: new Date(T0).toISOString() }]);
  });

  it('deletes only the given user’s rows', async () => {
    tracker.recordRequest({ type: 'user', id: 'gone' }, 'GET /games');
    tracker.recordDenial({ type: 'user', id: 'gone' }, 'trades');
    tracker.recordRequest({ type: 'user', id: 'kept' }, 'GET /games');
    tracker.recordRequest({ type: 'ip', id: 'gone' }, 'GET /stocks/search');
    await flushUsage(db, tracker.swap());

    await deleteUsageForUser(db, 'gone');
    const rows = await db.select().from(schema.apiUsageHourly);
    expect(rows.map((r) => `${r.subjectType}:${r.subjectId}`).sort()).toEqual(['ip:gone', 'user:kept']);
    expect(await db.select().from(schema.limitDenialsHourly)).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/limits/usage-store.test.ts`
Expected: FAIL — `Failed to load url ../../src/limits/usage-store.js` (module does not exist).

- [ ] **Step 6: Implement the store**

Create `packages/server/src/limits/usage-store.ts`:

```ts
import { and, eq, gte, lt, max, sql, sum } from 'drizzle-orm';
import type { AdminDenialSummary, AdminRouteVolume } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { UsageSnapshot, UsageTracker } from './usage-tracker.js';

const HOUR_MS = 3_600_000;
// Keeps each multi-row upsert well under SQLite's bound-parameter ceiling (7 columns × 200 rows).
const FLUSH_CHUNK = 200;

export function truncateToHourIso(date: Date): string {
  return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS).toISOString();
}

/** Start of the hour bucket `hours` before `now` — the inclusive lower bound of a window. */
export function windowStartIso(now: Date, hours: number): string {
  return truncateToHourIso(new Date(now.getTime() - hours * HOUR_MS));
}

function* chunks<T>(rows: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

/**
 * Adds a tracker snapshot into the hourly tables in one transaction. Counts are
 * summed into existing rows (`count + excluded.count`), so flushing the same hour
 * twice accumulates rather than overwrites. `first_at` keeps the earliest value
 * because snapshots are flushed in order.
 */
export async function flushUsage(db: Db, snapshot: UsageSnapshot): Promise<void> {
  if (snapshot.requests.length === 0 && snapshot.denials.length === 0) return;
  const { apiUsageHourly: usage, limitDenialsHourly: denials } = schema;

  await db.transaction(async (tx) => {
    for (const chunk of chunks(snapshot.requests, FLUSH_CHUNK)) {
      await tx
        .insert(usage)
        .values(chunk.map((r) => ({
          subjectType: r.subjectType,
          subjectId: r.subjectId,
          route: r.route,
          hourStart: r.hourStart,
          count: r.count,
        })))
        .onConflictDoUpdate({
          target: [usage.subjectType, usage.subjectId, usage.route, usage.hourStart],
          set: { count: sql`${usage.count} + ${sql.raw('excluded.count')}` },
        });
    }
    for (const chunk of chunks(snapshot.denials, FLUSH_CHUNK)) {
      await tx
        .insert(denials)
        .values(chunk.map((d) => ({
          subjectType: d.subjectType,
          subjectId: d.subjectId,
          limitKey: d.limitKey,
          hourStart: d.hourStart,
          count: d.count,
          firstAt: d.firstAt,
          lastAt: d.lastAt,
        })))
        .onConflictDoUpdate({
          target: [denials.subjectType, denials.subjectId, denials.limitKey, denials.hourStart],
          set: {
            count: sql`${denials.count} + ${sql.raw('excluded.count')}`,
            lastAt: sql.raw('excluded.last_at'),
          },
        });
    }
  });
}

/** Deletes hourly rows whose bucket starts before `olderThanIso`. */
export async function pruneUsage(db: Db, olderThanIso: string): Promise<void> {
  await db.delete(schema.apiUsageHourly).where(lt(schema.apiUsageHourly.hourStart, olderThanIso));
  await db.delete(schema.limitDenialsHourly).where(lt(schema.limitDenialsHourly.hourStart, olderThanIso));
}

/** Removes a user's usage history. Call inside the user-delete transaction. */
export async function deleteUsageForUser(tx: Pick<Db, 'delete'>, userId: string): Promise<void> {
  await tx
    .delete(schema.apiUsageHourly)
    .where(and(eq(schema.apiUsageHourly.subjectType, 'user'), eq(schema.apiUsageHourly.subjectId, userId)));
  await tx
    .delete(schema.limitDenialsHourly)
    .where(and(eq(schema.limitDenialsHourly.subjectType, 'user'), eq(schema.limitDenialsHourly.subjectId, userId)));
}

/** One subject's total in a window and the route (or limit key) contributing most. */
export interface TopConsumerRow {
  subjectType: 'user' | 'ip';
  subjectId: string;
  count: number;
  top: string | null;
}

interface Contribution {
  subjectType: 'user' | 'ip';
  subjectId: string;
  key: string;
  count: number;
}

/** Unflushed rows at or after `sinceIso`, in the same shape as the grouped DB rows. */
function bufferedContributions(
  tracker: UsageTracker,
  metric: 'requests' | 'denials',
  sinceIso: string,
): Contribution[] {
  const view = tracker.snapshotView();
  const rows = metric === 'requests'
    ? view.requests.map((r) => ({ subjectType: r.subjectType, subjectId: r.subjectId, key: r.route, hourStart: r.hourStart, count: r.count }))
    : view.denials.map((d) => ({ subjectType: d.subjectType, subjectId: d.subjectId, key: d.limitKey, hourStart: d.hourStart, count: d.count }));
  return rows
    .filter((r) => r.hourStart >= sinceIso)
    .map(({ subjectType, subjectId, key, count }) => ({ subjectType, subjectId, key, count }));
}

/**
 * Subjects ranked by requests or denials since `sinceIso`, merging the tracker's
 * unflushed buffer so the panel is current to the request, not the last flush.
 * Ranking happens in memory: the grouped row count is bounded by retention ×
 * subjects × routes, and the merge with the buffer needs per-key totals anyway.
 */
export async function topConsumers(
  db: Db,
  tracker: UsageTracker,
  opts: { sinceIso: string; metric: 'requests' | 'denials'; limit: number },
): Promise<TopConsumerRow[]> {
  const stored: Contribution[] = opts.metric === 'requests'
    ? (await db
        .select({
          subjectType: schema.apiUsageHourly.subjectType,
          subjectId: schema.apiUsageHourly.subjectId,
          key: schema.apiUsageHourly.route,
          total: sum(schema.apiUsageHourly.count),
        })
        .from(schema.apiUsageHourly)
        .where(gte(schema.apiUsageHourly.hourStart, opts.sinceIso))
        .groupBy(schema.apiUsageHourly.subjectType, schema.apiUsageHourly.subjectId, schema.apiUsageHourly.route))
        .map((r) => ({ subjectType: r.subjectType, subjectId: r.subjectId, key: r.key, count: Number(r.total ?? 0) }))
    : (await db
        .select({
          subjectType: schema.limitDenialsHourly.subjectType,
          subjectId: schema.limitDenialsHourly.subjectId,
          key: schema.limitDenialsHourly.limitKey,
          total: sum(schema.limitDenialsHourly.count),
        })
        .from(schema.limitDenialsHourly)
        .where(gte(schema.limitDenialsHourly.hourStart, opts.sinceIso))
        .groupBy(
          schema.limitDenialsHourly.subjectType,
          schema.limitDenialsHourly.subjectId,
          schema.limitDenialsHourly.limitKey,
        ))
        .map((r) => ({ subjectType: r.subjectType, subjectId: r.subjectId, key: r.key, count: Number(r.total ?? 0) }));

  const bySubject = new Map<string, { subjectType: 'user' | 'ip'; subjectId: string; perKey: Map<string, number> }>();
  for (const c of [...stored, ...bufferedContributions(tracker, opts.metric, opts.sinceIso)]) {
    const id = `${c.subjectType}:${c.subjectId}`;
    let entry = bySubject.get(id);
    if (!entry) {
      entry = { subjectType: c.subjectType, subjectId: c.subjectId, perKey: new Map() };
      bySubject.set(id, entry);
    }
    entry.perKey.set(c.key, (entry.perKey.get(c.key) ?? 0) + c.count);
  }

  const ranked: TopConsumerRow[] = [...bySubject.values()].map((e) => {
    let total = 0;
    let top: string | null = null;
    let topCount = -1;
    for (const [key, n] of e.perKey) {
      total += n;
      if (n > topCount) {
        top = key;
        topCount = n;
      }
    }
    return { subjectType: e.subjectType, subjectId: e.subjectId, count: total, top };
  });
  ranked.sort((a, b) => b.count - a.count || a.subjectId.localeCompare(b.subjectId));
  return ranked.slice(0, opts.limit);
}

/** A user's request count per route since `sinceIso`, highest first, flushed + buffered. */
export async function userRequestVolume(
  db: Db,
  tracker: UsageTracker,
  userId: string,
  sinceIso: string,
  limit: number,
): Promise<AdminRouteVolume[]> {
  const t = schema.apiUsageHourly;
  const rows = await db
    .select({ route: t.route, total: sum(t.count) })
    .from(t)
    .where(and(eq(t.subjectType, 'user'), eq(t.subjectId, userId), gte(t.hourStart, sinceIso)))
    .groupBy(t.route);

  const byRoute = new Map(rows.map((r) => [r.route, Number(r.total ?? 0)]));
  for (const c of bufferedContributions(tracker, 'requests', sinceIso)) {
    if (c.subjectType === 'user' && c.subjectId === userId) {
      byRoute.set(c.key, (byRoute.get(c.key) ?? 0) + c.count);
    }
  }
  return [...byRoute]
    .map(([route, count]) => ({ route, count }))
    .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route))
    .slice(0, limit);
}

/** A user's denials per limit key since `sinceIso`, with the latest denial time. */
export async function userDenials(
  db: Db,
  tracker: UsageTracker,
  userId: string,
  sinceIso: string,
): Promise<AdminDenialSummary[]> {
  const t = schema.limitDenialsHourly;
  const rows = await db
    .select({ limitKey: t.limitKey, total: sum(t.count), lastAt: max(t.lastAt) })
    .from(t)
    .where(and(eq(t.subjectType, 'user'), eq(t.subjectId, userId), gte(t.hourStart, sinceIso)))
    .groupBy(t.limitKey);

  const byKey = new Map(rows.map((r) => [r.limitKey, { count: Number(r.total ?? 0), lastAt: r.lastAt ?? '' }]));
  for (const d of tracker.snapshotView().denials) {
    if (d.subjectType !== 'user' || d.subjectId !== userId || d.hourStart < sinceIso) continue;
    const prev = byKey.get(d.limitKey) ?? { count: 0, lastAt: '' };
    byKey.set(d.limitKey, { count: prev.count + d.count, lastAt: d.lastAt > prev.lastAt ? d.lastAt : prev.lastAt });
  }
  return [...byKey]
    .map(([limitKey, v]) => ({ limitKey, count: v.count, lastAt: v.lastAt }))
    .sort((a, b) => b.count - a.count || a.limitKey.localeCompare(b.limitKey));
}
```

- [ ] **Step 7: Run the store test**

Run: `pnpm --filter server exec vitest run tests/limits/usage-store.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 8: Write the failing worker test**

Create `packages/server/tests/workers/usage-rollup.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../helpers/app.js';
import { schema } from '../../src/db/index.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { UsageTracker } from '../../src/limits/usage-tracker.js';
import { flushUsage } from '../../src/limits/usage-store.js';
import { runUsageRollupTick, startUsageRollupWorker } from '../../src/workers/usage-rollup.js';

const T0 = Date.UTC(2026, 9, 14, 13, 25, 0);
const DAY = 86_400_000;

describe('usage-rollup worker', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    db = await createTestDb();
    await db.delete(schema.apiUsageHourly);
    await db.delete(schema.limitDenialsHourly);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes the buffer and prunes rows past retention in one tick', async () => {
    let clock = T0 - 10 * DAY;
    const tracker = new UsageTracker({ now: () => clock });
    tracker.recordRequest({ type: 'user', id: 'u1' }, 'GET /games');
    await flushUsage(db, tracker.swap());

    clock = T0;
    tracker.recordRequest({ type: 'user', id: 'u1' }, 'POST /games');
    tracker.recordDenial({ type: 'user', id: 'u1' }, 'gamesCreated');
    await runUsageRollupTick({
      db,
      tracker,
      config: RuntimeConfig.fromEnvironment({ USAGE_RETENTION_DAYS: 7 }),
      now: () => new Date(T0),
    });

    const usage = await db.select().from(schema.apiUsageHourly);
    expect(usage.map((r) => r.route)).toEqual(['POST /games']);
    expect(await db.select().from(schema.limitDenialsHourly)).toHaveLength(1);
    expect(tracker.snapshotView().requests).toHaveLength(0);
  });

  it('warns when the tracker overflowed', async () => {
    const tracker = new UsageTracker({ maxRequestKeys: 1, now: () => T0 });
    tracker.recordRequest({ type: 'user', id: 'a' }, 'GET /games');
    tracker.recordRequest({ type: 'user', id: 'b' }, 'GET /games');
    const warn = vi.fn();
    await runUsageRollupTick({
      db,
      tracker,
      config: RuntimeConfig.fromEnvironment(),
      logger: { warn } as unknown as import('fastify').FastifyBaseLogger,
      now: () => new Date(T0),
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('runs on its interval and stops cleanly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const tracker = new UsageTracker();
    const worker = startUsageRollupWorker({
      db,
      tracker,
      config: RuntimeConfig.fromEnvironment(),
      intervalMs: 1000,
    });
    tracker.recordRequest({ type: 'ip', id: '198.51.100.1' }, 'GET /stocks/search');

    await vi.advanceTimersByTimeAsync(1000);
    expect(await db.select().from(schema.apiUsageHourly)).toHaveLength(1);

    await worker.stop();
  });
});
```

- [ ] **Step 9: Run it and confirm it fails**

Run: `pnpm --filter server exec vitest run tests/workers/usage-rollup.test.ts`
Expected: FAIL — cannot load `../../src/workers/usage-rollup.js`.

- [ ] **Step 10: Implement the worker**

Create `packages/server/src/workers/usage-rollup.ts`:

```ts
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import type { ConfigReader } from '../config/runtime-config.js';
import type { UsageTracker } from '../limits/usage-tracker.js';
import { flushUsage, pruneUsage, truncateToHourIso } from '../limits/usage-store.js';
import { startIntervalWorker, type IntervalWorker } from './interval-worker.js';

const DAY_MS = 86_400_000;

/** Dependencies for {@link runUsageRollupTick} and {@link startUsageRollupWorker}. */
export interface UsageRollupDeps {
  db: Db;
  tracker: UsageTracker;
  config: ConfigReader;
  logger?: FastifyBaseLogger;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/**
 * One rollup tick: take the tracker's buffered counts, add them to the hourly
 * tables, then drop rows older than `USAGE_RETENTION_DAYS`. The buffer is
 * swapped before the write, so a failed write loses that interval's counts —
 * acceptable for monitoring data, and it keeps requests from ever waiting on it.
 */
export async function runUsageRollupTick(deps: UsageRollupDeps): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const snapshot = deps.tracker.swap();
  if (snapshot.overflow.requests + snapshot.overflow.denials > 0) {
    deps.logger?.warn(
      { overflowRequests: snapshot.overflow.requests, overflowDenials: snapshot.overflow.denials },
      'usage tracker hit its key bound; excess counted under the *overflow* subject',
    );
  }
  await flushUsage(deps.db, snapshot);
  const retentionMs = deps.config.get('USAGE_RETENTION_DAYS') * DAY_MS;
  await pruneUsage(deps.db, truncateToHourIso(new Date(now.getTime() - retentionMs)));
}

/** Starts the rollup loop at `USAGE_FLUSH_INTERVAL_MS`. */
export function startUsageRollupWorker(
  deps: UsageRollupDeps & { intervalMs?: number },
): IntervalWorker {
  return startIntervalWorker(
    'usage-rollup',
    () => runUsageRollupTick(deps),
    deps.intervalMs ?? (() => deps.config.get('USAGE_FLUSH_INTERVAL_MS')),
    (err) => deps.logger?.error({ err }, 'usage rollup tick failed'),
  );
}
```

- [ ] **Step 11: Run the worker test**

Run: `pnpm --filter server exec vitest run tests/workers/usage-rollup.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 12: Wire the worker into `buildApp`**

In `packages/server/src/app.ts`, add imports beside the other worker imports:

```ts
import { startUsageRollupWorker } from './workers/usage-rollup.js';
import { flushUsage } from './limits/usage-store.js';
```

Inside the `if (!disablePoller) {` block, directly after the `discoverWorker` `onClose` hook, add (`limits` is the object Task 8 builds with `createLimits`):

```ts
    const tracker = limits.tracker;
    const usageWorker = startUsageRollupWorker({ db, tracker, config: runtimeConfig, logger: app.log });
    app.addHook('onClose', async () => {
      await usageWorker.stop();
      // Counts gathered since the last tick; a graceful shutdown loses nothing.
      await flushUsage(db, tracker.swap());
    });
```

- [ ] **Step 13: Write the failing user-delete test**

Create `packages/server/tests/limits/usage-user-delete.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestAppWithDb, registerAdmin, type createTestDb } from '../helpers/app.js';
import { registerUser } from '../helpers/users.js';
import { schema } from '../../src/db/index.js';

describe('DELETE /admin/users/:id removes usage history', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let admin: { authorization: string };

  beforeAll(async () => {
    ({ app, db } = await createTestAppWithDb());
    admin = { authorization: `Bearer ${(await registerAdmin(app, 'usage-del-admin')).token}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('deletes the user’s rows and leaves everyone else’s', async () => {
    const victim = await registerUser(app, 'usage-del-victim');
    const bystander = await registerUser(app, 'usage-del-bystander');
    await db.insert(schema.apiUsageHourly).values([
      { subjectType: 'user', subjectId: victim.userId, route: 'GET /games', hourStart: '2026-10-14T13:00:00.000Z', count: 4 },
      { subjectType: 'user', subjectId: bystander.userId, route: 'GET /games', hourStart: '2026-10-14T13:00:00.000Z', count: 1 },
    ]);
    await db.insert(schema.limitDenialsHourly).values({
      subjectType: 'user', subjectId: victim.userId, limitKey: 'trades',
      hourStart: '2026-10-14T13:00:00.000Z', count: 2,
      firstAt: '2026-10-14T13:01:00.000Z', lastAt: '2026-10-14T13:02:00.000Z',
    });

    const res = await app.inject({ method: 'DELETE', url: `/admin/users/${victim.userId}?force=true`, headers: admin });
    expect(res.statusCode).toBe(204);

    const usage = await db.select().from(schema.apiUsageHourly);
    expect(usage.map((r) => r.subjectId)).toEqual([bystander.userId]);
    expect(await db.select().from(schema.limitDenialsHourly)).toHaveLength(0);
  });
});
```

Run: `pnpm --filter server exec vitest run tests/limits/usage-user-delete.test.ts`
Expected: FAIL — `expected [ victimId, bystanderId ] to deeply equal [ bystanderId ]`.

- [ ] **Step 14: Delete usage rows in the user-delete transaction**

In `packages/server/src/routes/admin/users.ts`, add the import:

```ts
import { deleteUsageForUser } from '../../limits/usage-store.js';
```

and change the transaction in `app.delete('/admin/users/:id', …)` from:

```ts
      await db.transaction(async (tx) => {
        await tx.delete(users).where(eq(users.id, id));
```

to:

```ts
      await db.transaction(async (tx) => {
        // Usage rows have no FK (a subject may be an IP), so they don't cascade.
        await deleteUsageForUser(tx, id);
        await tx.delete(users).where(eq(users.id, id));
```

Run: `pnpm --filter server exec vitest run tests/limits/usage-user-delete.test.ts tests/admin`
Expected: PASS.

- [ ] **Step 15: Full server check and commit**

Run: `pnpm typecheck && pnpm --filter server exec vitest run`
Expected: typecheck clean; all server tests pass.

```bash
git add packages/server/src/env.ts packages/server/src/config/registry.ts \
  packages/server/src/db/schema.sqlite.ts packages/server/src/db/schema.pg.ts \
  packages/server/drizzle packages/server/src/limits/usage-store.ts \
  packages/server/src/workers/usage-rollup.ts packages/server/src/app.ts \
  packages/server/src/routes/admin/users.ts packages/server/tests/limits/usage-store.test.ts \
  packages/server/tests/workers/usage-rollup.test.ts packages/server/tests/limits/usage-user-delete.test.ts
git commit -m "feat(limits): roll per-user usage and denials up into hourly tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Admin limits API

These are the admin endpoints behind the limits page and the per-user "Limits & usage" card:
- the policy summary, including the caller's IP as the server sees it
- top consumers
- every active override
- one user's effective limits with usage, plus override set and clear

**Files:**
- Create: `packages/server/src/routes/admin/limits.ts`
- Modify: `packages/server/src/routes/admin/index.ts`
- Modify: `packages/server/src/app.ts` (pass the new dependencies to `adminRoutes`)
- Test: `packages/server/tests/routes/admin-limits.test.ts`

**Interfaces:**
- Consumes (Task 6): `LIMIT_KEYS`, `LimitKey`, and the admin DTOs from `@markettrader/shared`: `AdminLimitPolicy`, `AdminTopConsumersResponse`, `AdminUserLimitRow`, `AdminUserLimitsResponse`, `AdminLimitOverrideEntry`. Also `LIMIT_CATALOGUE` from `S/limits/catalogue.ts`, `isMatureUser`, `maturityEndsAt`, `isPrivilegedConnection` from `S/limits/policy.ts`, and `descriptorFor` from `S/config/registry.ts`.
- Consumes (Task 7): `loadAccount(db, userId)` and `toIsoUtc(value)` from `S/limits/account.ts`; `users.registrationIp`; `LimitOverridesService.listForUser`, `.set`, `.clear`, `.listAll`.
- Consumes (Task 8, Task 14): `Limits` (`config`, `resolver.resolveForUser`, `resolver.baseValue`, `overrides`, non-null `tracker`).
- Consumes (Task 9): `countGamesCreatedSince`, `countActiveGamesOwned`, `countGamesJoinedSince`, `countActiveGamesJoined`, `windowStart` from `S/limits/quota-counts.ts` (window bounds must come from `windowStart`, which matches the stored timestamp format).
- Consumes (Task 12): `countForUser(userId: string): number` on both `GameClientRegistry` and `GlobalClientRegistry`. Task 12 adds this for the `wsConnections` check at upgrade.
- Consumes (Task 15): `topConsumers`, `userRequestVolume`, `userDenials`, `windowStartIso`.
- Produces: `adminLimitsRoutes(db: Db, limits: Limits, config: ConfigReader, wsConnectionCount: (userId: string) => number)`. The admin endpoints:

  | Method and path | Response |
  |---|---|
  | `GET /admin/limits/policy` | `AdminLimitPolicy` |
  | `GET /admin/limits/top?window=24h\|7d&metric=requests\|denials&limit=1..100` | `AdminTopConsumersResponse` |
  | `GET /admin/limits/overrides` | `AdminLimitOverrideEntry[]` (a bare array) |
  | `GET /admin/users/:id/limits` | `AdminUserLimitsResponse` |
  | `PUT /admin/users/:id/limits/:key` | body `{ value, note? }`, returns `AdminUserLimitRow` |
  | `DELETE /admin/users/:id/limits/:key` | `AdminUserLimitRow` |

  Errors:
  - 404 `{ error: 'User not found' }`
  - 404 `{ code: 'UNKNOWN_LIMIT_KEY', message }`
  - 409 `{ code: 'LIMIT_NOT_OVERRIDABLE', message }`
  - 400 `{ code: 'INVALID_LIMIT_VALUE', message }`

- [ ] **Step 1: Write the failing route test**

Create `packages/server/tests/routes/admin-limits.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type {
  AdminLimitOverrideEntry,
  AdminLimitPolicy,
  AdminTopConsumersResponse,
  AdminUserLimitRow,
  AdminUserLimitsResponse,
} from '@markettrader/shared';
import { createTestAppWithDb, registerAdmin, type createTestDb } from '../helpers/app.js';
import { registerUser } from '../helpers/users.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { schema } from '../../src/db/index.js';

const DAY = 86_400_000;

function gamePayload(name: string) {
  const now = Date.now();
  return {
    name,
    startDate: new Date(now).toISOString(),
    endDate: new Date(now + 30 * DAY).toISOString(),
    startingBalance: 100_000,
  };
}

describe('/admin/limits and /admin/users/:id/limits', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let admin: { authorization: string };
  let member: { authorization: string };
  let memberId: string;

  beforeAll(async () => {
    ({ app, db } = await createTestAppWithDb(undefined, undefined, {
      limits: { disabled: false },
      runtimeConfig: RuntimeConfig.fromEnvironment({
        LIMITS_PRIVILEGED_CIDRS: '10.0.0.0/8',
        LIMIT_REGISTRATIONS_PER_IP_PER_DAY: 100,
      }),
    }));
    admin = { authorization: `Bearer ${(await registerAdmin(app, 'lim-admin')).token}` };
    const m = await registerUser(app, 'lim-member');
    member = { authorization: `Bearer ${m.token}` };
    memberId = m.userId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated (401) and non-admin (403) callers', async () => {
    for (const url of ['/admin/limits/policy', '/admin/limits/top', '/admin/limits/overrides', `/admin/users/${memberId}/limits`]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url, headers: member })).statusCode).toBe(403);
    }
    const put = await app.inject({
      method: 'PUT', url: `/admin/users/${memberId}/limits/gamesCreated`, headers: member, payload: { value: 5 },
    });
    expect(put.statusCode).toBe(403);
  });

  it('reports the policy and the caller IP as the server sees it', async () => {
    const privileged = await app.inject({
      method: 'GET', url: '/admin/limits/policy', headers: admin, remoteAddress: '10.1.2.3',
    });
    expect(privileged.statusCode).toBe(200);
    expect(privileged.json<AdminLimitPolicy>()).toMatchObject({
      enabled: true,
      maturityDays: 7,
      probationPercent: 25,
      privilegedCidrs: ['10.0.0.0/8'],
      privilegedMultiplier: 10,
      requestIp: '10.1.2.3',
      requestIpPrivileged: true,
    });

    const outside = await app.inject({
      method: 'GET', url: '/admin/limits/policy', headers: admin, remoteAddress: '203.0.113.7',
    });
    expect(outside.json<AdminLimitPolicy>()).toMatchObject({ requestIp: '203.0.113.7', requestIpPrivileged: false });
  });

  it('shows a new user on probation with live usage counts', async () => {
    const created = await app.inject({ method: 'POST', url: '/games', headers: member, payload: gamePayload('lim g1') });
    expect(created.statusCode).toBe(201);

    const res = await app.inject({ method: 'GET', url: `/admin/users/${memberId}/limits`, headers: admin });
    expect(res.statusCode).toBe(200);
    const body = res.json<AdminUserLimitsResponse>();
    expect(body.userId).toBe(memberId);
    expect(body.mature).toBe(false);
    expect(body.probationEndsAt).not.toBeNull();
    expect(body.privilegedMultiplier).toBe(10);

    const gamesCreated = body.rows.find((r) => r.key === 'gamesCreated')!;
    expect(gamesCreated).toMatchObject({
      kind: 'quota',
      configKey: 'LIMIT_GAMES_CREATED_PER_WEEK',
      baseValue: 10,
      effectiveMax: 3,
      basis: 'probation',
      override: null,
      used: 1,
      overridable: true,
    });
    expect(body.rows.find((r) => r.key === 'activeGamesJoined')!.used).toBe(1);
    expect(body.rows.find((r) => r.key === 'wsConnections')!.used).toBe(0);
    expect(body.rows.find((r) => r.key === 'registrationsPerIp')!.overridable).toBe(false);
    expect(body.rows.map((r) => r.key)).toHaveLength(14);
  });

  // Review Focus #4: an override below current usage is reported as-is (used > max), not clamped.
  it('reports usage above an override that was lowered beneath it', async () => {
    // Its own user: the shared member's game count feeds the top-consumers test below.
    const owner = await registerUser(app, 'lim-lowered');
    for (const name of ['low g1', 'low g2']) {
      const res = await app.inject({ method: 'POST', url: '/games', headers: owner.headers, payload: gamePayload(name) });
      expect(res.statusCode).toBe(201);
    }
    const put = await app.inject({
      method: 'PUT',
      url: `/admin/users/${owner.userId}/limits/activeGamesOwned`,
      headers: admin,
      payload: { value: 1, note: 'below usage' },
    });
    expect(put.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: `/admin/users/${owner.userId}/limits`, headers: admin });
    const row = res.json<AdminUserLimitsResponse>().rows.find((r) => r.key === 'activeGamesOwned')!;
    expect(row).toMatchObject({ basis: 'override', effectiveMax: 1, used: 2 });
  });

  it('marks an admin as immune', async () => {
    const self = await app.inject({ method: 'GET', url: '/admin/users', headers: admin });
    const adminId = self.json<{ users: { id: string; username: string }[] }>().users.find((u) => u.username === 'lim-admin')!.id;
    const res = await app.inject({ method: 'GET', url: `/admin/users/${adminId}/limits`, headers: admin });
    const row = res.json<AdminUserLimitsResponse>().rows.find((r) => r.key === 'trades')!;
    expect(row).toMatchObject({ basis: 'admin', effectiveMax: null });
  });

  it('sets, lists, audits, and clears an override', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/admin/users/${memberId}/limits/gamesCreated`,
      headers: admin,
      payload: { value: 40, note: 'office organiser' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json<AdminUserLimitRow>()).toMatchObject({
      key: 'gamesCreated',
      effectiveMax: 40,
      basis: 'override',
      override: { value: 40, note: 'office organiser' },
    });

    const list = await app.inject({ method: 'GET', url: '/admin/limits/overrides', headers: admin });
    expect(list.json<AdminLimitOverrideEntry[]>()).toContainEqual(
      expect.objectContaining({ userId: memberId, username: 'lim-member', key: 'gamesCreated', value: 40 }),
    );

    const audit = await db
      .select()
      .from(schema.adminAuditLog)
      .where(and(eq(schema.adminAuditLog.action, 'user.limit.override'), eq(schema.adminAuditLog.targetId, memberId)));
    expect(audit).toHaveLength(1);

    const del = await app.inject({ method: 'DELETE', url: `/admin/users/${memberId}/limits/gamesCreated`, headers: admin });
    expect(del.statusCode).toBe(200);
    expect(del.json<AdminUserLimitRow>()).toMatchObject({ basis: 'probation', effectiveMax: 3, override: null });

    const reset = await db
      .select()
      .from(schema.adminAuditLog)
      .where(and(eq(schema.adminAuditLog.action, 'user.limit.reset'), eq(schema.adminAuditLog.targetId, memberId)));
    expect(reset).toHaveLength(1);
  });

  it('validates override keys and values', async () => {
    const put = (key: string, payload: unknown, id = memberId) =>
      app.inject({ method: 'PUT', url: `/admin/users/${id}/limits/${key}`, headers: admin, payload });

    const unknownKey = await put('notALimit', { value: 5 });
    expect(unknownKey.statusCode).toBe(404);
    expect(unknownKey.json()).toMatchObject({ code: 'UNKNOWN_LIMIT_KEY' });

    const ipKind = await put('registrationsPerIp', { value: 5 });
    expect(ipKind.statusCode).toBe(409);
    expect(ipKind.json()).toMatchObject({ code: 'LIMIT_NOT_OVERRIDABLE' });

    // LIMIT_GAMES_CREATED_PER_WEEK's registry ceiling is 10 000.
    const tooHigh = await put('gamesCreated', { value: 10_001 });
    expect(tooHigh.statusCode).toBe(400);
    expect(tooHigh.json()).toMatchObject({ code: 'INVALID_LIMIT_VALUE' });

    expect((await put('gamesCreated', { value: 0 })).statusCode).toBe(400);
    expect((await put('gamesCreated', { value: 2.5 })).statusCode).toBe(400);
    expect((await put('gamesCreated', { value: 5, note: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await put('gamesCreated', { value: 5 }, 'no-such-user')).statusCode).toBe(404);
  });

  it('lists accounts sharing a registration IP', async () => {
    const a = await registerUser(app, 'lim-sib-a', { remoteAddress: '192.0.2.77' });
    const b = await registerUser(app, 'lim-sib-b', { remoteAddress: '192.0.2.77' });

    const res = await app.inject({ method: 'GET', url: `/admin/users/${a.userId}/limits`, headers: admin });
    const body = res.json<AdminUserLimitsResponse>();
    expect(body.registrationIp).toBe('192.0.2.77');
    expect(body.siblingAccounts.map((s) => s.id)).toEqual([b.userId]);
    expect(body.rows.find((r) => r.key === 'registrationsPerIp')!.used).toBe(2);
  });

  it('ranks top consumers and shows a user’s volume and denials', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'GET', url: '/games', headers: member })).statusCode).toBe(200);
    }
    // Force a denial: an override of 1 while the member already created one game this week.
    await app.inject({
      method: 'PUT', url: `/admin/users/${memberId}/limits/gamesCreated`, headers: admin, payload: { value: 1 },
    });
    const denied = await app.inject({ method: 'POST', url: '/games', headers: member, payload: gamePayload('lim g2') });
    expect(denied.statusCode).toBe(429);

    const top = await app.inject({ method: 'GET', url: '/admin/limits/top?metric=requests&window=24h', headers: admin });
    expect(top.statusCode).toBe(200);
    const topBody = top.json<AdminTopConsumersResponse>();
    expect(topBody).toMatchObject({ window: '24h', metric: 'requests' });
    const memberRow = topBody.rows.find((r) => r.subjectId === memberId)!;
    expect(memberRow).toMatchObject({ subjectType: 'user', username: 'lim-member' });
    expect(memberRow.count).toBeGreaterThanOrEqual(3);

    const denials = await app.inject({ method: 'GET', url: '/admin/limits/top?metric=denials', headers: admin });
    expect(denials.json<AdminTopConsumersResponse>().rows).toContainEqual(
      expect.objectContaining({ subjectId: memberId, top: 'gamesCreated' }),
    );

    const detail = await app.inject({ method: 'GET', url: `/admin/users/${memberId}/limits`, headers: admin });
    const body = detail.json<AdminUserLimitsResponse>();
    expect(body.requestVolume7d).toContainEqual(expect.objectContaining({ route: 'GET /games' }));
    expect(body.denials7d).toContainEqual(expect.objectContaining({ limitKey: 'gamesCreated', count: 1 }));

    const bad = await app.inject({ method: 'GET', url: '/admin/limits/top?window=1y', headers: admin });
    expect(bad.statusCode).toBe(400);

    await app.inject({ method: 'DELETE', url: `/admin/users/${memberId}/limits/gamesCreated`, headers: admin });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm build:shared && pnpm --filter server exec vitest run tests/routes/admin-limits.test.ts`
Expected: FAIL. The first test gets 404 instead of 401, because the routes don't exist yet.

- [ ] **Step 3: Implement the routes**

Create `packages/server/src/routes/admin/limits.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, count, eq, inArray } from 'drizzle-orm';
import {
  LIMIT_KEYS,
  type AdminLimitOverrideEntry,
  type AdminLimitPolicy,
  type AdminTopConsumersResponse,
  type AdminUserLimitRow,
  type AdminUserLimitsResponse,
  type LimitKey,
} from '@markettrader/shared';
import type { Db } from '../../db/index.js';
import { schema } from '../../db/index.js';
import type { ConfigReader } from '../../config/runtime-config.js';
import { descriptorFor } from '../../config/registry.js';
import type { Limits } from '../../limits/index.js';
import { LIMIT_CATALOGUE } from '../../limits/catalogue.js';
import { isMatureUser, isPrivilegedConnection, maturityEndsAt } from '../../limits/policy.js';
import { loadAccount, toIsoUtc, type RequestAccount } from '../../limits/account.js';
import {
  countActiveGamesJoined,
  countActiveGamesOwned,
  countGamesCreatedSince,
  countGamesJoinedSince,
  windowStart,
} from '../../limits/quota-counts.js';
import { topConsumers, userDenials, userRequestVolume, windowStartIso } from '../../limits/usage-store.js';

const DAY_MS = 86_400_000;
const WEEK_HOURS = 24 * 7;
const SIBLING_LIMIT = 50;
const VOLUME_TOP_N = 10;

const userParams = z.object({ id: z.string().min(1).max(64) });
const userKeyParams = z.object({ id: z.string().min(1).max(64), key: z.string().min(1).max(64) });
const setBody = z.object({ value: z.number().int().min(1), note: z.string().max(500).optional() });
const topQuery = z.object({
  window: z.enum(['24h', '7d']).optional().default('24h'),
  metric: z.enum(['requests', 'denials']).optional().default('requests'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

function isLimitKey(raw: string): raw is LimitKey {
  return (LIMIT_KEYS as readonly string[]).includes(raw);
}

/** The registry's `max` for the limit's config key — an override may exceed the default, not this. */
function overrideCeiling(key: LimitKey): number | undefined {
  const descriptor = descriptorFor(LIMIT_CATALOGUE[key].configKey);
  return descriptor.mutability === 'live' ? descriptor.max : undefined;
}

type KeyCheck = { ok: true; key: LimitKey } | { ok: false; status: 404 | 409; code: string; message: string };

function checkOverridableKey(raw: string): KeyCheck {
  if (!isLimitKey(raw)) {
    return { ok: false, status: 404, code: 'UNKNOWN_LIMIT_KEY', message: `No limit named ${raw}.` };
  }
  if (!LIMIT_CATALOGUE[raw].overridable) {
    return {
      ok: false,
      status: 409,
      code: 'LIMIT_NOT_OVERRIDABLE',
      message: `${raw} applies per IP address, not per user, so it has no per-user override.`,
    };
  }
  return { ok: true, key: raw };
}

interface TargetUser {
  account: RequestAccount;
  username: string;
  registrationIp: string | null;
}

/**
 * Admin endpoints for user limits (all `requireAdmin`):
 *   GET    /admin/limits/policy           — policy options plus the caller's IP as the server sees it
 *   GET    /admin/limits/top              — subjects ranked by requests or denials
 *   GET    /admin/limits/overrides        — every active per-user override
 *   GET    /admin/users/:id/limits        — one user's effective limits, usage, and history
 *   PUT    /admin/users/:id/limits/:key   — set an override (audited)
 *   DELETE /admin/users/:id/limits/:key   — clear an override (audited when one existed)
 *
 * `wsConnectionCount` reads the live socket registries; it is injected so this
 * module does not depend on the WS layer.
 */
export function adminLimitsRoutes(
  db: Db,
  limits: Limits,
  config: ConfigReader,
  wsConnectionCount: (userId: string) => number,
) {
  const { users, gamePlayers, trades, watchlists, watchlistItems } = schema;

  async function loadTarget(id: string): Promise<TargetUser | undefined> {
    const account = await loadAccount(db, id);
    if (!account) return undefined;
    const [row] = await db
      .select({ username: users.username, registrationIp: users.registrationIp })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!row) return undefined;
    return {
      account: { id: account.id, createdAt: account.createdAt, isAdmin: account.isAdmin },
      username: row.username,
      registrationIp: row.registrationIp,
    };
  }

  /** Accounts registered from `ip`, oldest first, including the target itself. */
  async function accountsFromIp(ip: string) {
    const rows = await db
      .select({ id: users.id, username: users.username, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.registrationIp, ip))
      .limit(SIBLING_LIMIT + 1);
    return rows
      .map((r) => ({ id: r.id, username: r.username, createdAt: toIsoUtc(r.createdAt) }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async function maxOpenOrdersInAnyGame(userId: string): Promise<number> {
    const rows = await db
      .select({ c: count() })
      .from(trades)
      .innerJoin(gamePlayers, eq(trades.gamePlayerId, gamePlayers.id))
      .where(and(eq(gamePlayers.userId, userId), inArray(trades.status, ['working', 'pending'])))
      .groupBy(trades.gamePlayerId);
    return rows.reduce((m, r) => Math.max(m, Number(r.c)), 0);
  }

  async function maxItemsInAnyWatchlist(userId: string): Promise<number> {
    const rows = await db
      .select({ c: count() })
      .from(watchlistItems)
      .innerJoin(watchlists, eq(watchlistItems.watchlistId, watchlists.id))
      .where(eq(watchlists.userId, userId))
      .groupBy(watchlistItems.watchlistId);
    return rows.reduce((m, r) => Math.max(m, Number(r.c)), 0);
  }

  /**
   * Current usage against `key`. Rate limits other than `apiRequests` live in
   * `@fastify/rate-limit`'s store, which exposes no read API, so they report null.
   * Per-scope limits (open orders per game, items per list) report the fullest scope.
   */
  async function usedFor(key: LimitKey, target: TargetUser, now: Date): Promise<number | null> {
    const userId = target.account.id;
    switch (key) {
      case 'apiRequests':
        return limits.tracker.peekMinute(userId);
      case 'trades':
      case 'orderCancels':
      case 'codeLookups':
      case 'wsSubscribes':
        return null;
      case 'gamesCreated':
        // windowStart, not an ISO string: the stored SQLite timestamps compare textually.
        return countGamesCreatedSince(db, userId, windowStart('gamesCreated', now.getTime()));
      case 'activeGamesOwned':
        return countActiveGamesOwned(db, userId);
      case 'gamesJoined':
        return countGamesJoinedSince(db, userId, windowStart('gamesJoined', now.getTime()));
      case 'activeGamesJoined':
        return countActiveGamesJoined(db, userId);
      case 'openOrders':
        return maxOpenOrdersInAnyGame(userId);
      case 'watchlists': {
        const [row] = await db.select({ c: count() }).from(watchlists).where(eq(watchlists.userId, userId));
        return Number(row?.c ?? 0);
      }
      case 'watchlistItems':
        return maxItemsInAnyWatchlist(userId);
      case 'wsConnections':
        return wsConnectionCount(userId);
      case 'registrationsPerIp': {
        if (!target.registrationIp) return null;
        const since = new Date(now.getTime() - DAY_MS).toISOString();
        return (await accountsFromIp(target.registrationIp)).filter((a) => a.createdAt >= since).length;
      }
    }
  }

  async function buildRows(target: TargetUser, keys: readonly LimitKey[]): Promise<AdminUserLimitRow[]> {
    const now = new Date();
    const overrides = await limits.overrides.listForUser(target.account.id);
    return Promise.all(keys.map(async (key): Promise<AdminUserLimitRow> => {
      const descriptor = LIMIT_CATALOGUE[key];
      const resolved = await limits.resolver.resolveForUser(target.account, key);
      const override = overrides.get(key);
      return {
        key,
        label: descriptor.label,
        kind: descriptor.kind,
        configKey: descriptor.configKey,
        baseValue: limits.resolver.baseValue(key),
        effectiveMax: resolved.max,
        basis: resolved.basis,
        override: override
          ? { value: override.value, note: override.note, updatedBy: override.updatedBy, updatedAt: override.updatedAt }
          : null,
        used: await usedFor(key, target, now),
        overridable: descriptor.overridable,
      };
    }));
  }

  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();

    app.get('/admin/limits/policy', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'User-limit policy and the caller IP as seen by the server.', security: [{ bearerAuth: [] }] },
    }, async (request, reply) => {
      const body: AdminLimitPolicy = {
        enabled: config.get('LIMITS_ENABLED'),
        maturityDays: config.get('LIMITS_MATURITY_DAYS'),
        probationPercent: config.get('LIMITS_PROBATION_PERCENT'),
        privilegedCidrs: config.get('LIMITS_PRIVILEGED_CIDRS').split(',').map((s) => s.trim()).filter(Boolean),
        privilegedMultiplier: config.get('LIMITS_PRIVILEGED_MULTIPLIER'),
        requestIp: request.ip,
        requestIpPrivileged: isPrivilegedConnection(request.ip, config),
      };
      return reply.send(body);
    });

    app.get('/admin/limits/top', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Users and IPs ranked by requests or limit denials.',
        security: [{ bearerAuth: [] }],
        querystring: topQuery,
      },
    }, async (request, reply) => {
      const { window, metric, limit } = request.query;
      const ranked = await topConsumers(db, limits.tracker, {
        sinceIso: windowStartIso(new Date(), window === '24h' ? 24 : WEEK_HOURS),
        metric,
        limit,
      });

      const userIds = ranked.filter((r) => r.subjectType === 'user').map((r) => r.subjectId);
      const userRows = userIds.length === 0
        ? []
        : await db
            .select({ id: users.id, username: users.username, registrationIp: users.registrationIp })
            .from(users)
            .where(inArray(users.id, userIds));
      const userById = new Map(userRows.map((u) => [u.id, u]));

      const ips = new Set<string>();
      for (const r of ranked) {
        const ip = r.subjectType === 'ip' ? r.subjectId : userById.get(r.subjectId)?.registrationIp;
        if (ip) ips.add(ip);
      }
      const ipCounts = ips.size === 0
        ? []
        : await db
            .select({ ip: users.registrationIp, c: count() })
            .from(users)
            .where(inArray(users.registrationIp, [...ips]))
            .groupBy(users.registrationIp);
      const accountsPerIp = new Map(ipCounts.map((r) => [r.ip ?? '', Number(r.c)]));

      const body: AdminTopConsumersResponse = {
        window,
        metric,
        rows: ranked.map((r) => {
          if (r.subjectType === 'ip') {
            return { ...r, username: null, sharedRegistrationIpCount: accountsPerIp.get(r.subjectId) ?? 0 };
          }
          const user = userById.get(r.subjectId);
          const shared = user?.registrationIp ? (accountsPerIp.get(user.registrationIp) ?? 1) - 1 : 0;
          return { ...r, username: user?.username ?? null, sharedRegistrationIpCount: shared };
        }),
      };
      return reply.send(body);
    });

    app.get('/admin/limits/overrides', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'Every active per-user limit override.', security: [{ bearerAuth: [] }] },
    }, async (_request, reply) => {
      const body: AdminLimitOverrideEntry[] = await limits.overrides.listAll();
      return reply.send(body);
    });

    app.get('/admin/users/:id/limits', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'A user’s effective limits, current usage, and recent request history.',
        security: [{ bearerAuth: [] }],
        params: userParams,
      },
    }, async (request, reply) => {
      const target = await loadTarget(request.params.id);
      if (!target) return reply.status(404).send({ error: 'User not found' });

      const mature = isMatureUser(target.account, config);
      const since = windowStartIso(new Date(), WEEK_HOURS);
      const siblings = target.registrationIp
        ? (await accountsFromIp(target.registrationIp)).filter((a) => a.id !== target.account.id).slice(0, SIBLING_LIMIT)
        : [];

      const body: AdminUserLimitsResponse = {
        userId: target.account.id,
        mature,
        probationEndsAt: mature ? null : maturityEndsAt(target.account, config).toISOString(),
        privilegedMultiplier: config.get('LIMITS_PRIVILEGED_MULTIPLIER'),
        rows: await buildRows(target, LIMIT_KEYS),
        registrationIp: target.registrationIp,
        siblingAccounts: siblings,
        requestVolume7d: await userRequestVolume(db, limits.tracker, target.account.id, since, VOLUME_TOP_N),
        denials7d: await userDenials(db, limits.tracker, target.account.id, since),
      };
      return reply.send(body);
    });

    app.put('/admin/users/:id/limits/:key', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Override one limit for one user.',
        security: [{ bearerAuth: [] }],
        params: userKeyParams,
        body: setBody,
      },
    }, async (request, reply) => {
      const check = checkOverridableKey(request.params.key);
      if (!check.ok) return reply.status(check.status).send({ code: check.code, message: check.message });

      const ceiling = overrideCeiling(check.key);
      if (ceiling !== undefined && request.body.value > ceiling) {
        return reply.status(400).send({
          code: 'INVALID_LIMIT_VALUE',
          message: `${check.key} overrides may not exceed ${ceiling}.`,
        });
      }

      const target = await loadTarget(request.params.id);
      if (!target) return reply.status(404).send({ error: 'User not found' });

      await limits.overrides.set(
        request.user.id,
        target.account.id,
        check.key,
        request.body.value,
        request.body.note ?? null,
      );
      const [row] = await buildRows(target, [check.key]);
      return reply.send(row);
    });

    app.delete('/admin/users/:id/limits/:key', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Remove a user’s override; the global limit applies again.',
        security: [{ bearerAuth: [] }],
        params: userKeyParams,
      },
    }, async (request, reply) => {
      const check = checkOverridableKey(request.params.key);
      if (!check.ok) return reply.status(check.status).send({ code: check.code, message: check.message });

      const target = await loadTarget(request.params.id);
      if (!target) return reply.status(404).send({ error: 'User not found' });

      await limits.overrides.clear(request.user.id, target.account.id, check.key);
      const [row] = await buildRows(target, [check.key]);
      return reply.send(row);
    });
  };
}
```

- [ ] **Step 4: Register the routes**

In `packages/server/src/routes/admin/index.ts`, add imports:

```ts
import type { Limits } from '../../limits/index.js';
import { adminLimitsRoutes } from './limits.js';
```

No earlier task touches `adminRoutes`. Add `limits: Limits` and `wsConnectionCount: (userId: string) => number` directly after `configOverrides`, so the signature becomes:

```ts
export function adminRoutes(
  db: Db,
  provider: StockProvider,
  systemSettings: SystemSettingsService,
  configOverrides: ConfigOverridesService,
  limits: Limits,
  wsConnectionCount: (userId: string) => number,
  bus?: EventBus,
  registry?: GameClientRegistry,
)
```

Update the JSDoc with one line:

```ts
 * `limits` and `wsConnectionCount` back `/admin/limits` and
 * `/admin/users/:id/limits`; the counter reads the live socket registries.
```

Then register the new routes after `adminConfigRoutes` (the live options come from `limits.config`):

```ts
    await app.register(adminLimitsRoutes(db, limits, limits.config, wsConnectionCount));
```

In `packages/server/src/app.ts`, update the `adminRoutes(...)` call to:

```ts
  await app.register(
    adminRoutes(
      db,
      provider,
      systemSettings,
      configOverrides,
      limits,
      (userId) => registry.countForUser(userId) + globalRegistry.countForUser(userId),
      bus,
      registry,
    ),
  );
```

Run `grep -rn "adminRoutes(" packages/server/tests`. Any test that calls `adminRoutes` directly must pass the two new arguments: its `limits` and `() => 0`.

- [ ] **Step 5: Run the route test**

Run: `pnpm --filter server exec vitest run tests/routes/admin-limits.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Full verification and commit**

Run: `pnpm typecheck && pnpm lint && pnpm --filter server exec vitest run`
Expected: typecheck and lint clean; all server tests pass.

```bash
git add packages/server/src/routes/admin/limits.ts packages/server/src/routes/admin/index.ts \
  packages/server/src/app.ts packages/server/tests/routes/admin-limits.test.ts
git commit -m "feat(admin): user limits API — policy, top consumers, overrides, per-user usage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
### Task 17: Admin limits API client + "Limits & usage" card on the user detail page

**Files:**
- Create: `packages/frontend/src/api/admin/limits.ts`
- Create: `packages/frontend/src/lib/limitLabels.ts`
- Create: `packages/frontend/src/components/admin/LimitUsage.tsx`
- Create: `packages/frontend/src/components/admin/LimitOverrideEditor.tsx`
- Create: `packages/frontend/src/components/admin/UserLimitsCard.tsx`
- Modify: `packages/frontend/src/pages/admin/AdminUserDetailPage.tsx` (mount the card after the Activity card)
- Test: `packages/frontend/tests/api/adminLimits.test.tsx`
- Test: `packages/frontend/tests/components/UserLimitsCard.test.tsx`

**Interfaces:**
- Consumes (T6 shared types, from `@markettrader/shared`): `LimitKey`, `LIMIT_KEYS`, `LimitBasis`, `AdminLimitPolicy`, `AdminUserLimitRow`, `AdminUserLimitsResponse`, `AdminSetUserLimitRequest`, `AdminLimitOverrideEntry`, `AdminTopConsumersResponse`.
- Consumes (T16 routes):
  - `GET /admin/limits/policy` → `AdminLimitPolicy`
  - `GET /admin/limits/top?window=24h|7d&metric=requests|denials` → `AdminTopConsumersResponse`
  - `GET /admin/limits/overrides` → `AdminLimitOverrideEntry[]` (a bare array, as Task 16 returns it)
  - `GET /admin/users/:id/limits` → `AdminUserLimitsResponse`
  - `PUT /admin/users/:id/limits/:key`, body `AdminSetUserLimitRequest`. The response body is not read.
  - `DELETE /admin/users/:id/limits/:key`. The response body is not read.
- Produces (used by T18):
  - `adminLimitKeys`
  - `useAdminLimitPolicy()`
  - `useAdminTopConsumers(range, metric)`
  - `useAdminLimitOverrides()`
  - `useAdminUserLimits(userId)`
  - `useAdminSetUserLimit()`: the mutation variables are `{ userId, key, value, note? }`
  - `useAdminClearUserLimit()`: the mutation variables are `{ userId, key }`
  - types `TopWindow`, `TopMetric`
  - `LIMIT_LABELS: Record<LimitKey, string>` and `limitLabel(key: string): string` in `@/lib/limitLabels`
  - `LimitBasisBadge`, `LimitUsageBar`
  - `UserLimitsCard({ userId })`

The mutation hooks take `userId` as a mutation variable, not a hook argument. The overrides list on `/admin/limits` (T18) clears overrides for many users from one hook instance.

- [ ] **Step 1: Write the failing hook test**

`packages/frontend/tests/api/adminLimits.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';

const apiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import {
  adminLimitKeys,
  useAdminClearUserLimit,
  useAdminSetUserLimit,
  useAdminTopConsumers,
} from '@/api/admin/limits';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

describe('admin limits API hooks', () => {
  beforeEach(() => apiFetch.mockReset().mockResolvedValue({}));

  it('PUTs an override to the user-scoped path and invalidates limits and the user detail', async () => {
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useAdminSetUserLimit(), { wrapper });

    await result.current.mutateAsync({ userId: 'u1', key: 'gamesCreated', value: 4, note: 'colleague' });

    expect(apiFetch).toHaveBeenCalledWith('/admin/users/u1/limits/gamesCreated', {
      method: 'PUT',
      body: { value: 4, note: 'colleague' },
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: adminLimitKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'users', 'detail', 'u1'] });
  });

  it('DELETEs an override', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useAdminClearUserLimit(), { wrapper });

    await result.current.mutateAsync({ userId: 'u1', key: 'trades' });

    expect(apiFetch).toHaveBeenCalledWith('/admin/users/u1/limits/trades', { method: 'DELETE' });
  });

  it('requests top consumers with the chosen window and metric', async () => {
    apiFetch.mockResolvedValue({ window: '7d', metric: 'denials', rows: [] });
    const { wrapper } = setup();
    const { result } = renderHook(() => useAdminTopConsumers('7d', 'denials'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetch).toHaveBeenCalledWith('/admin/limits/top?window=7d&metric=denials');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm build:shared && pnpm --filter frontend exec vitest run tests/api/adminLimits.test.tsx`
Expected: FAIL. The import fails with "Failed to resolve import "@/api/admin/limits"".

- [ ] **Step 3: Implement the hooks**

`packages/frontend/src/api/admin/limits.ts`:

```ts
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  AdminLimitOverrideEntry,
  AdminLimitPolicy,
  AdminSetUserLimitRequest,
  AdminTopConsumersResponse,
  AdminUserLimitsResponse,
  LimitKey,
} from '@markettrader/shared';
import { apiFetch } from '@/lib/api';
import { adminUserKeys } from '@/api/admin/users';

export type TopWindow = AdminTopConsumersResponse['window'];
export type TopMetric = AdminTopConsumersResponse['metric'];

/** React Query keys for the admin limits views. Every mutation invalidates `all`. */
export const adminLimitKeys = {
  all: ['admin', 'limits'] as const,
  policy: () => [...adminLimitKeys.all, 'policy'] as const,
  top: (range: TopWindow, metric: TopMetric) => [...adminLimitKeys.all, 'top', range, metric] as const,
  overrides: () => [...adminLimitKeys.all, 'overrides'] as const,
  user: (userId: string) => [...adminLimitKeys.all, 'user', userId] as const,
};

/** GET the limit policy and the caller's IP as the server sees it. */
export function useAdminLimitPolicy() {
  return useQuery({
    queryKey: adminLimitKeys.policy(),
    queryFn: () => apiFetch<AdminLimitPolicy>('/admin/limits/policy'),
  });
}

/** GET the heaviest users and IPs by request count or by limit denials. */
export function useAdminTopConsumers(range: TopWindow, metric: TopMetric) {
  return useQuery({
    queryKey: adminLimitKeys.top(range, metric),
    queryFn: () =>
      apiFetch<AdminTopConsumersResponse>(`/admin/limits/top?window=${range}&metric=${metric}`),
  });
}

/** GET every per-user override currently in force. */
export function useAdminLimitOverrides() {
  return useQuery({
    queryKey: adminLimitKeys.overrides(),
    queryFn: () => apiFetch<AdminLimitOverrideEntry[]>('/admin/limits/overrides'),
  });
}

/** GET one user's effective limits, usage, registration IP siblings, and recent activity. */
export function useAdminUserLimits(userId: string) {
  return useQuery({
    queryKey: adminLimitKeys.user(userId),
    queryFn: () => apiFetch<AdminUserLimitsResponse>(`/admin/users/${userId}/limits`),
    enabled: !!userId,
  });
}

interface UserLimitTarget {
  userId: string;
  key: LimitKey;
}

function invalidateAfterWrite(qc: QueryClient, userId: string) {
  void qc.invalidateQueries({ queryKey: adminLimitKeys.all });
  void qc.invalidateQueries({ queryKey: adminUserKeys.detail(userId) });
}

/** PUT a per-user override; it replaces the global value (multipliers do not apply to it). */
export function useAdminSetUserLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, key, ...body }: UserLimitTarget & AdminSetUserLimitRequest) =>
      apiFetch<unknown>(`/admin/users/${userId}/limits/${key}`, { method: 'PUT', body }),
    onSuccess: (_data, { userId }) => invalidateAfterWrite(qc, userId),
  });
}

/** DELETE a per-user override so the global value applies again. */
export function useAdminClearUserLimit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, key }: UserLimitTarget) =>
      apiFetch<unknown>(`/admin/users/${userId}/limits/${key}`, { method: 'DELETE' }),
    onSuccess: (_data, { userId }) => invalidateAfterWrite(qc, userId),
  });
}
```

- [ ] **Step 4: Run the hook test to verify it passes**

Run: `pnpm --filter frontend exec vitest run tests/api/adminLimits.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing card test**

`packages/frontend/tests/components/UserLimitsCard.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AdminUserLimitsResponse } from '@markettrader/shared';

const data: AdminUserLimitsResponse = {
  userId: 'u1',
  mature: false,
  probationEndsAt: '2026-10-20T12:00:00.000Z',
  privilegedMultiplier: 10,
  rows: [
    {
      key: 'gamesCreated', label: 'Games created per week', kind: 'quota',
      configKey: 'LIMIT_GAMES_CREATED_PER_WEEK', baseValue: 10, effectiveMax: 3, basis: 'probation',
      override: null, used: 3, overridable: true,
    },
    {
      key: 'trades', label: 'Trades per minute', kind: 'rate', configKey: 'LIMIT_TRADES_PER_MINUTE',
      baseValue: 60, effectiveMax: 120, basis: 'override',
      override: { value: 120, note: 'office bot', updatedBy: 'admin-id', updatedAt: '2026-10-14T00:00:00.000Z' },
      used: 4, overridable: true,
    },
    {
      key: 'registrationsPerIp', label: 'Registrations per IP per day', kind: 'ip',
      configKey: 'LIMIT_REGISTRATIONS_PER_IP_PER_DAY', baseValue: 5, effectiveMax: 5, basis: 'base',
      override: null, used: null, overridable: false,
    },
  ],
  registrationIp: '198.51.100.4',
  siblingAccounts: [{ id: 'u2', username: 'alt_account', createdAt: '2026-10-13T09:00:00.000Z' }],
  requestVolume7d: [{ route: 'POST /games', count: 42 }],
  denials7d: [{ limitKey: 'gamesCreated', count: 7, lastAt: '2026-10-14T08:00:00.000Z' }],
};

const setLimit = vi.fn();
const clearLimit = vi.fn();
vi.mock('@/api/admin/limits', () => ({
  useAdminUserLimits: () => ({ data, isLoading: false, isError: false }),
  useAdminSetUserLimit: () => ({ mutateAsync: setLimit, isPending: false }),
  useAdminClearUserLimit: () => ({ mutateAsync: clearLimit, isPending: false }),
}));

import { UserLimitsCard } from '@/components/admin/UserLimitsCard';

function renderCard() {
  const view = render(
    <MemoryRouter>
      <UserLimitsCard userId="u1" />
    </MemoryRouter>,
  );
  const row = (key: string) => view.container.querySelector<HTMLElement>(`[data-limit-key="${key}"]`)!;
  return { ...view, row };
}

describe('UserLimitsCard', () => {
  beforeEach(() => {
    setLimit.mockReset().mockResolvedValue(undefined);
    clearLimit.mockReset().mockResolvedValue(undefined);
  });

  it('shows effective max, basis, and usage per limit', () => {
    const { row } = renderCard();
    expect(within(row('gamesCreated')).getByText('Probation')).toBeInTheDocument();
    expect(within(row('gamesCreated')).getByText('3 / 3')).toBeInTheDocument();
    expect(within(row('trades')).getByText('Override')).toBeInTheDocument();
    expect(within(row('trades')).getByText('office bot')).toBeInTheDocument();
    expect(within(row('registrationsPerIp')).getByText('Not overridable')).toBeInTheDocument();
    expect(screen.getByText(/On probation until/)).toBeInTheDocument();
  });

  it('saves an override with its note', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Override Games created per week' }));
    const input = screen.getByLabelText('Override value for Games created per week');
    await user.clear(input);
    await user.type(input, '4');
    await user.type(screen.getByLabelText('Override note for Games created per week'), 'colleague');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(setLimit).toHaveBeenCalledWith({ userId: 'u1', key: 'gamesCreated', value: 4, note: 'colleague' });
  });

  it('refuses a non-positive override without calling the API', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Override Games created per week' }));
    const input = screen.getByLabelText('Override value for Games created per week');
    await user.clear(input);
    await user.type(input, '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(setLimit).not.toHaveBeenCalled();
    expect(screen.getByText('Whole number ≥ 1')).toBeInTheDocument();
  });

  it('clears an override after confirmation', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Clear override for Trades per minute' }));
    await user.click(screen.getByRole('button', { name: 'Clear override' }));
    expect(clearLimit).toHaveBeenCalledWith({ userId: 'u1', key: 'trades' });
  });

  it('lists accounts sharing the registration IP, request volume, and denials', () => {
    renderCard();
    expect(screen.getByText('198.51.100.4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'alt_account' })).toHaveAttribute('href', '/admin/users/u2');
    expect(screen.getByText('POST /games')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter frontend exec vitest run tests/components/UserLimitsCard.test.tsx`
Expected: FAIL with "Failed to resolve import "@/components/admin/UserLimitsCard"".

- [ ] **Step 7: Implement labels, badge/bar, override editor, and card**

`packages/frontend/src/lib/limitLabels.ts`:

```ts
import { LIMIT_KEYS, type LimitKey } from '@markettrader/shared';

/** Admin-facing names for each limit; `Record` makes a new `LimitKey` a type error here until labelled. */
export const LIMIT_LABELS: Record<LimitKey, string> = {
  apiRequests: 'API requests / min',
  trades: 'Trades / min',
  orderCancels: 'Order cancels / min',
  codeLookups: 'Invite-code lookups / min',
  wsSubscribes: 'Live subscriptions / min',
  gamesCreated: 'Games created / week',
  activeGamesOwned: 'Active games owned',
  gamesJoined: 'Games joined / day',
  activeGamesJoined: 'Active games joined',
  openOrders: 'Open orders per game',
  watchlists: 'Watchlists',
  watchlistItems: 'Items per watchlist',
  wsConnections: 'Live connections',
  registrationsPerIp: 'Registrations per IP / day',
};

/** Label for a denial or override key; per-IP route limits (`ip:<route>`) fall through verbatim. */
export function limitLabel(key: string): string {
  return (LIMIT_KEYS as readonly string[]).includes(key) ? LIMIT_LABELS[key as LimitKey] : key;
}
```

`packages/frontend/src/components/admin/LimitUsage.tsx`:

```tsx
import type { LimitBasis } from '@markettrader/shared';
import { cn } from '@/lib/utils';

const BASIS_STYLE: Record<LimitBasis, { label: string; className: string }> = {
  base: { label: 'Base', className: 'border border-hairline-strong text-text' },
  probation: { label: 'Probation', className: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
  override: { label: 'Override', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  admin: { label: 'Admin', className: 'bg-accent-bg text-accent' },
  disabled: { label: 'Limits off', className: 'bg-muted text-muted-foreground' },
};

/** Why a user has the limit they have: the resolver's `basis`. */
export function LimitBasisBadge({ basis }: { basis: LimitBasis }) {
  const style = BASIS_STYLE[basis];
  return <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', style.className)}>{style.label}</span>;
}

/** `used / max` with a bar; amber from 80%, red at the limit. `used` is null where nothing is countable. */
export function LimitUsageBar({ used, max }: { used: number | null; max: number | null }) {
  if (used === null) return <span className="text-xs text-muted-foreground">—</span>;
  if (max === null) return <span className="font-mono text-xs">{used} used</span>;
  const ratio = Math.min(1, used / max);
  const tone = used >= max ? 'bg-destructive' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-primary';
  return (
    <div className="w-32 space-y-1">
      <div className="font-mono text-xs">
        {used} / {max}
      </div>
      <div
        className="h-1.5 rounded bg-muted"
        role="progressbar"
        aria-label="Usage"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={used}
      >
        <div className={cn('h-full rounded', tone)} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
```

`packages/frontend/src/components/admin/LimitOverrideEditor.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import type { AdminUserLimitRow } from '@markettrader/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface LimitOverrideEditorProps {
  row: AdminUserLimitRow;
  pending: boolean;
  /** Resolves true when saved, so the form closes only on success. */
  onSave: (value: number, note: string | null) => Promise<boolean>;
  onClear: () => void;
}

/** Inline per-user override form for one limit row. */
export function LimitOverrideEditor({ row, pending, onSave, onClear }: LimitOverrideEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(row.override?.value ?? row.baseValue));
  const [note, setNote] = useState(row.override?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  if (!row.overridable) return <span className="text-xs text-muted-foreground">Not overridable</span>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      setError('Whole number ≥ 1');
      return;
    }
    setError(null);
    const trimmed = note.trim();
    if (await onSave(parsed, trimmed === '' ? null : trimmed)) setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" aria-label={`Override ${row.label}`} onClick={() => setEditing(true)}>
          {row.override ? 'Edit' : 'Override'}
        </Button>
        {row.override && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Clear override for ${row.label}`}
            disabled={pending}
            onClick={onClear}
          >
            Clear
          </Button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <Input
        type="number"
        min={1}
        step={1}
        className="w-28"
        aria-label={`Override value for ${row.label}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Input
        className="w-56"
        maxLength={500}
        placeholder="Why? (optional)"
        aria-label={`Override note for ${row.label}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
```

`packages/frontend/src/components/admin/UserLimitsCard.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminUserLimitRow } from '@markettrader/shared';
import { useAdminClearUserLimit, useAdminSetUserLimit, useAdminUserLimits } from '@/api/admin/limits';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { ApiError } from '@/lib/api';
import { limitLabel } from '@/lib/limitLabels';
import { toastApiError } from '@/lib/toastApiError';
import { LimitBasisBadge, LimitUsageBar } from './LimitUsage';
import { LimitOverrideEditor } from './LimitOverrideEditor';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** Effective limits, usage, overrides, and abuse signals for one user (admin user detail page). */
export function UserLimitsCard({ userId }: { userId: string }) {
  const limits = useAdminUserLimits(userId);
  const setLimit = useAdminSetUserLimit();
  const clearLimit = useAdminClearUserLimit();
  const [clearing, setClearing] = useState<AdminUserLimitRow | null>(null);
  const pending = setLimit.isPending || clearLimit.isPending;

  async function save(row: AdminUserLimitRow, value: number, note: string | null): Promise<boolean> {
    try {
      await setLimit.mutateAsync({ userId, key: row.key, value, ...(note !== null && { note }) });
      toast({ title: `${row.label} override saved`, variant: 'success' });
      return true;
    } catch (err) {
      toastApiError(err, err instanceof ApiError && err.status === 400 ? 'Invalid override' : 'Override failed');
      return false;
    }
  }

  async function confirmClear() {
    if (!clearing) return;
    try {
      await clearLimit.mutateAsync({ userId, key: clearing.key });
      toast({ title: `${clearing.label} override cleared`, variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Clear failed');
    } finally {
      setClearing(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Limits &amp; usage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {limits.isLoading && <Skeleton className="h-48 w-full" />}
        {limits.isError && <p className="text-sm text-destructive">Could not load limits.</p>}
        {limits.data && (
          <>
            <p className="text-xs text-muted-foreground">
              {limits.data.mature || !limits.data.probationEndsAt
                ? 'Mature account'
                : `On probation until ${formatDate(limits.data.probationEndsAt)}`}{' '}
              · non-override limits are ×{limits.data.privilegedMultiplier} on privileged IPs
            </p>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Limit</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead>Basis</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead>Override</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {limits.data.rows.map((row) => (
                    <TableRow key={row.key} data-limit-key={row.key}>
                      <TableCell className="align-top">
                        <div className="text-sm font-medium">{row.label}</div>
                        <div className="font-mono text-xs text-muted-foreground">{row.configKey}</div>
                      </TableCell>
                      <TableCell className="align-top font-mono text-xs">
                        <div>{row.effectiveMax ?? 'Unlimited'}</div>
                        {row.basis !== 'base' && <div className="text-muted-foreground">base {row.baseValue}</div>}
                      </TableCell>
                      <TableCell className="align-top">
                        <LimitBasisBadge basis={row.basis} />
                        {row.override?.note && (
                          <p className="mt-1 max-w-[12rem] text-xs text-muted-foreground">{row.override.note}</p>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <LimitUsageBar used={row.used} max={row.effectiveMax} />
                      </TableCell>
                      <TableCell className="align-top">
                        <LimitOverrideEditor
                          key={`${row.key}:${row.override?.value ?? 'none'}`}
                          row={row}
                          pending={pending}
                          onSave={(value, note) => save(row, value, note)}
                          onClear={() => setClearing(row)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <section className="space-y-1">
              <h3 className="text-sm font-medium">Registration IP</h3>
              <p className="font-mono text-xs">
                {limits.data.registrationIp ?? 'Not recorded (registered before limits shipped)'}
              </p>
              {limits.data.siblingAccounts.length > 0 ? (
                <ul className="text-sm">
                  {limits.data.siblingAccounts.map((s) => (
                    <li key={s.id}>
                      <Link to={`/admin/users/${s.id}`} className="hover:underline">
                        {s.username}
                      </Link>{' '}
                      <span className="text-xs text-muted-foreground">registered {formatDate(s.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                limits.data.registrationIp && (
                  <p className="text-xs text-muted-foreground">No other account registered from this IP.</p>
                )
              )}
            </section>

            <section className="space-y-1">
              <h3 className="text-sm font-medium">Requests by route (7 days)</h3>
              {limits.data.requestVolume7d.length === 0 ? (
                <p className="text-xs text-muted-foreground">No requests recorded.</p>
              ) : (
                <Table>
                  <TableBody>
                    {limits.data.requestVolume7d.map((v) => (
                      <TableRow key={v.route}>
                        <TableCell className="font-mono text-xs">{v.route}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{v.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>

            <section className="space-y-1">
              <h3 className="text-sm font-medium">Denials (7 days)</h3>
              {limits.data.denials7d.length === 0 ? (
                <p className="text-xs text-muted-foreground">No limit was hit.</p>
              ) : (
                <Table>
                  <TableBody>
                    {limits.data.denials7d.map((d) => (
                      <TableRow key={d.limitKey}>
                        <TableCell className="text-xs">{limitLabel(d.limitKey)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{d.count}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">last {formatDate(d.lastAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={clearing !== null}
        onOpenChange={(open) => !open && setClearing(null)}
        title={`Clear the ${clearing?.label ?? ''} override?`}
        description="The global value (with probation and privileged-IP adjustments) applies again from the next request."
        confirmLabel="Clear override"
        onConfirm={confirmClear}
      />
    </Card>
  );
}
```

`packages/frontend/src/pages/admin/AdminUserDetailPage.tsx`: add the import beside the other component imports:

```tsx
import { UserLimitsCard } from '@/components/admin/UserLimitsCard';
```

Then insert the card directly after the closing `</Card>` of the "Activity" card, before the "Profile" card:

```tsx
      <UserLimitsCard userId={userId} />
```

- [ ] **Step 8: Run both tests to verify they pass**

Run: `pnpm --filter frontend exec vitest run tests/api/adminLimits.test.tsx tests/components/UserLimitsCard.test.tsx`
Expected: PASS (8 tests).

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src/api/admin/limits.ts packages/frontend/src/lib/limitLabels.ts \
  packages/frontend/src/components/admin/LimitUsage.tsx packages/frontend/src/components/admin/LimitOverrideEditor.tsx \
  packages/frontend/src/components/admin/UserLimitsCard.tsx packages/frontend/src/pages/admin/AdminUserDetailPage.tsx \
  packages/frontend/tests/api/adminLimits.test.tsx packages/frontend/tests/components/UserLimitsCard.test.tsx
git commit -m "feat(admin): limits & usage card on the user detail page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: `/admin/limits` page, privileged-IP banner, and the override e2e flow

**Files:**
- Create: `packages/frontend/src/components/admin/PrivilegedIpBanner.tsx`
- Create: `packages/frontend/src/pages/admin/AdminLimitsPage.tsx`
- Modify: `packages/frontend/src/components/admin/AdminLayout.tsx` (`NAV_LINKS`)
- Modify: `packages/frontend/src/App.tsx` (lazy import and `limits` child route)
- Modify: `packages/frontend/src/pages/admin/AdminConfigPage.tsx` (banner)
- Modify: `packages/frontend/tests/pages/AdminConfigPage.test.tsx` (mock the new hook, add the banner test)
- Test: `packages/frontend/tests/pages/AdminLimitsPage.test.tsx`
- Test: `packages/frontend/e2e/admin/limits.spec.ts`

**Interfaces:**
- Consumes (T17):
  - from `@/api/admin/limits`: `useAdminLimitPolicy`, `useAdminTopConsumers`, `useAdminLimitOverrides`, `useAdminClearUserLimit`, `TopWindow`, `TopMetric`
  - from `@/lib/limitLabels`: `LIMIT_LABELS`, `limitLabel`
- Consumes (T8): the server built by `packages/server/src/index.ts` must **not** disable limits under `NODE_ENV=test`; the e2e server's only off switch is the `LIMITS_ENABLED: 'false'` env Task 9 put in `playwright.config.ts`, which an admin override can flip at runtime. Only the Vitest fixture (`createTestAppWithDb`) disables them structurally.
- Produces: `AdminLimitsPage`, `PrivilegedIpBanner`, the `/admin/limits` route.

- [ ] **Step 1: Write the failing page test**

`packages/frontend/tests/pages/AdminLimitsPage.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AdminLimitOverrideEntry, AdminLimitPolicy, AdminTopConsumersResponse } from '@markettrader/shared';

const policy: AdminLimitPolicy = {
  enabled: true, maturityDays: 7, probationPercent: 25, privilegedCidrs: ['203.0.113.0/24'],
  privilegedMultiplier: 10, requestIp: '203.0.113.7', requestIpPrivileged: true,
};
const top: AdminTopConsumersResponse = {
  window: '24h', metric: 'requests',
  rows: [
    { subjectType: 'user', subjectId: 'u1', username: 'spammer', count: 9001, top: 'POST /games', sharedRegistrationIpCount: 3 },
    { subjectType: 'ip', subjectId: '198.51.100.9', username: null, count: 120, top: 'GET /stocks/search', sharedRegistrationIpCount: 0 },
  ],
};
const overrides: AdminLimitOverrideEntry[] = [
  { userId: 'u7', username: 'colleague', key: 'gamesCreated', value: 30, note: 'runs the office league',
    updatedBy: 'a1', updatedByUsername: 'root', updatedAt: '2026-10-14T00:00:00.000Z' },
];

const useAdminTopConsumers = vi.fn();
const clearLimit = vi.fn();
vi.mock('@/api/admin/limits', () => ({
  useAdminLimitPolicy: () => ({ data: policy, isLoading: false, isError: false }),
  useAdminTopConsumers: (...args: unknown[]) => useAdminTopConsumers(...args),
  useAdminLimitOverrides: () => ({ data: overrides, isLoading: false, isError: false }),
  useAdminClearUserLimit: () => ({ mutateAsync: clearLimit, isPending: false }),
}));

import { AdminLimitsPage } from '@/pages/admin/AdminLimitsPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminLimitsPage />
    </MemoryRouter>,
  );
}

describe('AdminLimitsPage', () => {
  beforeEach(() => {
    useAdminTopConsumers.mockReset().mockReturnValue({ data: top, isLoading: false, isError: false });
    clearLimit.mockReset().mockResolvedValue(undefined);
  });

  it('lists top consumers with a shared-IP warning', () => {
    renderPage();
    const table = screen.getByRole('table', { name: 'Top consumers' });
    expect(within(table).getByRole('link', { name: 'spammer' })).toHaveAttribute('href', '/admin/users/u1');
    expect(within(table).getByText('9001')).toBeInTheDocument();
    expect(within(table).getByText('⚠ 3 shared IP')).toBeInTheDocument();
    expect(within(table).getByText('198.51.100.9')).toBeInTheDocument();
  });

  it('re-queries when the metric and window toggles change', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(useAdminTopConsumers).toHaveBeenLastCalledWith('24h', 'requests');
    await user.click(screen.getByRole('button', { name: 'Denials' }));
    expect(useAdminTopConsumers).toHaveBeenLastCalledWith('24h', 'denials');
    await user.click(screen.getByRole('button', { name: '7 days' }));
    expect(useAdminTopConsumers).toHaveBeenLastCalledWith('7d', 'denials');
  });

  it('clears an override after confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    const table = screen.getByRole('table', { name: 'Active overrides' });
    expect(within(table).getByText('Games created / week')).toBeInTheDocument();
    expect(within(table).getByText('runs the office league')).toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: 'Clear override' }));
    expect(clearLimit).toHaveBeenCalledWith({ userId: 'u7', key: 'gamesCreated' });
  });

  it('summarises the policy, shows the caller IP, and links to the config editor', () => {
    renderPage();
    expect(screen.getByText('203.0.113.0/24')).toBeInTheDocument();
    expect(screen.getByText('25% of each limit')).toBeInTheDocument();
    expect(screen.getByText(/privileged ✓/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Edit in Configuration/ })).toHaveAttribute('href', '/admin/config');
  });
});
```

Add the banner case to `packages/frontend/tests/pages/AdminConfigPage.test.tsx`. Insert this mock directly after the existing `vi.mock('@/api/admin/config', …)` block:

```tsx
vi.mock('@/api/admin/limits', () => ({
  useAdminLimitPolicy: () => ({
    data: {
      enabled: true, maturityDays: 7, probationPercent: 25, privilegedCidrs: [], privilegedMultiplier: 10,
      requestIp: '192.0.2.10', requestIpPrivileged: false,
    },
    isLoading: false,
    isError: false,
  }),
}));
```

Then add this test inside the `describe('AdminConfigPage', …)` block:

```tsx
  it('shows the caller IP as the server sees it and whether it is privileged', () => {
    render(<AdminConfigPage />);
    expect(screen.getByText('192.0.2.10')).toBeInTheDocument();
    expect(screen.getByText(/not privileged/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter frontend exec vitest run tests/pages/AdminLimitsPage.test.tsx tests/pages/AdminConfigPage.test.tsx`
Expected:
- `AdminLimitsPage.test.tsx` fails with "Failed to resolve import "@/pages/admin/AdminLimitsPage"".
- `AdminConfigPage.test.tsx` fails the new test with "Unable to find an element with the text: 192.0.2.10".

- [ ] **Step 3: Implement the banner, page, nav, route, and config-page banner**

`packages/frontend/src/components/admin/PrivilegedIpBanner.tsx`:

```tsx
import { useAdminLimitPolicy } from '@/api/admin/limits';
import { cn } from '@/lib/utils';

/**
 * The caller's IP as the server resolved it (`request.ip`, governed by TRUST_PROXY) and whether it
 * matches `LIMITS_PRIVILEGED_CIDRS` — the one place an admin can check the allowlist really matches.
 */
export function PrivilegedIpBanner() {
  const policy = useAdminLimitPolicy();
  if (!policy.data) return null;
  const { requestIp, requestIpPrivileged, privilegedMultiplier } = policy.data;
  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        requestIpPrivileged ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-hairline-strong',
      )}
    >
      Your IP as the server sees it: <span className="font-mono">{requestIp}</span> —{' '}
      {requestIpPrivileged ? `privileged ✓ (limits ×${privilegedMultiplier})` : 'not privileged'}
    </div>
  );
}
```

`packages/frontend/src/pages/admin/AdminLimitsPage.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminLimitOverrideEntry } from '@markettrader/shared';
import {
  useAdminClearUserLimit,
  useAdminLimitOverrides,
  useAdminLimitPolicy,
  useAdminTopConsumers,
  type TopMetric,
  type TopWindow,
} from '@/api/admin/limits';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { PrivilegedIpBanner } from '@/components/admin/PrivilegedIpBanner';
import { LIMIT_LABELS, limitLabel } from '@/lib/limitLabels';
import { toastApiError } from '@/lib/toastApiError';
import { cn } from '@/lib/utils';

function Toggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-hairline-strong p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium',
            o.value === value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const METRICS = [
  { value: 'requests', label: 'Requests' },
  { value: 'denials', label: 'Denials' },
] as const satisfies readonly { value: TopMetric; label: string }[];

const WINDOWS = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
] as const satisfies readonly { value: TopWindow; label: string }[];

/** Who is generating load, which overrides are in force, and the policy every limit is resolved under. */
export function AdminLimitsPage() {
  const [range, setRange] = useState<TopWindow>('24h');
  const [metric, setMetric] = useState<TopMetric>('requests');
  const top = useAdminTopConsumers(range, metric);
  const overrides = useAdminLimitOverrides();
  const policy = useAdminLimitPolicy();
  const clearLimit = useAdminClearUserLimit();
  const [clearing, setClearing] = useState<AdminLimitOverrideEntry | null>(null);

  async function confirmClear() {
    if (!clearing) return;
    try {
      await clearLimit.mutateAsync({ userId: clearing.userId, key: clearing.key });
      toast({ title: `Override cleared for ${clearing.username}`, variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Clear failed');
    } finally {
      setClearing(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Limits</h1>
        <p className="text-sm text-muted-foreground">
          Global values are edited in Configuration; per-user overrides on each user&apos;s page. Admins are
          never limited.
        </p>
      </div>

      <PrivilegedIpBanner />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Top consumers</CardTitle>
          <div className="flex gap-2">
            <Toggle label="Metric" value={metric} options={METRICS} onChange={setMetric} />
            <Toggle label="Window" value={range} options={WINDOWS} onChange={setRange} />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {top.isLoading && <Skeleton className="h-32 w-full" />}
          {top.isError && <p className="text-sm text-destructive">Could not load usage.</p>}
          {top.data && (
            <Table aria-label="Top consumers">
              <TableHeader>
                <TableRow>
                  <TableHead>User / IP</TableHead>
                  <TableHead className="text-right">{metric === 'requests' ? 'Requests' : 'Denials'}</TableHead>
                  <TableHead>{metric === 'requests' ? 'Top route' : 'Top limit'}</TableHead>
                  <TableHead>Signals</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.data.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-xs text-muted-foreground">
                      Nothing recorded in this window.
                    </TableCell>
                  </TableRow>
                )}
                {top.data.rows.map((r) => (
                  <TableRow key={`${r.subjectType}:${r.subjectId}`}>
                    <TableCell>
                      {r.subjectType === 'user' ? (
                        <Link to={`/admin/users/${r.subjectId}`} className="hover:underline">
                          {r.username ?? r.subjectId}
                        </Link>
                      ) : (
                        <span className="font-mono text-xs">{r.subjectId}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.count}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.top === null ? '—' : metric === 'denials' ? limitLabel(r.top) : r.top}
                    </TableCell>
                    <TableCell>
                      {r.sharedRegistrationIpCount > 0 && (
                        <span
                          className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400"
                          title="Other accounts registered from the same IP"
                        >
                          ⚠ {r.sharedRegistrationIpCount} shared IP
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active overrides</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {overrides.isLoading && <Skeleton className="h-24 w-full" />}
          {overrides.isError && <p className="text-sm text-destructive">Could not load overrides.</p>}
          {overrides.data && (
            <Table aria-label="Active overrides">
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Limit</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Set</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {overrides.data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-xs text-muted-foreground">
                      No overrides — every user is on the global limits.
                    </TableCell>
                  </TableRow>
                )}
                {overrides.data.map((o) => (
                  <TableRow key={`${o.userId}:${o.key}`}>
                    <TableCell>
                      <Link to={`/admin/users/${o.userId}`} className="hover:underline">
                        {o.username}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{LIMIT_LABELS[o.key]}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{o.value}</TableCell>
                    <TableCell className="max-w-xs text-xs text-muted-foreground">{o.note ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(o.updatedAt).toLocaleString()}
                      {o.updatedByUsername && ` · ${o.updatedByUsername}`}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setClearing(o)}>
                        Clear
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {policy.data && (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Enforcement</dt>
                <dd>{policy.data.enabled ? 'On' : 'Off — every limit is lifted'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Account maturity</dt>
                <dd>{policy.data.maturityDays} days</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Probation</dt>
                <dd>{policy.data.probationPercent}% of each limit</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Privileged multiplier</dt>
                <dd>×{policy.data.privilegedMultiplier}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Privileged IPs</dt>
                <dd className="font-mono text-xs">
                  {policy.data.privilegedCidrs.length === 0
                    ? 'None'
                    : policy.data.privilegedCidrs.map((c) => <div key={c}>{c}</div>)}
                </dd>
              </div>
            </dl>
          )}
          <Link to="/admin/config" className="text-sm hover:underline">
            Edit in Configuration →
          </Link>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={clearing !== null}
        onOpenChange={(open) => !open && setClearing(null)}
        title={`Clear ${clearing?.username ?? ''}'s ${clearing ? LIMIT_LABELS[clearing.key] : ''} override?`}
        description="The global value applies to this user again from the next request."
        confirmLabel="Clear override"
        onConfirm={confirmClear}
      />
    </div>
  );
}
```

`packages/frontend/src/components/admin/AdminLayout.tsx`: in `NAV_LINKS`, insert after the `Config` entry:

```tsx
  { to: '/admin/limits', label: 'Limits' },
```

`packages/frontend/src/App.tsx`: add after the `AdminConfigPage` lazy declaration:

```tsx
const AdminLimitsPage = lazy(() =>
  import('@/pages/admin/AdminLimitsPage').then((m) => ({ default: m.AdminLimitsPage })),
);
```

Then add after `<Route path="config" element={<AdminConfigPage />} />`:

```tsx
                <Route path="limits" element={<AdminLimitsPage />} />
```

`packages/frontend/src/pages/admin/AdminConfigPage.tsx`:
- Add the import:

  ```tsx
  import { PrivilegedIpBanner } from '@/components/admin/PrivilegedIpBanner';
  ```

- Insert directly after the `{overrideCount > 0 && ( … )}` banner block:

  ```tsx
        <PrivilegedIpBanner />
  ```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter frontend exec vitest run tests/pages/AdminLimitsPage.test.tsx tests/pages/AdminConfigPage.test.tsx`
Expected: PASS (4 + 5 tests).

- [ ] **Step 5: Confirm the e2e server can turn limits on at runtime**

Task 9 runs the e2e server with `LIMITS_ENABLED: 'false'` in `packages/frontend/playwright.config.ts`, because every fixture registers from `127.0.0.1` and would hit `LIMIT_REGISTRATIONS_PER_IP_PER_DAY` within a few specs. Do not change that file here. This spec turns limits on through `/admin/config` for its own duration instead.

That only works if `index.ts` does not disable limits structurally:

Run: `grep -n "limits" packages/server/src/index.ts`
Expected: no match, or `limits: { disabled: false }`. If T8 tied it to `env.NODE_ENV === 'test'`, remove that so `index.ts` passes no `limits` option. The Vitest fixture's default (`disabled: true` in `createTestAppWithDb`) is unaffected.

- [ ] **Step 6: Write the e2e spec**

`packages/frontend/e2e/admin/limits.spec.ts`:

```ts
import { test, expect } from '../fixtures/base';

const GAMES_LIMIT = 'LIMIT_GAMES_CREATED_PER_WEEK';

test.describe('Admin limits', () => {
  let playerId: string | undefined;

  // Shared e2e DB and server: never leave limits switched on or an override
  // behind, even when a step fails, or every later spec inherits them.
  test.afterEach(async ({ apiClient, adminUser }) => {
    const headers = { Authorization: `Bearer ${adminUser.accessToken}` };
    await apiClient.delete('/admin/config/LIMITS_ENABLED', { headers });
    await apiClient.delete(`/admin/config/${GAMES_LIMIT}`, { headers });
    if (playerId) {
      await apiClient.delete(`/admin/users/${playerId}/limits/gamesCreated`, { headers });
      playerId = undefined;
    }
  });

  test('UI: a per-user override lets a capped player create another game', async ({
    apiClient,
    adminUser,
    adminPage,
    registerUser,
  }) => {
    const adminHeaders = { Authorization: `Bearer ${adminUser.accessToken}` };

    // Register BEFORE turning limits on: every e2e account comes from
    // 127.0.0.1, so with limits on this registration would already be past
    // LIMIT_REGISTRATIONS_PER_IP_PER_DAY.
    const player = await registerUser();
    playerId = player.userId;

    for (const [key, value] of [
      ['LIMITS_ENABLED', true],
      [GAMES_LIMIT, 1],
    ] as const) {
      const res = await apiClient.put(`/admin/config/${key}`, { headers: adminHeaders, data: { value } });
      expect(res.ok(), await res.text()).toBeTruthy();
    }

    const createGame = (name: string) =>
      apiClient.post('/games', {
        headers: { Authorization: `Bearer ${player.accessToken}` },
        data: {
          name,
          startDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          endDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          startingBalance: 100_000,
        },
      });

    // A fresh account is on probation, but 25% of 1 still rounds up to 1.
    expect((await createGame('limits-e2e-1')).status()).toBe(201);
    const denied = await createGame('limits-e2e-2');
    expect(denied.status()).toBe(429);
    expect(await denied.json()).toMatchObject({ code: 'LIMIT_EXCEEDED', limit: 'gamesCreated', max: 1 });

    await adminPage.goto(`/admin/users/${player.userId}`);
    const row = adminPage.locator('[data-limit-key="gamesCreated"]');
    await expect(row.getByText('1 / 1')).toBeVisible();
    await row.getByRole('button', { name: /^Override / }).click();
    await row.getByLabel(/^Override value for /).fill('2');
    await row.getByLabel(/^Override note for /).fill('e2e colleague');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText('Override', { exact: true })).toBeVisible();
    await expect(row.getByText('e2e colleague')).toBeVisible();

    expect((await createGame('limits-e2e-3')).status()).toBe(201);

    await adminPage.goto('/admin/limits');
    const overridesTable = adminPage.getByRole('table', { name: 'Active overrides' });
    await expect(overridesTable.getByRole('link', { name: player.username })).toBeVisible();
  });
});
```

- [ ] **Step 7: Run the e2e spec and the admin e2e suite**

Run: `pnpm --filter frontend exec playwright test e2e/admin/limits.spec.ts`
Expected: 1 passed.

Run: `pnpm --filter frontend e2e`
Expected: every spec passes. A failure mentioning `LIMIT_EXCEEDED` in an unrelated spec means this spec's `afterEach` did not reset `LIMITS_ENABLED` — fix the cleanup, do not raise limits in `playwright.config.ts`.

- [ ] **Step 8: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

```bash
git add packages/frontend/src/components/admin/PrivilegedIpBanner.tsx packages/frontend/src/pages/admin/AdminLimitsPage.tsx \
  packages/frontend/src/components/admin/AdminLayout.tsx packages/frontend/src/App.tsx \
  packages/frontend/src/pages/admin/AdminConfigPage.tsx packages/frontend/tests/pages/AdminConfigPage.test.tsx \
  packages/frontend/tests/pages/AdminLimitsPage.test.tsx \
  packages/frontend/e2e/admin/limits.spec.ts
git commit -m "feat(admin): limits page, privileged-IP banner, override e2e

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Documentation and final verification

**Files:**
- Modify: `docs/technical-decisions.md` (append ADR-017)
- Modify: `docs/design.md` (User limits section, Open Questions row, Known Gaps)
- Modify: `CLAUDE.md` (User Limits section, WS convention bullet, PII rule, env families, key documents)
- Create: `docs/pii-inventory.md`
- Modify: `docs/observability.md` (metric catalogue row)
- Modify: `.env.example` (new options)

**Interfaces:**
- Consumes: every key, file and name from T1–T18 exactly as those tasks define them. Before writing, run the check in Step 1 so the docs cite what actually shipped.
- Produces: none (docs only).

- [ ] **Step 1: Confirm the names the docs will cite**

Run:
```bash
grep -n "LIMITS_\|LIMIT_\|USAGE_\|GAME_MAX_" packages/server/src/config/registry.ts
ls packages/server/src/limits packages/server/src/workers/usage-rollup.ts packages/server/src/routes/admin/limits.ts
grep -n "WS_LIMIT_EXCEEDED_CLOSE_CODE" packages/server/src/ws/close-codes.ts packages/frontend/src/lib/wsAuth.ts
grep -n "limitsDenied\|limits.denied" packages/server/src/observability/telemetry.ts
```
Expected:
- every key in spec §3.4 and §4, plus Tasks 1–2's `GAME_MAX_*` and Task 15's `USAGE_*`, is present
- `limits/` has `cidr.ts catalogue.ts policy.ts account.ts overrides.ts resolver.ts errors.ts enforce.ts quota-counts.ts rate.ts sliding-window.ts usage-tracker.ts usage-hooks.ts usage-store.ts index.ts`
- `4429` is defined in both files
- the counter is named `markettrader.limits.denied`

If a name differs, use the shipped name in every text below.

- [ ] **Step 2: Append ADR-017 to `docs/technical-decisions.md`**

Append at the end of the file, after ADR-016 and its `**See also:**` line, separated by the same `---` rule the file uses between ADRs:

```markdown
---

## ADR-017: Per-User Limits on `@fastify/rate-limit`, Quotas Counted From Source Rows

**Date:** 2026-10-14
**Status:** Accepted
**Amends:** ADR-002 (rate limiting stays a Fastify plugin; it gains a per-user key and a resolver)

**Decision:** Every abuse control resolves its ceiling through one `LimitResolver` (`packages/server/src/limits/`), in this order:
1. admin → unlimited
2. per-user override → exactly that value
3. otherwise the global live option, cut to `LIMITS_PROBATION_PERCENT` for accounts younger than `LIMITS_MATURITY_DAYS`
4. ×`LIMITS_PRIVILEGED_MULTIPLIER` when `request.ip` is in `LIMITS_PRIVILEGED_CIDRS`

`LIMITS_ENABLED=false` lifts everything. Global values are live options in the `limits` config category. Overrides are rows in `user_limit_overrides`, audited like every admin write.

**Three kinds of limit share the resolver but not the counter:**

| Kind | Counted by | Why |
|---|---|---|
| Request rate (trades/min, cancels/min, invite-code lookups/min) | `@fastify/rate-limit`, keyed `u:<userId>`, with an async `max` that calls the resolver | The plugin already does windows, headers, and eviction; per-request `max` makes overrides apply on the next request |
| Quota over a window (games created/week, joins/day, registrations per IP/day) | `COUNT(*)` over the real rows (`games.created_by`, `game_players.joined_at`, `users.registration_ip`) | Durable across restarts, and cannot drift from the truth: a deleted game stops counting |
| Concurrent cap (active games, open orders, watchlists, sockets) | `COUNT(*)` of current rows, or the live socket registries | Same |

The global per-user request ceiling (`LIMIT_API_REQUESTS_PER_MINUTE`) is the one exception. A route carries only one `config.rateLimit`, so the ceiling is enforced by the in-memory `UsageTracker` from a global `preHandler`.

**Monitoring is aggregated in memory and rolled up hourly.**
- `UsageTracker` counts requests per subject (user, or IP when logged out) × registered route × hour, and denials per subject × limit × hour.
- The `usage-rollup` worker adds the counts into `api_usage_hourly` and `limit_denials_hourly` every `USAGE_FLUSH_INTERVAL_MS`, and prunes rows past `USAGE_RETENTION_DAYS`.
- OTel gets only `markettrader.limits.denied{limit}`. A user id on a metric attribute is unbounded cardinality (ADR-015).

**Alternatives considered:**
- **A custom limiter for everything** — rejected. It reimplements a working plugin, plus its store and eviction, to gain uniformity.
- **A usage-counter table driving every limit** — rejected. That is a database write per request (a poor fit for SQLite under load), and the counters drift from the rows they claim to count.
- **Per-user OTel metrics** — rejected on cardinality.
- **Separate probation values per limit** — rejected for one percentage knob. Per-user overrides already cover the exceptions.

**Consequences:**
- **Single-host assumption.** Rate windows, the override cache, and unflushed usage are per process. A restart resets rate windows (quotas are unaffected). A crash loses at most one flush interval of usage. Moving to several instances means a shared store, as already noted for the login throttle.
- **Quota overshoot.** On Postgres, two simultaneous requests can overshoot a quota by one. SQLite serialises writers, so the check is exact there.
- **`request.ip` is load-bearing.** The privileged allowlist and every per-IP limit depend on `TRUST_PROXY` matching the proxy hop. `/admin/config` and `/admin/limits` show the caller's IP as the server sees it, so this can be checked.
- **New close code.** `4429` (`WS_LIMIT_EXCEEDED_CLOSE_CODE`) refuses a socket past the per-user connection cap. It is disjoint from 1008 and 4400, and clients treat it as a plain backoff.
- **Registration IPs are stored.** `users.registration_ip` is personal data; `docs/pii-inventory.md` lists it with everything else the system keeps about people.

**See also:** `docs/design.md` → User limits; `docs/pii-inventory.md`.
```

- [ ] **Step 3: Update `docs/design.md`**

Insert this section after the "Runtime configuration (admin)" section, immediately before the `---` that precedes `## System Boundaries`:

```markdown
### User limits

Every abuse control is a **limit** with a key (`LimitKey`, `packages/shared/src/types/limits.ts`), a catalogue entry (`packages/server/src/limits/catalogue.ts`), and a live option in the `limits` config category that holds its global value. The effective value for a request is resolved in this order (ADR-017):

1. `LIMITS_ENABLED=false` → none
2. admin → none
3. per-user override → that value
4. global value, reduced to `LIMITS_PROBATION_PERCENT` (rounded up, at least 1) while the account is younger than `LIMITS_MATURITY_DAYS`
5. ×`LIMITS_PRIVILEGED_MULTIPLIER` when the request IP is in `LIMITS_PRIVILEGED_CIDRS`

| Limit | Option | Kind | Default |
|---|---|---|---|
| API requests per user | `LIMIT_API_REQUESTS_PER_MINUTE` | rate | 600/min |
| Trades | `LIMIT_TRADES_PER_MINUTE` | rate | 60/min |
| Order cancels | `LIMIT_ORDER_CANCELS_PER_MINUTE` | rate | 60/min |
| Invite-code lookups | `LIMIT_CODE_LOOKUPS_PER_MINUTE` | rate | 20/min |
| Live `subscribe` frames | `LIMIT_WS_SUBSCRIBES_PER_MINUTE` | rate | 30/min |
| Games created | `LIMIT_GAMES_CREATED_PER_WEEK` | quota | 10 / 7 days |
| Active games owned | `LIMIT_ACTIVE_GAMES_OWNED` | concurrent | 5 |
| Games joined | `LIMIT_GAMES_JOINED_PER_DAY` | quota | 20 / 24 h |
| Active games joined | `LIMIT_ACTIVE_GAMES_JOINED` | concurrent | 30 |
| Open orders per game-player (working + pending) | `LIMIT_OPEN_ORDERS_PER_PLAYER` | concurrent | 50 |
| Watchlists / items per list | `WATCHLIST_MAX_PER_USER` / `WATCHLIST_MAX_ITEMS` | concurrent | 20 / 50 |
| Open live sockets | `LIMIT_WS_CONNECTIONS_PER_USER` | concurrent | 10 |
| Registrations per IP | `LIMIT_REGISTRATIONS_PER_IP_PER_DAY` | per IP | 5 / 24 h |

**How a refusal looks:**
- **HTTP body:** `LimitExceededBody` — `{ error, code: 'LIMIT_EXCEEDED', limit, max, probation, retryAfterSeconds? }`.
- **Rates and windowed quotas:** 429 with `Retry-After`. For a quota, the wait is computed from the oldest row still in the window.
- **Concurrent caps:** 409.
- **WebSocket:** a socket past the connection cap is closed with `4429`. A `subscribe` past the frame rate is dropped and answered with an error frame, and the previous subscription stays in force.
- **The pre-existing per-IP route limits** (login, register, refresh, `/stocks/*`, WS upgrades) keep their numbers. They gain the privileged multiplier, and admins are exempt where the route is authenticated.

**Game bounds are global and not per-user:**
- `GAME_MAX_STARTING_BALANCE`
- `GAME_MAX_DURATION_DAYS`
- `GAME_MAX_START_DELAY_DAYS`
- `GAME_MAX_PLAYERS` (409 `GAME_FULL`)

`/games/browse` is paginated. `/public/featured-games` only ranks games with at least two players, and ranks them by percentage return, so a huge starting balance cannot take over the login page.

**Monitoring.**
- Requests and denials are counted in memory per user (or per IP when logged out), per registered route or limit, per hour.
- The `usage-rollup` worker writes them to `api_usage_hourly` / `limit_denials_hourly` and prunes after `USAGE_RETENTION_DAYS`.
- `/admin/limits` shows:
  - the top consumers over 24 h or 7 d, by requests or by denials
  - every active override
  - the policy, including the caller's IP as the server sees it
- Each user's admin page has a "Limits & usage" card:
  - effective limit, basis, and usage
  - the override editor
  - the registration IP, with the other accounts registered from it
  - 7-day request volume by route
  - recent denials
```

In `## Open Questions`, replace the row:

```markdown
| Should there be a rate limit on trades per player per game? | Not in MVP |
```

with:

```markdown
| Should there be a rate limit on trades per player per game? | **Resolved 2026-10-14** — per user rather than per game: `LIMIT_TRADES_PER_MINUTE` (60/min, live, overridable per user). See User limits. |
```

In `## Known Gaps`, replace the whole `### Open orders are capped per game-player` section, from its heading up to the next `###` heading, with:

```markdown
### Open orders are capped per game-player

`LIMIT_OPEN_ORDERS_PER_PLAYER` (live, default 50, overridable per user) caps `working` + `pending` rows per
game-player; a bracket counts as three. Placing past it is refused with `LIMIT_EXCEEDED` (409 — it was
422 `TOO_MANY_OPEN_ORDERS` before 2026-10, and that error code is gone). Until
2026-10 the cap was a constant and the pending path (`reservePendingTrade`) skipped it; both paths now count.
The cap exists because every resting order's symbol joins the price poller's 5-second fan-out.

The count is a read inside the transaction followed by an insert, so on Postgres concurrent placements can
overshoot by roughly the number of in-flight requests. It is per *game-player*, so the per-user ceiling is
this × `LIMIT_ACTIVE_GAMES_JOINED`.

### Open orders can crowd watchlist symbols out of the price poller

The poller's `openOrderSymbols` query covers every active game, not only games with a connected socket, and
open-order symbols rank above watchlist symbols in the `PRICE_POLLER_MAX_SYMBOLS` cut. The user limits bound
one account's contribution (active games joined × open orders per game), but enough accounts with resting
orders on distinct symbols can still push watchlist symbols out of live pricing. The proper fix — weighting
or scoping the open-order set — changes poller semantics and is left for its own change.
```

In `### Login throttle state is per-process`, replace its last paragraph with:

```markdown
Neither matters at the current single-process deployment. Moving to more than one
server instance means moving this state to the database or a shared cache — the
per-IP limiter (`@fastify/rate-limit`, also in-process), the per-user rate windows,
the limit-override cache, and the unflushed `UsageTracker` buffers have the same
constraint (ADR-017).
```

- [ ] **Step 4: Create `docs/pii-inventory.md`**

```markdown
# Personal Data Inventory

Every piece of personal data MarketTrader stores or ships, where it lives, why, how long it is kept, and who can
see it. This is a living document: **a change that starts storing or sending new personal data updates this
file in the same commit** (rule in `CLAUDE.md`). It exists so that a future privacy obligation (e.g. GDPR
if the audience reaches the EU) starts from an accurate list rather than an archaeology project.

"Admins" means members of the `admin` group. Nothing here is visible to other players unless stated.

| Data | Where | Purpose | Retention | Visible to |
|---|---|---|---|---|
| Username | `users.username`; copied into `admin_audit_log.before/after` JSON on user edits | Identity; shown on leaderboards, game lists, featured games | Until the account is deleted; audit copies indefinitely | **Everyone** (incl. logged-out visitors via featured games) |
| Password hash (argon2) | `users.password_hash` | Authentication | Until the account is deleted | Nobody (never returned by any API) |
| Account creation time | `users.created_at` | Probation (`LIMITS_MATURITY_DAYS`), admin views | Until the account is deleted | Admins |
| Registration IP | `users.registration_ip` | Per-IP registration quota; sibling-account detection | Until the account is deleted (no automatic purge — candidate for one) | Admins |
| Request IP (logged-out traffic) | `api_usage_hourly.subject_id`, `limit_denials_hourly.subject_id` where `subject_type = 'ip'` | Abuse monitoring | `USAGE_RETENTION_DAYS` (default 30) | Admins |
| Per-user request and denial counts | `api_usage_hourly`, `limit_denials_hourly` (`subject_type = 'user'`) | Abuse monitoring | `USAGE_RETENTION_DAYS`; deleted with the account | Admins |
| Limit overrides and their notes | `user_limit_overrides` | Per-user limit exceptions (notes are free text an admin writes about a user) | Until cleared or the account is deleted | Admins |
| Admin actions on a user | `admin_audit_log` | Accountability for admin writes | Indefinite | Admins |
| Trading activity | `trades`, `portfolios`, `game_players`, `portfolio_snapshots`, achievements tables | The game | Until the game or account is deleted | Members of the same game |
| Request IP and URL in logs | pino request logs (`remoteAddress`); shipped to the OTLP collector and, at `warn`+, to PostHog Logs | Operations, debugging | Per the collector/PostHog retention settings (outside this repo) | Operators |
| Analytics identity | PostHog person: `distinctId = users.id`, properties `username`, `groups` (`lib/posthog.ts` identify; server events in `observability/analytics.ts`) | Product analytics | PostHog project retention | PostHog project members |
| Session replay | PostHog replay (browser) | Debugging UX and errors | PostHog project retention | PostHog project members |
| Error reports | PostHog error tracking, tagged with `request.user.id` (`observability/error-capture.ts`) | Debugging | PostHog project retention | PostHog project members |
| Refresh token | HttpOnly cookie on the user's device; not stored server-side | Session | 7 days | The user's browser |

**Not collected:** email address, real name, payment data, precise location.
```

- [ ] **Step 5: Update `CLAUDE.md`**

1. In `## WebSocket Conventions`, insert this bullet directly after the bullet that begins **"Bound and validate inbound frames"**:

```markdown
- **Per-user socket limits** — a socket past `LIMIT_WS_CONNECTIONS_PER_USER` is closed at upgrade with
  `WS_LIMIT_EXCEEDED_CLOSE_CODE` (4429, `ws/close-codes.ts`, mirrored in `frontend/src/lib/wsAuth.ts`).
  Keep it disjoint from 1008 and 4400: the client treats 4429 as a plain backoff, never a refresh. A
  `subscribe` past `LIMIT_WS_SUBSCRIBES_PER_MINUTE` (counted per user across sockets) is **dropped** with an
  `error` frame, not answered with a close — closing would hand the client a fresh socket and an immediate
  re-subscribe, which throttles nothing.
```

2. In the last bullet of `## WebSocket Conventions` (the one ending "that is the whole reason it has its own code."), append:

```markdown
  The same holds for a 4429 (connection cap).
```

3. Insert this new section after `## Authentication`, before `## Stock Price Provider`:

```markdown
## User Limits

Abuse controls live in `packages/server/src/limits/` (ADR-017, `docs/design.md` → User limits).

- **One resolver for every ceiling.** `LimitResolver.resolve(subject, key)`:
  1. `LIMITS_ENABLED=false` → none
  2. admin → none
  3. per-user override → exactly that
  4. global live option, at `LIMITS_PROBATION_PERCENT` while `isMatureUser` is false
  5. ×`LIMITS_PRIVILEGED_MULTIPLIER` when `isPrivilegedConnection(request.ip)`

  Never compare against a config value directly in a route; go through the resolver, or overrides and admin immunity silently stop applying.
- **`request.account`** (`{ id, createdAt, isAdmin }`) comes from the same `users` read `verifyAccessToken` already does — no extra query, no cache — so a demoted admin loses immunity on the next request.
- **Three kinds, three counters:**
  - **rate:** `rateLimitFor(limits, key)` on the route's `config.rateLimit`, keyed per user.
  - **quota and concurrent:** `limits.enforcer.enforce(request, key, count)` before the insert, counting the real rows (helpers in `limits/quota-counts.ts`), inside the insert's transaction.
  - **global per-user ceiling:** the `UsageTracker` `preHandler`.

  Do not add a counter table for a quota — count the source rows.
- **Adding a limit:**
  1. Add the key to `LIMIT_KEYS` (shared).
  2. Add a `LIMIT_*` live option (env.ts + registry, with `min`/`max`).
  3. Add a catalogue entry. Its `satisfies` clause fails typecheck until you do.
  4. Add a label in `frontend/src/lib/limitLabels.ts`. Its `Record` fails typecheck until you do.
  5. Add one enforcement point.

  Tests opt in with `createTestAppWithDb(…, { limits: { disabled: false } })`; the fixture disables limits by default.
- **The per-IP `@fastify/rate-limit` configs are a second layer, not a replacement.** Their `max` goes through `withPrivilegedIp` so the office allowlist lifts them too. Keep both layers, as with the login controls.
- **Refusals** use `LimitExceededBody` (`code: 'LIMIT_EXCEEDED'`): 429 + `Retry-After` for rates and windowed quotas, 409 for concurrent caps.
- **Personal data:** a change that stores or ships new personal data (an IP, an email, free text about a person) updates `docs/pii-inventory.md` in the same commit.
```

4. In `## Environment Variables`, in the paragraph listing "Additional vars rarely need touching", replace:

```markdown
`WS_HEARTBEAT_INTERVAL_MS`, `WS_REVALIDATE_INTERVAL_MS`, `PRICE_POLLER_MAX_SYMBOLS`,
the `WATCHLIST_MAX_*` pair, `SQLITE_BUSY_TIMEOUT_MS`, and the `OTEL_*` family.
```

with:

```markdown
`WS_HEARTBEAT_INTERVAL_MS`, `WS_REVALIDATE_INTERVAL_MS`, `PRICE_POLLER_MAX_SYMBOLS`,
the `WATCHLIST_MAX_*` pair, the `LIMITS_*` policy and `LIMIT_*` per-user limits (User Limits below),
`USAGE_FLUSH_INTERVAL_MS` / `USAGE_RETENTION_DAYS`, the `GAME_MAX_*` game bounds,
`SQLITE_BUSY_TIMEOUT_MS`, and the `OTEL_*` family.
```

If the exact text differs, apply the same addition to whatever list that paragraph now holds.

5. In `## Key Documents to Read`, add:

```markdown
- `docs/pii-inventory.md` — every piece of personal data stored; update it when you add one
```

6. In `## Deployment`, add this bullet to the list under "Two consequences worth remembering when changing code" (it becomes the third):

```markdown
- `request.ip` drives the privileged-IP allowlist and every per-IP limit, so `TRUST_PROXY` on the host must
  match the real proxy hop. Changing the proxy topology is a limits change too.
```

Then change "Two consequences" to "Three consequences" in the sentence introducing that list.

- [ ] **Step 6: Update `docs/observability.md`**

In the `## Metric catalogue` table, add after the `markettrader.events.emitted` row:

```markdown
| `markettrader.limits.denied` | Counter | `limit` (a `LimitKey`, or `ip:<route>` for the per-IP route limits) — never a user id; per-user denials are in `limit_denials_hourly` |
```

- [ ] **Step 7: Update `.env.example`**

Run first: `grep -n "GAME_MAX_\|LIMITS_\|LIMIT_\|USAGE_" .env.example`

Insert the block below directly after the line `# WATCHLIST_MAX_PER_USER=20`. Omit any key the grep shows is already present; T1/T2 may have added the `GAME_MAX_*` keys.

```bash

# ──────────────────────────────────────────────────────────────────────
# User limits (all live: an admin can change them in /admin/config)
# ──────────────────────────────────────────────────────────────────────

# Master switch. false lifts every per-user and per-IP limit below — the
# emergency off switch if a limit misfires in production. Default: true.
# LIMITS_ENABLED=true

# Accounts younger than this many days are on probation and get
# LIMITS_PROBATION_PERCENT of every per-user limit (rounded up, at least 1).
# A per-user override bypasses probation. Defaults: 7 and 25.
# LIMITS_MATURITY_DAYS=7
# LIMITS_PROBATION_PERCENT=25

# Comma-separated IPs/CIDRs (IPv4 or IPv6) whose requests get every limit
# multiplied by LIMITS_PRIVILEGED_MULTIPLIER — e.g. an office where many
# players share one address. Matched against request.ip, so TRUST_PROXY must
# be right. Overrides are not multiplied. Defaults: empty and 10.
# LIMITS_PRIVILEGED_CIDRS=203.0.113.0/24,198.51.100.7
# LIMITS_PRIVILEGED_MULTIPLIER=10

# Per-user request rates (per minute).
# LIMIT_API_REQUESTS_PER_MINUTE=600
# LIMIT_TRADES_PER_MINUTE=60
# LIMIT_ORDER_CANCELS_PER_MINUTE=60
# LIMIT_CODE_LOOKUPS_PER_MINUTE=20
# LIMIT_WS_SUBSCRIBES_PER_MINUTE=30

# Per-user quotas and concurrent caps, counted from the database.
# LIMIT_GAMES_CREATED_PER_WEEK=10
# LIMIT_ACTIVE_GAMES_OWNED=5
# LIMIT_GAMES_JOINED_PER_DAY=20
# LIMIT_ACTIVE_GAMES_JOINED=30
# LIMIT_OPEN_ORDERS_PER_PLAYER=50
# LIMIT_WS_CONNECTIONS_PER_USER=10

# Accounts one IP may register per 24 h (×LIMITS_PRIVILEGED_MULTIPLIER on a
# privileged IP). Default: 5.
# LIMIT_REGISTRATIONS_PER_IP_PER_DAY=5

# How often in-memory usage counts are written to the rollup tables (ms), and
# how many days of usage history are kept. Defaults: 60000 and 30.
# USAGE_FLUSH_INTERVAL_MS=60000
# USAGE_RETENTION_DAYS=30

# Game bounds (global, not per user).
# GAME_MAX_STARTING_BALANCE=10000000
# GAME_MAX_DURATION_DAYS=365
# GAME_MAX_START_DELAY_DAYS=90
# GAME_MAX_PLAYERS=100
```

- [ ] **Step 8: Final verification**

Run each and record the output:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
git status --short packages/server/drizzle
ls packages/server/drizzle/sqlite | tail -3 && ls packages/server/drizzle/pg | tail -3
grep -c "user_limit_overrides\|api_usage_hourly\|limit_denials_hourly\|registration_ip" packages/server/drizzle/sqlite/*.sql packages/server/drizzle/pg/*.sql | grep -v ":0"
pnpm --filter frontend e2e
```

Expected:
- `pnpm test`: all packages pass. The server count is above the 890 baseline and the frontend count above 381.
- `typecheck` and `lint` exit 0.
- `git status` on `drizzle/` is clean, so every migration is committed.
- Both `drizzle/sqlite` and `drizzle/pg` contain the T7 and T15 migrations, and the `grep` lists files in **both** directories.
- e2e: all specs pass.

If any of these fails, stop and fix it before committing. Do not commit over a red suite.

- [ ] **Step 9: Commit**

```bash
git add docs/technical-decisions.md docs/design.md docs/pii-inventory.md docs/observability.md CLAUDE.md .env.example
git commit -m "docs: user limits — ADR-017, design, CLAUDE.md, PII inventory

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Deployment callout (PR description and summary)**

Put this, verbatim, in the PR description and in the final report to the user:

> **Deployment:** no new required env vars and no new proxy routes; every new option has a default and is live-editable. **Before enabling the office allowlist, verify `TRUST_PROXY` on the host matches the nginx hop.** The privileged-IP allowlist (`LIMITS_PRIVILEGED_CIDRS`) and every per-IP limit key on `request.ip`. Load `/admin/limits` from the office: the banner must show the office's public IP, not `127.0.0.1` or the proxy's address. Existing accounts are older than 7 days and therefore mature; only new signups start on probation. `LIMITS_ENABLED=false` in `/admin/config` is the emergency off switch. This branch is stacked on PR #30, so rebase once #30 merges.
