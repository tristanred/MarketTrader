# Admin Configuration Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin page (`/admin/config`) that lists every host-configurable option the server reads from its environment. It shows the effective value (secrets masked), where the value came from, and whether it can change at runtime. Options that are safe to change live can be edited in place, and the change persists across restarts.

**Architecture:**
- **Two exports from `env.ts`.** It now exports `env` (options read once at startup) and a separate `liveBootConfig` (boot values of the options an admin may override).
- **`RuntimeConfig`.** Each `buildApp` creates a `RuntimeConfig` from `liveBootConfig` and **passes it in** to everything that reads a live option, as a narrow `ConfigReader`. That is the same way `db`, `provider`, and `bus` are passed today.
- **A typed registry** describes every option for the panel.
- **`ConfigOverridesService`** persists overrides as `system_settings` rows and applies them to the app's `RuntimeConfig` at boot and on edit.
- **Three admin routes** expose it, and a React page renders it.

**Tech Stack:** Fastify v5 + `fastify-type-provider-zod` (zod 3 on the server), Drizzle ORM (SQLite + Postgres), Vitest, ESLint 9 + typescript-eslint 8, React 19 + React Query v5 + ShadCN/Tailwind, Playwright.

**Spec:** No separate spec. The **Design** section below is the spec. It was written after a code survey on 2026-10-13 and a design review with the user on the same day. Read it before Task 1.

---

## Design

### Decisions (already made with the user — do not relitigate)

1. **Runtime edits persist in the database and win over the environment until reset.**
   - The user chose this over in-memory-only edits and over writing back to `.env`.
   - Writing `.env` is ruled out: production config lives outside this repo, the file may be read-only or absent, and `process.env` does not reload.
   - The drift this creates is made visible in three ways: the panel shows the environment value next to the override and offers **Reset to environment**, a banner counts active overrides, and boot logs a `warn` listing them.
2. **Storage reuses `system_settings`.** It is already this codebase's key-value store for runtime-editable settings (`ticker_tape_symbols`, `achievements.disabled`). Each override is one row:
   - key `config.override.<KEY>`
   - value `{"value": <json>}`
   - `updatedBy` = admin user id

   **No migration.**
3. **`RuntimeConfig` is passed in, never a module singleton.**
   - Every consumer of a live option is already constructed inside `buildApp`:
     - the cached provider and `createProvider()`
     - the login tracker and the market-status cache
     - the trading, stocks, market-status, and watchlist routes
     - the price poller and the workers
   - So the config arrives the same way `db` does. Consumers depend on `ConfigReader` (`Pick<RuntimeConfig, 'get'>`), because only the override service writes.
   - Each app instance owns its config. Tests therefore need no global cleanup, have no ordering traps, and a "restart" in a test is just building a second app.
4. **The live/restart split is enforced by the compiler.**
   - Live options are not properties of `env`, so `env.WATCHLIST_MAX_ITEMS` is a type error.
   - Their boot values live in `liveBootConfig`. A `no-restricted-imports` lint rule allows only `config/runtime-config.ts` to import it as a value.
   - To make an option live, move its property from `env` to `liveBootConfig`. The compiler then lists every consumer that must start taking a `ConfigReader`.
5. **Tests configure options by injection, never by mutating `env`.**
   - To simulate the boot environment: `RuntimeConfig.fromEnvironment({ KEY: value })`, passed to `createTestApp`.
   - To simulate an admin override at runtime: `config.set(...)`.
   - The two test files that currently mutate `env` through `as any` are migrated, which removes their `any` casts.
6. **Only `env.ts` reads `process.env`.** It records which variables were present at boot (`wasSetInEnvironment`), and the panel uses that to tell "environment" from "default". The one exception, `MOCK_PRICES` in `providers/factory.ts`, predates this work and is left alone.
7. **Restart-only options are read-only in the UI**, each with the reason. There is no "staged for next boot" value: `env` is evaluated before the database is reachable.
8. **Secrets are never sent to the client and never live-editable.** The response reports `isSet` only. URL credentials (userinfo and `token`/`authToken`-style query params) are masked.
9. **Overrides have tighter bounds than environment parsing.**
   - This was accepted explicitly: a mis-click in the panel should not be able to set a 1 ms cache TTL.
   - The environment keeps its existing "positive integer" rules, so no host that boots today will fail to boot.
   - The split is documented in the panel's bounds hint and in `CLAUDE.md`.
10. **Frontend `VITE_*` build-time values are shown read-only** in a separate card, read from `import.meta.env`.

### Which options are live

| Task | Options made live | Consumer change |
|---|---|---|
| 1 | `WATCHLIST_MAX_ITEMS`, `WATCHLIST_MAX_PER_USER` | `watchlistRoutes(db, config)` |
| 2 | `STOCK_CACHE_TTL_MS`, `STOCK_SEARCH_CACHE_TTL_MS`, `STOCK_HISTORY_CACHE_TTL_MS`, `STOCK_STALE_PRICE_MAX_AGE_MS`, `STOCK_RATE_LIMIT_BACKOFF_MS`, `STOCK_ALLOW_STALE_TRADES`, `STOCK_STALE_TRADE_MAX_AGE_MS` | `CachedProvider`, `YahooProvider`, `createProvider`, stocks/market-status/trading routes take `config` |
| 3 | `PRICE_POLLER_MAX_SYMBOLS` | `pollPrices` / `startPricePoller` take `config` |
| 4 | `MARKET_HOURS_MODE`, `MARKET_HOURS_INCLUDE_EXTENDED` | trading route; pending-orders worker takes `config` **and starts in every mode** |
| 5 | `LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_FAILURE_WINDOW_MS`, `LOGIN_LOCKOUT_MS`, `MARKET_STATUS_CACHE_TTL_MS` | `FailedLoginTracker(config, opts)`; `CachedMarketStatus` takes a TTL getter |
| 6 *(optional)* | `PENDING_ORDERS_TICK_MS`, `PORTFOLIO_SNAPSHOT_INTERVAL_MS`, `DISCOVER_REFRESH_INTERVAL_MS` | `startIntervalWorker` accepts an interval getter |

Everything else stays restart-only: `DATABASE_URL`, `JWT_SECRET`, `PORT`, `CORS_ORIGIN`, `TRUST_PROXY`, `NODE_ENV`, `STOCK_PROVIDER`, the Alpaca keys, `MARKET_STATUS_PROVIDER`, `WS_HEARTBEAT_INTERVAL_MS`, `WS_REVALIDATE_INTERVAL_MS`, `SQLITE_BUSY_TIMEOUT_MS`, all `OTEL_*`, and all `POSTHOG_*`. The two `WS_*` intervals are judgment calls:
- **The heartbeat:** its missed-ping check assumes a fixed period.
- **The revalidation sweep:** each route arms its timer once.

Task 6 is independently droppable. It touches the timer code every worker shares, and those intervals are rarely tuned. If it is dropped, those three keys simply stay in `env`.

### Pre-existing bug fixed along the way (Task 4)

`app.ts` starts the pending-orders worker only when `MARKET_HOURS_MODE === 'pending'`. That worker also runs `evaluateTriggers` (limit/stop/bracket fills) and `expireDayOrders`, so under the default `instant` mode resting orders never fill or expire. `docs/design.md` → *Known Gaps* already records this.

Making the mode live requires starting the worker unconditionally, which closes the gap. Production already runs `pending` (`provision.sh`), so its behavior is unchanged. On a default-configured dev server, stuck resting orders will start to fill or expire.

---

## Global Constraints

- TypeScript strict, **no `any`**. Use `unknown` and narrow. Shared contracts live in `packages/shared`.
- Validate at route entry with Zod; services trust their inputs.
- Drizzle query builder only, no raw SQL. **No schema change, no migration.**
- Every admin mutation writes an audit row through `recordAdminAction` **in the same transaction** as the mutation. In-memory runtime state changes only **after** the transaction commits.
- Secrets (`JWT_SECRET`, `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, `POSTHOG_KEY`) never appear in a response body, log line, or audit row.
- **No module-level mutable config state.** A consumer of a live option takes a `ConfigReader` parameter. It never imports `liveBootConfig` and never reads a live option at construction time.
- No new environment variable, proxy route, or process-launch change.
- JSDoc on every exported function, class, and interface (1–4 lines). Inline `//` comments only for *why*.
- After editing `packages/shared`, run `pnpm build:shared` before server tests, or use root `pnpm test` / `pnpm typecheck`.
- Server tests: `pnpm --filter server test -- <paths>`. Frontend tests: `pnpm --filter frontend test -- <paths>`. Gate before each commit: `pnpm typecheck && pnpm lint`.
- Conventional commit style (`feat(config): …`, `fix(workers): …`, `test(…): …`).

## Review Focus

1. **Credential leakage through `GET /admin/config`.** `JWT_SECRET`, the Alpaca keys, the PostHog key, a Postgres URL password, and a libsql `?authToken=` must not appear anywhere in the serialized body. *Pinned by:* Task 7 `redactConfigUrl` tests, plus the Task 8 whole-body scan.
2. **A stale or invalid override row at boot.** This covers a renamed key, a key later made restart-only, tightened bounds, and corrupt JSON. Each row is skipped with a `warn`, never crashes boot, and is never applied. *Pinned by:* Task 7, "`load()` applies valid rows and skips invalid ones".
3. **Overrides survive a restart, and so does a reset.** A second app built on the same database sees the override, and after `DELETE` it sees the environment value. *Pinned by:* Task 8, "persists across a rebuild".
4. **Fat-finger values change nothing.** Out-of-range values, `1.5`, the string `"60000"` for an integer, the string `"true"` for a boolean, and an enum value outside the options must return 400, with the runtime value and the database untouched. *Pinned by:* Task 8 validation tests.
5. **Hostile key path segments.** `toString`, `__proto__`, `constructor`, and a lower-cased key must return 404, never 500, and never resolve to a prototype member. *Pinned by:* Task 1 `isConfigKey` tests and the Task 8 404 test.

---

## File Structure

**Server — create**
- `src/config/registry.ts`: descriptors for every option, the key types, and helpers (`isConfigKey`, `isLiveKey`, `liveKeys`, `descriptorFor`, `liveValueSchema`, `isExplicitlySet`).
- `src/config/runtime-config.ts`: `RuntimeConfig` and `ConfigReader`. This is the only value importer of `liveBootConfig`.
- `src/config/redact.ts`: `redactConfigUrl`.
- `src/services/config-overrides.ts`: `ConfigOverridesService`.
- `src/routes/admin/config.ts`: the three admin routes.
- Tests: `tests/config/registry.test.ts`, `tests/config/runtime-config.test.ts`, `tests/config/live-behavior.test.ts`, `tests/config/redact.test.ts`, `tests/services/config-overrides.test.ts`, `tests/routes/admin-config.test.ts`, `tests/app-workers.test.ts`.

**Server — modify**
- `src/env.ts`: the `liveBootConfig` split, `wasSetInEnvironment`, and exported `VALID_*` tuples.
- `src/app.ts`: the `runtimeConfig` option, plus wiring.
- Live-option consumers, per the table above.
- `tests/helpers/app.ts`: an options argument, and `config` in the return value.
- Migrated tests: `tests/routes/trading.test.ts`, `tests/routes/trading-market-hours.test.ts`, `tests/auth.test.ts`, `tests/services/failed-login.test.ts`.
- Call-site updates: `tests/providers/{cached-provider,yahoo,factory}.test.ts`, `tests/security/{f19-price-poller-fanout,f24-search-cache-normalization}.test.ts`, `tests/ws/price-poller.test.ts`, `tools/seed-game-history/src/historical-prices.ts`.
- `eslint.config.mjs`: the `liveBootConfig` import restriction.

**Shared — create**
- `packages/shared/src/types/admin-config.ts`, exported from `packages/shared/src/index.ts`.

**Frontend — create**
- `src/api/admin/config.ts`, `src/lib/configFormat.ts`, `src/lib/clientBuildConfig.ts`, `src/components/admin/ConfigValueEditor.tsx`, `src/components/admin/ConfigEntryRow.tsx`, `src/pages/admin/AdminConfigPage.tsx`.
- Tests: `tests/lib/configFormat.test.ts`, `tests/components/admin/ConfigEntryRow.test.tsx`, `tests/pages/AdminConfigPage.test.tsx`, `e2e/admin/config.spec.ts`.

**Frontend — modify**
- `src/components/admin/AdminLayout.tsx`, `src/App.tsx`.

**Docs**
- `CLAUDE.md` (Task 8), `docs/design.md` (Tasks 4 and 10), `.env.example` (Task 10), `.changeset/admin-config-panel.md` (Task 10).

---

### Task 1: Foundations — the env split, registry, `RuntimeConfig`, injection, and the first live options

This task is larger than the others because the build only compiles once an option has moved out of `env` *and* its consumer takes a `ConfigReader`. The watchlist caps are the smallest consumer, so they prove the whole path.

**Files:**
- Create: `packages/shared/src/types/admin-config.ts`; modify `packages/shared/src/index.ts`
- Modify: `packages/server/src/env.ts`
- Create: `packages/server/src/config/registry.ts`, `packages/server/src/config/runtime-config.ts`
- Modify: `packages/server/src/app.ts`, `packages/server/src/routes/watchlists.ts`
- Modify: `packages/server/tests/helpers/app.ts`
- Modify: `eslint.config.mjs`
- Test: `packages/server/tests/config/registry.test.ts`, `packages/server/tests/config/runtime-config.test.ts`, `packages/server/tests/config/live-behavior.test.ts`

**Interfaces:**
- Produces, from shared: `ConfigValue`, `ConfigCategory`, `ConfigKind`, `ConfigMutability`, `ConfigValueSource`, `AdminConfigOverride`, `AdminConfigEntry`, `AdminConfigResponse`, `AdminSetConfigRequest`.
- Produces, from `env.ts`:
  - `env` (restart-only options) and `liveBootConfig` (boot values of live options)
  - `wasSetInEnvironment(name: string): boolean`
  - `VALID_PROVIDERS`, `VALID_MARKET_STATUS_PROVIDERS`, `VALID_MARKET_HOURS_MODES`, `VALID_NODE_ENVS`
- Produces, from the registry:
  - types: `RestartKey`, `LiveKey`, `EnvKey`, `LiveConfigValues`, `ConfigDescriptor`, `LiveDescriptor`, `RestartDescriptor`
  - the `CONFIG_REGISTRY` object
  - helpers: `isConfigKey(key: string): key is EnvKey`, `isLiveKey(key: string): key is LiveKey`, `liveKeys(): LiveKey[]`, `descriptorFor(key: EnvKey): ConfigDescriptor`, `liveValueSchema<K extends LiveKey>(key: K): z.ZodType<LiveConfigValues[K]>`, `isExplicitlySet(key: EnvKey): boolean`
- Produces, from `runtime-config.ts`:
  - `ConfigReader = Pick<RuntimeConfig, 'get'>`
  - `class RuntimeConfig`:
    - `static fromEnvironment(assume?: Partial<LiveConfigValues>)`
    - `get<K>(key)`, `bootValue<K>(key)`, `set<K>(key, value)`
    - `clear<K>(key)`, `clearAll()`, `overriddenKeys(): LiveKey[]`
- Produces, from `buildApp`: option `runtimeConfig?: RuntimeConfig`.
- Produces, from the test helpers: `createTestApp(provider?, marketStatus?, options?: TestAppOptions)` and `createTestAppWithDb(...)`, which returns `{ app, db, config }`.
- Produces: `watchlistRoutes(db: Db, config: ConfigReader)`.

- [ ] **Step 1: Write the shared types**

Create `packages/shared/src/types/admin-config.ts`:

```ts
/**
 * Contract for the admin configuration panel (`/admin/config`). Every option the
 * server reads from its environment is described by one {@link AdminConfigEntry}.
 */

/** A configuration value as it crosses the wire. */
export type ConfigValue = string | number | boolean;

/** Grouping used by the panel; one card per category. */
export type ConfigCategory =
  | 'core'
  | 'security'
  | 'database'
  | 'stock-data'
  | 'market-hours'
  | 'workers'
  | 'limits'
  | 'websocket'
  | 'observability'
  | 'analytics';

/** How the panel renders and validates a value. */
export type ConfigKind = 'string' | 'integer' | 'boolean' | 'enum';

/** `live` options can be overridden at runtime; `restart` options are read once at boot. */
export type ConfigMutability = 'live' | 'restart';

/** Where the effective value came from: built-in default, the process environment, or an admin override. */
export type ConfigValueSource = 'default' | 'env' | 'override';

/** An active admin override of a live option. */
export interface AdminConfigOverride {
  value: ConfigValue;
  updatedAt: string;
  /** Username of the admin who set it; null if that account no longer exists. */
  updatedBy: string | null;
}

/** One option as returned by `GET /admin/config`. */
export interface AdminConfigEntry {
  key: string;
  /** Variable names read, in precedence order — more than one only for legacy aliases. */
  envVars: string[];
  category: ConfigCategory;
  description: string;
  kind: ConfigKind;
  unit: 'ms' | null;
  /** Allowed values for `enum` kinds; null otherwise. */
  options: string[] | null;
  /** Inclusive override bounds for live `integer` kinds; null otherwise. */
  min: number | null;
  max: number | null;
  mutability: ConfigMutability;
  /** Why a `restart` option cannot change live; null for live options. */
  restartReason: string | null;
  /** When true, `bootValue`/`effectiveValue` are always null — only `isSet` is reported. */
  secret: boolean;
  /** Whether a non-empty value is configured. */
  isSet: boolean;
  source: ConfigValueSource;
  /** What the process booted with (environment or default). URL credentials are masked. */
  bootValue: ConfigValue | null;
  /** What the server uses right now: the override if one is active, else `bootValue`. */
  effectiveValue: ConfigValue | null;
  override: AdminConfigOverride | null;
}

/** Response of `GET /admin/config`, entries in registry order (grouped by category). */
export interface AdminConfigResponse {
  entries: AdminConfigEntry[];
}

/** Body of `PUT /admin/config/:key`. The value's JSON type must match the option's kind. */
export interface AdminSetConfigRequest {
  value: ConfigValue;
}
```

Add `export * from './types/admin-config.js';` to `packages/shared/src/index.ts`, right after the `admin.js` line.

- [ ] **Step 2: Split `env.ts`, record explicit variables, export the option tuples**

In `packages/server/src/env.ts`:

(a) Add `export` to the four tuples: `VALID_PROVIDERS`, `VALID_MARKET_STATUS_PROVIDERS`, `VALID_MARKET_HOURS_MODES`, `VALID_NODE_ENVS`.

(b) Route every `process.env` read through one recorder. Replace `optional` and `required` with these, and add `wasSetInEnvironment`:

```ts
// Names present in the process environment at boot, even if empty. Lets the
// admin panel tell "set by the host" from "built-in default" without any other
// module reading process.env.
const explicitlySet = new Set<string>();

function read(name: string): string | undefined {
  const value = process.env[name];
  if (value !== undefined) explicitlySet.add(name);
  return value;
}

function optional(name: string, fallback: string): string {
  return read(name) ?? fallback;
}

function required(name: string): string {
  const value = read(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** True when `name` was present in the process environment at boot, even if empty. */
export function wasSetInEnvironment(name: string): boolean {
  return explicitlySet.has(name);
}
```

In `validatedMarketStatusProvider`, replace `const raw = process.env.MARKET_STATUS_PROVIDER;` with `const raw = read('MARKET_STATUS_PROVIDER');`.

(c) Move `WATCHLIST_MAX_ITEMS` and `WATCHLIST_MAX_PER_USER` out of `env`. Cut both properties, JSDoc included, and paste them into a new export placed directly after the `env` object:

```ts
/**
 * Boot values of the options an admin may override at runtime from
 * `/admin/config`. Never read them directly: a consumer takes a `ConfigReader`
 * and calls `get`, so an override reaches it. Only `RuntimeConfig.fromEnvironment`
 * imports this — `no-restricted-imports` in eslint.config.mjs enforces it.
 *
 * Making an option live means moving its property here from {@link env}; the
 * compiler then lists every consumer that must start taking a `ConfigReader`.
 */
export const liveBootConfig = {
  /** Symbols one watchlist may hold. Adds past it are refused with 409. */
  WATCHLIST_MAX_ITEMS: parsePositiveInt(
    'WATCHLIST_MAX_ITEMS',
    optional('WATCHLIST_MAX_ITEMS', '50'),
  ),
  /** Watchlists one user may own. Creates past it are refused with 409. */
  WATCHLIST_MAX_PER_USER: parsePositiveInt(
    'WATCHLIST_MAX_PER_USER',
    optional('WATCHLIST_MAX_PER_USER', '20'),
  ),
} as const;
```

- [ ] **Step 3: Write the failing registry and `RuntimeConfig` tests**

Create `packages/server/tests/config/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  CONFIG_REGISTRY,
  descriptorFor,
  isConfigKey,
  isLiveKey,
  liveKeys,
  liveValueSchema,
} from '../../src/config/registry.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

// That the registry covers exactly env + liveBootConfig — and marks each key
// with the right mutability — is enforced at compile time by its `satisfies`.

describe('CONFIG_REGISTRY', () => {
  it('never marks a secret as live', () => {
    for (const key of liveKeys()) expect(descriptorFor(key).secret ?? false, key).toBe(false);
  });

  it('bounds every live integer', () => {
    for (const key of liveKeys()) {
      const d = descriptorFor(key);
      if (d.kind !== 'integer' || d.mutability !== 'live') continue;
      expect(d.min, `${key}.min`).toBeTypeOf('number');
      expect(d.max, `${key}.max`).toBeTypeOf('number');
      expect(d.min!, key).toBeLessThanOrEqual(d.max!);
    }
  });

  it('gives every enum its options and every restart option a reason', () => {
    for (const key of Object.keys(CONFIG_REGISTRY)) {
      if (!isConfigKey(key)) throw new Error(key);
      const d = descriptorFor(key);
      if (d.kind === 'enum') expect(d.options?.length, key).toBeGreaterThan(0);
      if (d.mutability === 'restart') expect(d.restartReason.length, key).toBeGreaterThan(0);
    }
  });

  // liveValueSchema's one cast relies on this: each live descriptor's kind must
  // describe the type env.ts actually parses for that key.
  it('declares a kind matching each live boot value', () => {
    const config = RuntimeConfig.fromEnvironment();
    for (const key of liveKeys()) {
      const d = descriptorFor(key);
      const value = config.bootValue(key);
      if (d.kind === 'integer') expect(Number.isInteger(value), key).toBe(true);
      if (d.kind === 'boolean') expect(typeof value, key).toBe('boolean');
      if (d.kind === 'enum') expect(d.options, key).toContain(value);
      if (d.kind === 'string') expect(typeof value, key).toBe('string');
    }
  });
});

describe('isConfigKey / isLiveKey', () => {
  it.each(['toString', '__proto__', 'constructor', 'hasOwnProperty', 'watchlist_max_items', 'NOPE', ''])(
    'rejects %j',
    (key) => {
      expect(isConfigKey(key)).toBe(false);
      expect(isLiveKey(key)).toBe(false);
    },
  );

  it('distinguishes live from restart keys', () => {
    expect(isLiveKey('WATCHLIST_MAX_ITEMS')).toBe(true);
    expect(isConfigKey('JWT_SECRET')).toBe(true);
    expect(isLiveKey('JWT_SECRET')).toBe(false);
  });
});

describe('liveValueSchema', () => {
  it('enforces integer bounds and JSON type', () => {
    const schema = liveValueSchema('WATCHLIST_MAX_ITEMS');
    expect(schema.safeParse(50).success).toBe(true);
    expect(schema.safeParse(0).success).toBe(false);
    expect(schema.safeParse(501).success).toBe(false);
    expect(schema.safeParse(1.5).success).toBe(false);
    expect(schema.safeParse('50').success).toBe(false);
  });
});
```

Create `packages/server/tests/config/runtime-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

describe('RuntimeConfig', () => {
  it('serves boot values until overridden, and again after clear', () => {
    const config = RuntimeConfig.fromEnvironment({ WATCHLIST_MAX_ITEMS: 50 });
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(50);
    config.set('WATCHLIST_MAX_ITEMS', 3);
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(3);
    expect(config.bootValue('WATCHLIST_MAX_ITEMS')).toBe(50);
    expect(config.overriddenKeys()).toEqual(['WATCHLIST_MAX_ITEMS']);
    config.clear('WATCHLIST_MAX_ITEMS');
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(50);
    expect(config.overriddenKeys()).toEqual([]);
  });

  it('clearAll restores every boot value', () => {
    const config = RuntimeConfig.fromEnvironment({ WATCHLIST_MAX_ITEMS: 50, WATCHLIST_MAX_PER_USER: 20 });
    config.set('WATCHLIST_MAX_ITEMS', 3);
    config.set('WATCHLIST_MAX_PER_USER', 2);
    config.clearAll();
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(50);
    expect(config.get('WATCHLIST_MAX_PER_USER')).toBe(20);
    expect(config.overriddenKeys()).toEqual([]);
  });

  it('keeps instances independent', () => {
    const a = RuntimeConfig.fromEnvironment();
    const b = RuntimeConfig.fromEnvironment();
    a.set('WATCHLIST_MAX_ITEMS', 3);
    expect(b.get('WATCHLIST_MAX_ITEMS')).not.toBe(3);
  });
});
```

- [ ] **Step 4: Write the failing end-to-end behavior test**

Create `packages/server/tests/config/live-behavior.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestAppWithDb } from '../helpers/app.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';

describe('live options reach their consumers', () => {
  let app: FastifyInstance;
  let config: RuntimeConfig;
  let token: string;

  beforeAll(async () => {
    ({ app, config } = await createTestAppWithDb());
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'live-watchlist', password: 'password123' },
    });
    token = res.json<{ token: string }>().token;
  });

  afterAll(async () => {
    await app.close();
  });

  const create = (name: string) =>
    app.inject({
      method: 'POST',
      url: '/watchlists',
      headers: { authorization: `Bearer ${token}` },
      payload: { name },
    });

  it('WATCHLIST_MAX_PER_USER applies to the next create, and clearing restores it', async () => {
    expect((await create('first')).statusCode).toBe(201);

    config.set('WATCHLIST_MAX_PER_USER', 1);
    const blocked = await create('second');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ error: string }>().error).toContain('(1 per user)');

    config.clear('WATCHLIST_MAX_PER_USER');
    expect((await create('second')).statusCode).toBe(201);
  });
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `pnpm build:shared && pnpm --filter server test -- tests/config`
Expected: FAIL, `Cannot find module '../../src/config/registry.js'` (and `runtime-config.js`). `pnpm typecheck` also fails in `routes/watchlists.ts`: `Property 'WATCHLIST_MAX_PER_USER' does not exist on type …`. That failure is the compile-time guard working.

- [ ] **Step 6: Write the registry**

Create `packages/server/src/config/registry.ts`.

In this task only the two watchlist keys are `LiveDescriptor`s. Every other key that a later task will make live starts as a `RestartDescriptor`, with the `restartReason` shown here. Each later task gives the exact replacement descriptor.

```ts
import { z } from 'zod';
import type { ConfigCategory, ConfigKind } from '@markettrader/shared';
import {
  type env,
  type liveBootConfig,
  VALID_MARKET_HOURS_MODES,
  VALID_MARKET_STATUS_PROVIDERS,
  VALID_NODE_ENVS,
  VALID_PROVIDERS,
  wasSetInEnvironment,
} from '../env.js';

/** Options read once at startup. */
export type RestartKey = keyof typeof env;
/** Options an admin may override at runtime. */
export type LiveKey = keyof typeof liveBootConfig;
export type EnvKey = RestartKey | LiveKey;

/** Typed, mutable view of the live options' values. */
export type LiveConfigValues = { -readonly [K in LiveKey]: (typeof liveBootConfig)[K] };

interface DescriptorBase {
  category: ConfigCategory;
  kind: ConfigKind;
  description: string;
  /** Variable names read, in precedence order, when they differ from the key. */
  envVars?: readonly string[];
  unit?: 'ms';
  options?: readonly string[];
  /** Never sent to the client; the panel only learns whether it is set. */
  secret?: boolean;
  /** A URL whose credentials are masked before display. */
  redactUrl?: boolean;
}

/** An option the admin panel may override. `min`/`max` bound overrides, not the environment. */
export interface LiveDescriptor extends DescriptorBase {
  mutability: 'live';
  min?: number;
  max?: number;
}

/** An option consumed once at startup and therefore shown read-only. */
export interface RestartDescriptor extends DescriptorBase {
  mutability: 'restart';
  restartReason: string;
}

export type ConfigDescriptor = LiveDescriptor | RestartDescriptor;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const PROVIDER_BOOT = 'The provider client is constructed once at startup.';
const OTEL_BOOT = 'The OpenTelemetry SDK and log transport start before the app is built.';
const POSTHOG_BOOT = 'The PostHog client and log transport start before the app is built.';

/**
 * Describes every option for the admin configuration panel. The `satisfies`
 * clause requires exactly one descriptor per key of `env` (restart) and of
 * `liveBootConfig` (live), so moving a key between them forces its descriptor
 * to change kind too.
 */
export const CONFIG_REGISTRY = {
  // ── core ────────────────────────────────────────────────────────────────
  PORT: {
    category: 'core', kind: 'integer', mutability: 'restart',
    description: 'TCP port the HTTP server listens on.',
    restartReason: 'Bound once by listen() at startup.',
  },
  NODE_ENV: {
    category: 'core', kind: 'enum', options: VALID_NODE_ENVS, mutability: 'restart',
    description: 'Runtime mode. production enables boot-time hardening checks and secure cookies.',
    restartReason: 'Selects logging, hardening, and cookie flags at startup.',
  },
  CORS_ORIGIN: {
    category: 'core', kind: 'string', mutability: 'restart',
    description: 'Frontend origin allowed to call the API cross-origin.',
    restartReason: 'Passed to @fastify/cors when the server is built.',
  },

  // ── security ────────────────────────────────────────────────────────────
  JWT_SECRET: {
    category: 'security', kind: 'string', secret: true, mutability: 'restart',
    description: 'Signs access and refresh tokens. At least 32 characters in production.',
    restartReason: 'Changing it invalidates every issued token; set it in the environment.',
  },
  TRUST_PROXY: {
    category: 'security', kind: 'string', mutability: 'restart',
    description: 'Which upstream hops may set X-Forwarded-For. Decides request.ip, the key of every rate limit.',
    restartReason: 'Fastify reads it once when the server is constructed.',
  },
  LOGIN_MAX_FAILED_ATTEMPTS: {
    category: 'security', kind: 'integer', mutability: 'restart',
    description: 'Consecutive failed logins for one username before it is throttled.',
    restartReason: 'Captured when the login tracker is constructed.',
  },
  LOGIN_FAILURE_WINDOW_MS: {
    category: 'security', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'Failures older than this stop counting toward the threshold.',
    restartReason: 'Captured when the login tracker is constructed.',
  },
  LOGIN_LOCKOUT_MS: {
    category: 'security', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How long a throttled username stays locked. Keep short: anyone can trigger it for any name.',
    restartReason: 'Captured when the login tracker is constructed.',
  },

  // ── database ────────────────────────────────────────────────────────────
  DATABASE_URL: {
    category: 'database', kind: 'string', redactUrl: true, mutability: 'restart',
    description: 'postgres:// URL, libsql URL, or SQLite file path.',
    restartReason: 'The database connection is opened before anything else.',
  },
  SQLITE_BUSY_TIMEOUT_MS: {
    category: 'database', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How long a SQLite writer waits on a contended lock. Ignored under Postgres.',
    restartReason: 'Applied as a per-connection PRAGMA at startup.',
  },

  // ── stock data ──────────────────────────────────────────────────────────
  STOCK_PROVIDER: {
    category: 'stock-data', kind: 'enum', options: VALID_PROVIDERS, mutability: 'restart',
    description: 'Upstream price provider.',
    restartReason: PROVIDER_BOOT,
  },
  ALPACA_API_KEY_ID: {
    category: 'stock-data', kind: 'string', secret: true, mutability: 'restart',
    envVars: ['ALPACA_API_KEY_ID', 'ALPACA_API_KEY'],
    description: 'Alpaca API key ID. Required with the secret when either provider is alpaca.',
    restartReason: PROVIDER_BOOT,
  },
  ALPACA_API_SECRET_KEY: {
    category: 'stock-data', kind: 'string', secret: true, mutability: 'restart',
    description: 'Alpaca API secret key.',
    restartReason: PROVIDER_BOOT,
  },
  STOCK_CACHE_TTL_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How long a cached quote is served before re-fetching upstream.',
    restartReason: 'Not yet routed through runtime config.',
  },
  STOCK_SEARCH_CACHE_TTL_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How long symbol-search results are cached.',
    restartReason: 'Not yet routed through runtime config.',
  },
  STOCK_HISTORY_CACHE_TTL_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How long price-history results are cached.',
    restartReason: 'Not yet routed through runtime config.',
  },
  STOCK_STALE_PRICE_MAX_AGE_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'While rate-limited, cached quotes up to this old are served instead of an error.',
    restartReason: 'Not yet routed through runtime config.',
  },
  STOCK_RATE_LIMIT_BACKOFF_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'After an upstream 429, refuse upstream calls for this long.',
    restartReason: 'Not yet routed through runtime config.',
  },
  STOCK_ALLOW_STALE_TRADES: {
    category: 'stock-data', kind: 'boolean', mutability: 'restart',
    description: 'When rate-limited, fill trades at the cached price instead of rejecting. Favors availability over fairness.',
    restartReason: 'Not yet routed through runtime config.',
  },
  STOCK_STALE_TRADE_MAX_AGE_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'Stale trades using a cached price older than this are rejected anyway.',
    restartReason: 'Not yet routed through runtime config.',
  },

  // ── market hours ────────────────────────────────────────────────────────
  MARKET_STATUS_PROVIDER: {
    category: 'market-hours', kind: 'enum', options: VALID_MARKET_STATUS_PROVIDERS, mutability: 'restart',
    description: 'Source of open/closed market state. Defaults to match STOCK_PROVIDER.',
    restartReason: PROVIDER_BOOT,
  },
  MARKET_STATUS_CACHE_TTL_MS: {
    category: 'market-hours', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How long the market open/closed state is cached.',
    restartReason: 'Captured when the market-status cache is constructed.',
  },
  MARKET_HOURS_MODE: {
    category: 'market-hours', kind: 'enum', options: VALID_MARKET_HOURS_MODES, mutability: 'restart',
    description: 'Closed-market trades: instant fills at last price, disabled rejects, pending queues for next open.',
    restartReason: 'The pending-orders worker is only started when the server boots in pending mode.',
  },
  MARKET_HOURS_INCLUDE_EXTENDED: {
    category: 'market-hours', kind: 'boolean', mutability: 'restart',
    description: 'Count pre- and post-market sessions as open for trading.',
    restartReason: 'Not yet routed through runtime config.',
  },

  // ── workers ─────────────────────────────────────────────────────────────
  PENDING_ORDERS_TICK_MS: {
    category: 'workers', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How often pending orders settle and resting orders are checked for fills and expiry.',
    restartReason: 'The worker arms its timer once at startup.',
  },
  PORTFOLIO_SNAPSHOT_INTERVAL_MS: {
    category: 'workers', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How often every active player’s portfolio value is captured for charts.',
    restartReason: 'The worker arms its timer once at startup.',
  },
  DISCOVER_REFRESH_INTERVAL_MS: {
    category: 'workers', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How often the Discover worker looks for missing market-mover and daily-pick lists.',
    restartReason: 'The worker arms its timer once at startup.',
  },

  // ── limits ──────────────────────────────────────────────────────────────
  PRICE_POLLER_MAX_SYMBOLS: {
    category: 'limits', kind: 'integer', mutability: 'restart',
    description: 'Most symbols one price-poller tick may fetch. Watchlist symbols are dropped first.',
    restartReason: 'Not yet routed through runtime config.',
  },
  WATCHLIST_MAX_ITEMS: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 500,
    description: 'Symbols one watchlist may hold. Lowering it does not trim existing lists.',
  },
  WATCHLIST_MAX_PER_USER: {
    category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 200,
    description: 'Watchlists one user may own. Lowering it does not delete existing lists.',
  },

  // ── websocket ───────────────────────────────────────────────────────────
  WS_HEARTBEAT_INTERVAL_MS: {
    category: 'websocket', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'Ping cadence for live sockets. Keep below the proxy idle timeout.',
    restartReason: 'Armed once, and the missed-ping check assumes a fixed period.',
  },
  WS_REVALIDATE_INTERVAL_MS: {
    category: 'websocket', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How often live sockets are re-checked for expired tokens and revoked access.',
    restartReason: 'Each WebSocket route arms its sweep timer once at registration.',
  },

  // ── observability ───────────────────────────────────────────────────────
  OTEL_EXPORTER_OTLP_ENDPOINT: {
    category: 'observability', kind: 'string', redactUrl: true, mutability: 'restart',
    description: 'OTLP/HTTP collector base URL. Empty disables all telemetry.',
    restartReason: OTEL_BOOT,
  },
  OTEL_SERVICE_NAME: {
    category: 'observability', kind: 'string', mutability: 'restart',
    description: 'service.name on every span, metric, and log record.',
    restartReason: OTEL_BOOT,
  },
  OTEL_METRIC_EXPORT_INTERVAL_MS: {
    category: 'observability', kind: 'integer', unit: 'ms', mutability: 'restart',
    description: 'How often metrics are pushed to the collector.',
    restartReason: OTEL_BOOT,
  },
  OTEL_LOG_LEVEL_MIN: {
    category: 'observability', kind: 'string', mutability: 'restart',
    description: 'Minimum pino level shipped over OTLP. stdout still gets everything.',
    restartReason: OTEL_BOOT,
  },

  // ── analytics ───────────────────────────────────────────────────────────
  POSTHOG_KEY: {
    category: 'analytics', kind: 'string', secret: true, mutability: 'restart',
    description: 'PostHog project token. With POSTHOG_HOST, enables server analytics, errors, and logs.',
    restartReason: POSTHOG_BOOT,
  },
  POSTHOG_HOST: {
    category: 'analytics', kind: 'string', redactUrl: true, mutability: 'restart',
    description: 'PostHog ingestion host.',
    restartReason: POSTHOG_BOOT,
  },
  POSTHOG_LOG_LEVEL_MIN: {
    category: 'analytics', kind: 'string', mutability: 'restart',
    description: 'Minimum pino level exported to PostHog Logs (billed by volume).',
    restartReason: POSTHOG_BOOT,
  },
} as const satisfies { [K in RestartKey]: RestartDescriptor } & { [K in LiveKey]: LiveDescriptor };

/** True for an own key of the registry; prototype names like `toString` are rejected. */
export function isConfigKey(key: string): key is EnvKey {
  return Object.hasOwn(CONFIG_REGISTRY, key);
}

/** The descriptor for `key`, widened so optional fields can be read without narrowing. */
export function descriptorFor(key: EnvKey): ConfigDescriptor {
  return CONFIG_REGISTRY[key];
}

/** True when `key` names an option the admin panel may override at runtime. */
export function isLiveKey(key: string): key is LiveKey {
  return isConfigKey(key) && descriptorFor(key).mutability === 'live';
}

/** Every live key, in registry order. */
export function liveKeys(): LiveKey[] {
  return Object.keys(CONFIG_REGISTRY).filter((k): k is LiveKey => isLiveKey(k));
}

/** True when any of the key's variables was present in the process environment at boot. */
export function isExplicitlySet(key: EnvKey): boolean {
  return (descriptorFor(key).envVars ?? [key]).some(wasSetInEnvironment);
}

/**
 * Zod schema an override of `key` must satisfy. Stricter than env parsing:
 * integers carry the descriptor's bounds, and JSON types must match exactly.
 */
export function liveValueSchema<K extends LiveKey>(key: K): z.ZodType<LiveConfigValues[K]> {
  const d = descriptorFor(key);
  if (d.mutability !== 'live') throw new Error(`${key} is not live`);
  // The schema is built from the descriptor's kind, and registry.test.ts checks
  // that each live kind matches the type env.ts parses — which is what makes
  // this the right value type for K.
  return schemaForKind(key, d) as z.ZodType<LiveConfigValues[K]>;
}

function schemaForKind(key: string, d: LiveDescriptor): z.ZodType<string | number | boolean> {
  switch (d.kind) {
    case 'integer':
      return z.number().int().min(d.min ?? 1).max(d.max ?? Number.MAX_SAFE_INTEGER);
    case 'boolean':
      return z.boolean();
    case 'enum': {
      const [first, ...rest] = d.options ?? [];
      if (first === undefined) throw new Error(`${key} has no options`);
      const values: [string, ...string[]] = [first, ...rest];
      return z.enum(values);
    }
    case 'string':
      return z.string().max(2048);
  }
}
```

`type env` and `type liveBootConfig` are type-only imports of values, which TypeScript allows for `typeof` use. The registry never reads either at runtime, and the lint rule in Step 9 permits type imports.

- [ ] **Step 7: Write `RuntimeConfig`**

Create `packages/server/src/config/runtime-config.ts`:

```ts
import { liveBootConfig } from '../env.js';
import type { LiveConfigValues, LiveKey } from './registry.js';

/** Read-only view of a {@link RuntimeConfig}: what every consumer of a live option takes. */
export type ConfigReader = Pick<RuntimeConfig, 'get'>;

/**
 * Effective values of the live options for one app instance: an admin override
 * when one is active, otherwise the boot value. Built once per `buildApp` and
 * passed to consumers as a {@link ConfigReader}; only `ConfigOverridesService` writes.
 */
export class RuntimeConfig {
  private readonly boot: LiveConfigValues;
  private readonly current: LiveConfigValues;
  private readonly overridden = new Set<LiveKey>();

  constructor(boot: LiveConfigValues) {
    this.boot = { ...boot };
    this.current = { ...boot };
  }

  /**
   * A config whose boot values come from the process environment. `assume`
   * replaces individual boot values — tests use it to simulate a host that set
   * those variables, which is different from an admin override.
   */
  static fromEnvironment(assume: Partial<LiveConfigValues> = {}): RuntimeConfig {
    return new RuntimeConfig({ ...liveBootConfig, ...assume });
  }

  get<K extends LiveKey>(key: K): LiveConfigValues[K] {
    return this.current[key];
  }

  /** The value the process booted with, ignoring any override. */
  bootValue<K extends LiveKey>(key: K): LiveConfigValues[K] {
    return this.boot[key];
  }

  set<K extends LiveKey>(key: K, value: LiveConfigValues[K]): void {
    this.current[key] = value;
    this.overridden.add(key);
  }

  clear<K extends LiveKey>(key: K): void {
    this.current[key] = this.boot[key];
    this.overridden.delete(key);
  }

  clearAll(): void {
    for (const key of [...this.overridden]) this.clear(key);
  }

  overriddenKeys(): LiveKey[] {
    return [...this.overridden];
  }
}
```

- [ ] **Step 8: Inject it — `buildApp`, test helpers, and the watchlist routes**

`routes/watchlists.ts`: change the signature to `export function watchlistRoutes(db: Db, config: ConfigReader)`, add `import type { ConfigReader } from '../config/runtime-config.js';`, and read each cap once so the comparison and the message agree:

```ts
      const maxPerUser = config.get('WATCHLIST_MAX_PER_USER');
      if ((owned?.total ?? 0) >= maxPerUser) {
        return reply.status(409).send({
          error: `Watchlist limit reached (${maxPerUser} per user). Delete one first.`,
        });
      }
```

```ts
          const maxItems = config.get('WATCHLIST_MAX_ITEMS');
          if (existing.symbols.length >= maxItems) {
            return reply.status(409).send({
              error: `Watchlist is full (${maxItems} symbols). Remove one first.`,
```

Keep the rest of that block as it is. Remove the `env` import if it is now unused. Add `config` to the function's JSDoc: "`config` supplies the live watchlist caps."

`app.ts`:
- Add `import { RuntimeConfig } from './config/runtime-config.js';`.
- Add to the options type:
  ```ts
      /** Live options for this app instance. Defaults to the process environment. */
      runtimeConfig?: RuntimeConfig;
  ```
- Destructure it with a default: `runtimeConfig = RuntimeConfig.fromEnvironment(),`.
- Change `watchlistRoutes(db)` to `watchlistRoutes(db, runtimeConfig)`.

`tests/helpers/app.ts`: add an options argument and return the config:

```ts
import { RuntimeConfig } from '../../src/config/runtime-config.js';

/** Extra knobs for {@link createTestAppWithDb}. */
export interface TestAppOptions {
  /** Live options for the app; build with `RuntimeConfig.fromEnvironment({ … })`. */
  runtimeConfig?: RuntimeConfig;
}

export async function createTestApp(
  provider?: StockProvider,
  marketStatusProvider?: MarketStatusProvider,
  options: TestAppOptions = {},
): Promise<FastifyInstance> {
  return (await createTestAppWithDb(provider, marketStatusProvider, options)).app;
}

/**
 * Like {@link createTestApp} but also returns the backing `db` and the app's
 * `config`, for tests that assert on persisted state or apply a runtime override.
 */
export async function createTestAppWithDb(
  provider?: StockProvider,
  marketStatusProvider?: MarketStatusProvider,
  options: TestAppOptions = {},
): Promise<{
  app: FastifyInstance;
  db: Awaited<ReturnType<typeof createTestDb>>;
  config: RuntimeConfig;
}> {
  const db = await createTestDb();
  const config = options.runtimeConfig ?? RuntimeConfig.fromEnvironment();
  const app = await buildApp({
    // …all existing options unchanged…
    runtimeConfig: config,
  });
  return { app, db, config };
}
```

- [ ] **Step 9: Add the import restriction**

In `eslint.config.mjs`, add to the existing `rules` block:

```js
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/env.js', '**/env'],
          importNames: ['liveBootConfig'],
          allowTypeImports: true,
          message:
            'Live options are read through an injected ConfigReader (config.get). Only config/runtime-config.ts may import liveBootConfig.',
        }],
      }],
```

Then append a config object that lifts the rule for the one allowed file:

```js
  {
    files: ['packages/server/src/config/runtime-config.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
```

Verify the rule fires. Temporarily add `import { liveBootConfig } from '../env.js'; void liveBootConfig;` to `packages/server/src/routes/health.ts` and run `pnpm lint`. Expected: an error carrying the message above. Remove the line, then run `pnpm lint` again and expect it clean.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `pnpm typecheck && pnpm --filter server test -- tests/config tests/routes/watchlists.test.ts`
Expected: all PASS.

Then run `pnpm --filter server test`. Expected: PASS. Existing callers destructure `{ app, db }`, so the extra `config` field is harmless.

- [ ] **Step 11: Commit**

```bash
pnpm lint
git add packages/shared packages/server eslint.config.mjs
git commit -m "feat(config): injected RuntimeConfig and option registry; live watchlist caps"
```

---

### Task 2: Live stock-data options

**Files:**
- Modify: `packages/server/src/env.ts` (move 7 keys), `src/config/registry.ts` (7 descriptors)
- Modify: `src/providers/cached-provider.ts`, `src/providers/yahoo.ts`, `src/providers/factory.ts`
- Modify: `src/routes/stocks.ts`, `src/routes/market-status.ts`, `src/routes/trading.ts`, `src/app.ts`
- Modify: `tools/seed-game-history/src/historical-prices.ts`
- Modify tests: `tests/providers/cached-provider.test.ts`, `tests/providers/yahoo.test.ts`, `tests/providers/factory.test.ts`, `tests/security/f24-search-cache-normalization.test.ts`, `tests/routes/trading.test.ts`
- Test: append to `tests/config/registry.test.ts`, `tests/config/live-behavior.test.ts`

**Interfaces:**
- Consumes: `RuntimeConfig`, `ConfigReader` (Task 1).
- Produces:
  - `new CachedProvider(db, inner, config: ConfigReader)`
  - `new YahooProvider(config: ConfigReader)`
  - `createProvider(config: ConfigReader)`
  - `stockRoutes(db, provider, config)`
  - `marketStatusRoutes(provider, config)`
  - `tradingRoutes(db, provider, marketStatusProvider, config, registry?, leaderboardThrottleMs?, bus?)`

- [ ] **Step 1: Write the failing tests**

Append to `tests/config/registry.test.ts`, inside `describe('liveValueSchema')`:

```ts
  it('accepts only real booleans', () => {
    const schema = liveValueSchema('STOCK_ALLOW_STALE_TRADES');
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse('true').success).toBe(false);
  });

  it('bounds cache TTL overrides', () => {
    const schema = liveValueSchema('STOCK_CACHE_TTL_MS');
    expect(schema.safeParse(60_000).success).toBe(true);
    expect(schema.safeParse(1).success).toBe(false);
  });
```

Append to `tests/config/live-behavior.test.ts`, and add `import { MockStockProvider } from '../helpers/mock-provider.js';`:

```ts
describe('STOCK_ALLOW_STALE_TRADES override', () => {
  let app: FastifyInstance;
  let config: RuntimeConfig;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setStale('AAPL', 30_000, { price: 100 });
    ({ app, config } = await createTestAppWithDb(provider));
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'live-stale', password: 'password123' },
    });
    token = reg.json<{ token: string }>().token;
    gameId = (
      await app.inject({
        method: 'POST',
        url: '/games',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: 'g',
          startDate: '2020-01-01T00:00:00.000Z',
          endDate: '2099-01-01T00:00:00.000Z',
          startingBalance: 10000,
        },
      })
    ).json<{ id: string }>().id;
  });

  afterAll(async () => {
    await app.close();
  });

  const buy = () =>
    app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });

  it('switches between blocking and filling stale-priced trades without a restart', async () => {
    expect((await buy()).json<{ code: string }>().code).toBe('STALE_PRICE_BLOCKED');
    config.set('STOCK_ALLOW_STALE_TRADES', true);
    expect((await buy()).statusCode).toBe(201);
  });
});
```

`setStale` is the existing `MockStockProvider` helper that `trading.test.ts` uses for the same scenario.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter server test -- tests/config`
Expected: FAIL. These keys are not `LiveKey`s yet, so `liveValueSchema('STOCK_…')` and `config.set('STOCK_ALLOW_STALE_TRADES', …)` fail to typecheck. At runtime the override has no effect.

- [ ] **Step 3: Move the keys and flip the descriptors**

`env.ts`: cut these seven properties from `env` (JSDoc and the "All durations are in milliseconds" section comment included) and paste them into `liveBootConfig`: `STOCK_CACHE_TTL_MS`, `STOCK_SEARCH_CACHE_TTL_MS`, `STOCK_HISTORY_CACHE_TTL_MS`, `STOCK_STALE_PRICE_MAX_AGE_MS`, `STOCK_RATE_LIMIT_BACKOFF_MS`, `STOCK_ALLOW_STALE_TRADES`, `STOCK_STALE_TRADE_MAX_AGE_MS`.

`registry.ts`: replace the seven descriptors with:

```ts
  STOCK_CACHE_TTL_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'live', min: SECOND, max: HOUR,
    description: 'How long a cached quote is served before re-fetching upstream.',
  },
  STOCK_SEARCH_CACHE_TTL_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'live', min: SECOND, max: DAY,
    description: 'How long symbol-search results are cached.',
  },
  STOCK_HISTORY_CACHE_TTL_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'live', min: SECOND, max: HOUR,
    description: 'How long price-history results are cached.',
  },
  STOCK_STALE_PRICE_MAX_AGE_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'live', min: SECOND, max: DAY,
    description: 'While rate-limited, cached quotes up to this old are served instead of an error.',
  },
  STOCK_RATE_LIMIT_BACKOFF_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'live', min: SECOND, max: HOUR,
    description: 'After an upstream 429, refuse upstream calls for this long.',
  },
  STOCK_ALLOW_STALE_TRADES: {
    category: 'stock-data', kind: 'boolean', mutability: 'live',
    description: 'When rate-limited, fill trades at the cached price instead of rejecting. Favors availability over fairness.',
  },
  STOCK_STALE_TRADE_MAX_AGE_MS: {
    category: 'stock-data', kind: 'integer', unit: 'ms', mutability: 'live', min: SECOND, max: DAY,
    description: 'Stale trades using a cached price older than this are rejected anyway.',
  },
```

Run `pnpm typecheck`. It now lists every consumer that still reads these through `env`. Fix them as follows.

- [ ] **Step 4: Inject `config` into the consumers**

Each file gets `import type { ConfigReader } from '<relative>/config/runtime-config.js';`. Remove an `env` import once a file no longer uses it.

`providers/cached-provider.ts`: add the constructor parameter and replace every `env.<one of the seven>` with `this.config.get('<KEY>')`. Keep `env.STOCK_PROVIDER` (restart-only).

```ts
  constructor(
    private readonly db: Db,
    private readonly inner: StockProvider,
    private readonly config: ConfigReader,
  ) {
```

If a read sits in a module-level helper rather than a method, pass the value into the helper as a parameter rather than giving the helper the reader. Add one line to the class JSDoc: "TTLs and the stale-price window are read from `config` on every call, so admin overrides apply immediately."

`providers/yahoo.ts`:

```ts
  constructor(private readonly config: ConfigReader) {
    this.client = new YahooFinance({
      validation: { logErrors: false },
      suppressNotices: ['yahooSurvey'],
    });
  }
```

Inside `trip429()`: `this.rateLimitedUntil = Date.now() + this.config.get('STOCK_RATE_LIMIT_BACKOFF_MS');`.

`providers/factory.ts`: `export function createProvider(config: ConfigReader): StockProvider`, and `return new YahooProvider(config);`. Add to the JSDoc: "`config` feeds the providers' live tunables (rate-limit backoff)."

`routes/stocks.ts` and `routes/market-status.ts`: the `Retry-After` helper takes the reader, and the route factory gains a parameter:

```ts
/** Sets a Retry-After header (seconds) based on the configured 429 backoff. */
function setRetryAfter(reply: FastifyReply, config: ConfigReader): void {
  reply.header('Retry-After', Math.ceil(config.get('STOCK_RATE_LIMIT_BACKOFF_MS') / 1000));
}
```

- `export function stockRoutes(_db: Db, provider: StockProvider, config: ConfigReader)`
- `export function marketStatusRoutes(provider: MarketStatusProvider, config: ConfigReader)`
- Every `setRetryAfter(reply)` becomes `setRetryAfter(reply, config)`. There are 7 call sites across the two files.

`routes/trading.ts`: the signature becomes

```ts
export function tradingRoutes(
  db: Db,
  provider: StockProvider,
  marketStatusProvider: MarketStatusProvider,
  config: ConfigReader,
  registry?: GameClientRegistry,
  leaderboardThrottleMs = LEADERBOARD_THROTTLE_MS,
  bus?: EventBus,
) {
```

Inside it, make three replacements:
- the rate-limited `Retry-After` becomes `Math.ceil(config.get('STOCK_RATE_LIMIT_BACKOFF_MS') / 1000)`
- `if (!config.get('STOCK_ALLOW_STALE_TRADES')) {`
- `if (priceAgeMs > config.get('STOCK_STALE_TRADE_MAX_AGE_MS')) {`

Leave `MARKET_HOURS_*` alone (Task 4). Add `config` to the JSDoc.

`app.ts`:

```ts
  const provider = injectedProvider ?? new CachedProvider(db, createProvider(runtimeConfig), runtimeConfig);
```

Also update `stockRoutes(db, provider, runtimeConfig)`, `marketStatusRoutes(marketStatusProvider, runtimeConfig)`, and `tradingRoutes(db, provider, marketStatusProvider, runtimeConfig, registry, leaderboardThrottleMs, bus)`.

Note: `const provider` is computed before the destructured `runtimeConfig` is used. Both come from the same `opts` destructure at the top, so order is not a problem.

`tools/seed-game-history/src/historical-prices.ts`: this tool is its own process, so it builds its own config:

```ts
import { RuntimeConfig } from '../../../packages/server/src/config/runtime-config.js';
// …
  const provider = createProvider(RuntimeConfig.fromEnvironment());
```

- [ ] **Step 5: Update test call sites and migrate the `env`-mutating test**

Each of the following gets `import { RuntimeConfig } from '<relative>/src/config/runtime-config.js';`, plus these call-site changes:
- `tests/providers/cached-provider.test.ts` (3 sites) and `tests/security/f24-search-cache-normalization.test.ts` (1): `new CachedProvider(db, inner)` → `new CachedProvider(db, inner, RuntimeConfig.fromEnvironment())`.
- `tests/providers/yahoo.test.ts` (8 sites): `new YahooProvider()` → `new YahooProvider(RuntimeConfig.fromEnvironment())`.
- `tests/providers/factory.test.ts`: `mod.createProvider()` → `mod.createProvider(RuntimeConfig.fromEnvironment())`.

`tests/routes/trading.test.ts`, the `describe('POST /games/:id/trades — stale trades allowed')` block. Replace the `process.env` and `(envModule.env as any)` manipulation with injection. This removes both `eslint-disable` comments and the `previousFlag` variable:

```ts
describe('POST /games/:id/trades — stale trades allowed', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;
  let provider: MockStockProvider;

  beforeAll(async () => {
    provider = new MockStockProvider();
    provider.setStale('AAPL', 30_000, { price: 100 });
    app = await createTestApp(provider, undefined, {
      runtimeConfig: RuntimeConfig.fromEnvironment({ STOCK_ALLOW_STALE_TRADES: true }),
    });
    ({ token } = await registerUser(app, 'trader-stale'));
    ({ id: gameId } = await createActiveGame(app, token));
  });

  afterAll(async () => {
    await app.close();
  });
```

Leave the block's `it(...)` cases unchanged.

- [ ] **Step 6: Run the tests**

Run: `pnpm typecheck && pnpm --filter server test -- tests/config tests/providers tests/security tests/routes/trading.test.ts tests/routes/stocks.test.ts tests/routes/market-status.test.ts`
Expected: all PASS. Then run `pnpm --filter server test`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm lint
git add packages/server tools/seed-game-history
git commit -m "feat(config): live stock-data tunables via injected config

Also replaces the env mutation in trading.test.ts with an injected
RuntimeConfig."
```

---

### Task 3: Live price-poller cap

**Files:**
- Modify: `src/env.ts`, `src/config/registry.ts`, `src/ws/price-poller.ts`, `src/app.ts`
- Modify tests: `tests/ws/price-poller.test.ts`, `tests/security/f19-price-poller-fanout.test.ts`

**Interfaces:**
- Consumes: `ConfigReader`.
- Produces: `pollPrices(db, provider, registry, config: ConfigReader, logger?, state?)` and `startPricePoller(db, provider, registry, config: ConfigReader, logger?)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/security/f19-price-poller-fanout.test.ts`, inside its top-level `describe`, reusing that file's `seedGame` / `db` / `registry` / `provider` / `logger` fixtures:

```ts
  it('applies a lowered cap on the next tick', async () => {
    const config = RuntimeConfig.fromEnvironment();
    config.set('PRICE_POLLER_MAX_SYMBOLS', 3);
    await seedGame(db, registry, 'f19-live-cap', 10);
    await pollPrices(db, provider, registry, config, logger);
    expect(fetched.length).toBe(3);
  });
```

`fetched` is the array of symbols the existing tests assert on; match that file's helper name if it differs. If that file's fixtures are scoped per test, follow the shape of the existing cap test directly above.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter server test -- tests/security/f19-price-poller-fanout.test.ts`
Expected: FAIL, a type error (`PRICE_POLLER_MAX_SYMBOLS` is not a `LiveKey`, and the call has the wrong arity).

- [ ] **Step 3: Implement**

- `env.ts`: move `PRICE_POLLER_MAX_SYMBOLS` (with its JSDoc) into `liveBootConfig`.
- `registry.ts`: replace its descriptor with:
  ```ts
    PRICE_POLLER_MAX_SYMBOLS: {
      category: 'limits', kind: 'integer', mutability: 'live', min: 1, max: 5_000,
      description: 'Most symbols one price-poller tick may fetch. Watchlist symbols are dropped first.',
    },
  ```
- `ws/price-poller.ts`: add `config: ConfigReader` after `registry` in both `pollPrices` and `startPricePoller`. Pass it through in `startPricePoller`'s tick closure, and replace the slice with:
  ```ts
    const allSymbols = ranked.slice(0, config.get('PRICE_POLLER_MAX_SYMBOLS'));
  ```
  Update both JSDoc blocks: "the symbol cap is read from `config` each tick."
- `app.ts`: `startPricePoller(db, provider, registry, runtimeConfig, app.log)`.
- `tests/ws/price-poller.test.ts`: add `const config = RuntimeConfig.fromEnvironment();` at module scope. Every `pollPrices(db, provider, registry` becomes `pollPrices(db, provider, registry, config`.
- `tests/security/f19-price-poller-fanout.test.ts`: same `const config = RuntimeConfig.fromEnvironment();`. Replace every `env.PRICE_POLLER_MAX_SYMBOLS` with `config.get('PRICE_POLLER_MAX_SYMBOLS')`, add `config` to each `pollPrices` call, and drop the `env` import.

- [ ] **Step 4: Run the tests**

Run: `pnpm typecheck && pnpm --filter server test -- tests/ws tests/security tests/config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm lint
git add packages/server
git commit -m "feat(config): live price-poller symbol cap"
```

---

### Task 4: Live market-hours options; start the pending-orders worker in every mode

**Files:**
- Modify: `src/env.ts`, `src/config/registry.ts`
- Modify: `src/routes/trading.ts`, `src/workers/pending-orders.ts`, `src/app.ts`
- Modify tests: `tests/routes/trading-market-hours.test.ts` (migrate off `setEnv`)
- Modify: `docs/design.md`
- Test: `tests/app-workers.test.ts`; append to `tests/config/live-behavior.test.ts` and `tests/config/registry.test.ts`

**Interfaces:**
- Consumes: `ConfigReader`.
- Produces: `runPendingOrdersTick` and `startPendingOrdersWorker` deps gain `config: ConfigReader`. Two new `LiveKey`s: `MARKET_HOURS_MODE`, `MARKET_HOURS_INCLUDE_EXTENDED`. The worker starts whenever `disablePoller` is false.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/tests/app-workers.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/workers/pending-orders.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/workers/pending-orders.js')>();
  return { ...actual, startPendingOrdersWorker: vi.fn(() => ({ stop: async () => {} })) };
});

import { buildApp } from '../src/app.js';
import { RuntimeConfig } from '../src/config/runtime-config.js';
import { startPendingOrdersWorker } from '../src/workers/pending-orders.js';
import { createTestDb } from './helpers/app.js';
import { MockStockProvider } from './helpers/mock-provider.js';
import { MockMarketStatusProvider } from './helpers/mock-market-status.js';

describe('buildApp background workers', () => {
  // The same worker fills limit/stop/bracket orders and expires day orders, so
  // gating it on pending mode left resting orders immortal under the default.
  it('starts the pending-orders worker outside pending mode', async () => {
    const app = await buildApp({
      logger: false,
      db: await createTestDb(),
      provider: new MockStockProvider(),
      marketStatusProvider: new MockMarketStatusProvider(),
      runtimeConfig: RuntimeConfig.fromEnvironment({ MARKET_HOURS_MODE: 'instant' }),
      disablePoller: false,
      disableRateLimit: true,
      loginThrottle: { disabled: true },
    });
    try {
      expect(startPendingOrdersWorker).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
```

Append to `tests/config/live-behavior.test.ts`. Add `import { MockMarketStatusProvider } from '../helpers/mock-market-status.js';`, and change `import type { RuntimeConfig }` to a value import (`import { RuntimeConfig }`), because this block calls `RuntimeConfig.fromEnvironment`:

```ts
describe('MARKET_HOURS_MODE override', () => {
  let app: FastifyInstance;
  let config: RuntimeConfig;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    const marketStatus = new MockMarketStatusProvider();
    marketStatus.setResult({ state: 'CLOSED' });
    ({ app, config } = await createTestAppWithDb(provider, marketStatus, {
      runtimeConfig: RuntimeConfig.fromEnvironment({ MARKET_HOURS_MODE: 'instant' }),
    }));
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'live-mode', password: 'password123' },
    });
    token = reg.json<{ token: string }>().token;
    gameId = (
      await app.inject({
        method: 'POST',
        url: '/games',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: 'g',
          startDate: '2020-01-01T00:00:00.000Z',
          endDate: '2099-01-01T00:00:00.000Z',
          startingBalance: 10000,
        },
      })
    ).json<{ id: string }>().id;
  });

  afterAll(async () => {
    await app.close();
  });

  const buy = () =>
    app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });

  it('switches closed-market behavior without a restart', async () => {
    expect((await buy()).statusCode).toBe(201);
    config.set('MARKET_HOURS_MODE', 'disabled');
    const rejected = await buy();
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json<{ code: string }>().code).toBe('MARKET_CLOSED');
  });
});
```

Append to `tests/config/registry.test.ts`, inside `describe('liveValueSchema')`:

```ts
  it('restricts enums to their options', () => {
    const schema = liveValueSchema('MARKET_HOURS_MODE');
    expect(schema.safeParse('pending').success).toBe(true);
    expect(schema.safeParse('sometimes').success).toBe(false);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter server test -- tests/app-workers.test.ts tests/config`
Expected: FAIL. `MARKET_HOURS_MODE` is not a `LiveKey` (a type error, and an unknown key at runtime), and the worker is called 0 times.

- [ ] **Step 3: Move the keys and flip the descriptors**

`env.ts`: move `MARKET_HOURS_MODE` and `MARKET_HOURS_INCLUDE_EXTENDED` (with their JSDoc) into `liveBootConfig`.

`registry.ts`:

```ts
  MARKET_HOURS_MODE: {
    category: 'market-hours', kind: 'enum', options: VALID_MARKET_HOURS_MODES, mutability: 'live',
    description:
      'Closed-market trades: instant fills at last price, disabled rejects, pending queues for next open. ' +
      'Changing it mid-game changes the rules for every player.',
  },
  MARKET_HOURS_INCLUDE_EXTENDED: {
    category: 'market-hours', kind: 'boolean', mutability: 'live',
    description: 'Count pre- and post-market sessions as open for trading.',
  },
```

- [ ] **Step 4: Inject `config` into the consumers, and start the worker unconditionally**

`routes/trading.ts` and `workers/pending-orders.ts` each have a module-level `isTradingOpen(state)` that reads `env.MARKET_HOURS_INCLUDE_EXTENDED`. Give both an explicit parameter:

```ts
/** Returns whether the configured policy treats this market state as "open" for trading. */
function isTradingOpen(state: MarketState, includeExtended: boolean): boolean {
  if (state === 'REGULAR') return true;
  if (!includeExtended) return false;
  return state === 'PRE' || state === 'POST';
}
```

In `routes/trading.ts`, read the mode once at the top of the gate:

```ts
        const marketHoursMode = config.get('MARKET_HOURS_MODE');
        if (marketHoursMode !== 'instant') {
          // … unchanged …
          if (marketState !== null && !isTradingOpen(marketState, config.get('MARKET_HOURS_INCLUDE_EXTENDED'))) {
            if (marketHoursMode === 'disabled') {
```

The day-order expiry becomes `includeExtended: config.get('MARKET_HOURS_INCLUDE_EXTENDED'),`. Drop the `env` import if it is unused.

In `workers/pending-orders.ts`, add `config: ConfigReader;` to the `runPendingOrdersTick` deps type. The `startPendingOrdersWorker` deps type gets it too, by passing `deps` through. Then:

```ts
  const marketOpen = state != null && isTradingOpen(state, deps.config.get('MARKET_HOURS_INCLUDE_EXTENDED'));
```

Keep `env.PENDING_ORDERS_TICK_MS` until Task 6.

In `app.ts`, replace the `if (env.MARKET_HOURS_MODE === 'pending') { … }` block with:

```ts
    // Runs in every mode, not only `pending`: the same tick fills resting
    // limit/stop/bracket orders and expires day orders, and MARKET_HOURS_MODE
    // can change at runtime, so pending rows may exist under any mode.
    const pendingWorker = startPendingOrdersWorker({
      db,
      provider,
      marketStatusProvider,
      registry,
      bus,
      config: runtimeConfig,
      logger: app.log,
    });
    app.addHook('onClose', async () => {
      await pendingWorker.stop();
    });
```

- [ ] **Step 5: Migrate `trading-market-hours.test.ts` off `setEnv`**

Delete the `setEnv` helper and its comment. In each of its four `describe` blocks, delete the `restore` variable and its `await restore()`, and pass the options to `createTestApp` instead. For example, the `disabled` block's `beforeAll` becomes:

```ts
  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    marketStatus = new MockMarketStatusProvider();
    marketStatus.setResult({ state: 'CLOSED' });
    app = await createTestApp(provider, marketStatus, {
      runtimeConfig: RuntimeConfig.fromEnvironment({ MARKET_HOURS_MODE: 'disabled' }),
    });
    ({ token } = await registerUser(app, 'trader-mhd'));
    ({ id: gameId } = await createActiveGame(app, token));
  });
```

The other three blocks get `{ MARKET_HOURS_MODE: 'pending' }`, `{ MARKET_HOURS_MODE: 'disabled', MARKET_HOURS_INCLUDE_EXTENDED: true }`, and `{ MARKET_HOURS_MODE: 'disabled', MARKET_HOURS_INCLUDE_EXTENDED: false }`, matching the patches their `setEnv` calls used. Their `afterAll` keeps only `await app.close();`. Afterwards, `grep -n "env" tests/routes/trading-market-hours.test.ts` should match nothing except `RuntimeConfig.fromEnvironment`.

- [ ] **Step 6: Update `docs/design.md`**

Under *Known Gaps*, replace the section "### Day-order expiry only runs in `pending` market-hours mode" with:

```markdown
### Day orders are the default time-in-force

`timeInForce` defaults to `day`, so a client that omits it gets an order that dies at the next
session close. (Until 2026-10 the pending-orders worker — which runs `expireDayOrders` and
`evaluateTriggers` — started only in `pending` market-hours mode, so on a default `instant`
server resting orders never filled or expired. It now runs in every mode.)
```

- [ ] **Step 7: Run the tests**

Run: `pnpm typecheck && pnpm --filter server test -- tests/app-workers.test.ts tests/config tests/routes/trading.test.ts tests/routes/trading-market-hours.test.ts tests/routes/trading-advanced-orders.test.ts`
Expected: all PASS. Then run `pnpm --filter server test`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pnpm lint
git add packages/server docs/design.md
git commit -m "fix(workers): run the pending-orders worker in every market-hours mode

Resting limit/stop/bracket orders never filled or expired on a default
(instant) server because the worker that evaluates them only started in
pending mode. MARKET_HOURS_MODE and MARKET_HOURS_INCLUDE_EXTENDED are now
live options, and trading-market-hours.test.ts injects them instead of
mutating env."
```

---

### Task 5: Live login throttle and market-status TTL

**Files:**
- Modify: `src/env.ts`, `src/config/registry.ts`
- Modify: `src/services/failed-login.ts`, `src/providers/market-status/cached.ts`, `src/app.ts`
- Modify tests: `tests/services/failed-login.test.ts`, `tests/auth.test.ts`
- Test: append to `tests/providers/market-status/cached.test.ts`

**Interfaces:**
- Consumes: `ConfigReader`.
- Produces:
  - `new FailedLoginTracker(config: ConfigReader, opts?: FailedLoginOptions)`, where `FailedLoginOptions` is reduced to `{ disabled?: boolean }`.
  - `new CachedMarketStatus(inner, ttlMs: number | (() => number))`.
  - Four new `LiveKey`s: `LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_FAILURE_WINDOW_MS`, `LOGIN_LOCKOUT_MS`, `MARKET_STATUS_CACHE_TTL_MS`.

The thresholds get one source, the config. That replaces today's "constructor options, else env" pair, so tests set them the same way production does.

- [ ] **Step 1: Write the failing tests**

In `tests/services/failed-login.test.ts`, replace `const OPTS = { maxAttempts: 3, windowMs: 60_000, lockoutMs: 300_000 };` with:

```ts
import { RuntimeConfig } from '../../src/config/runtime-config.js';

const limits = () =>
  RuntimeConfig.fromEnvironment({
    LOGIN_MAX_FAILED_ATTEMPTS: 3,
    LOGIN_FAILURE_WINDOW_MS: 60_000,
    LOGIN_LOCKOUT_MS: 300_000,
  });
```

Then make two replacements throughout the file:
- `new FailedLoginTracker(OPTS)` → `new FailedLoginTracker(limits())`
- `new FailedLoginTracker({ ...OPTS, disabled: true })` → `new FailedLoginTracker(limits(), { disabled: true })`

Append:

```ts
describe('FailedLoginTracker with a runtime override', () => {
  it('applies a lowered threshold to an existing tracker', () => {
    const config = limits();
    const tracker = new FailedLoginTracker(config);
    config.set('LOGIN_MAX_FAILED_ATTEMPTS', 2);
    expect(tracker.recordFailure('alice')).toBe(false);
    expect(tracker.recordFailure('alice')).toBe(true);
    expect(tracker.retryAfterMs('alice')).not.toBeNull();
  });
});
```

`tests/auth.test.ts`, in the throttle `describe`'s `buildApp` call: replace `loginThrottle: { maxAttempts: 3, windowMs: 60_000, lockoutMs: 300_000 },` with

```ts
      runtimeConfig: RuntimeConfig.fromEnvironment({
        LOGIN_MAX_FAILED_ATTEMPTS: 3,
        LOGIN_FAILURE_WINDOW_MS: 60_000,
        LOGIN_LOCKOUT_MS: 300_000,
      }),
```

and add the `RuntimeConfig` import.

Append inside `describe('CachedMarketStatus')` in `tests/providers/market-status/cached.test.ts`:

```ts
  it('re-reads a function TTL on every call', async () => {
    const inner = new Counter();
    let ttl = 60_000;
    const cached = new CachedMarketStatus(inner, () => ttl);
    await cached.getStatus();
    await cached.getStatus();
    expect(inner.calls).toBe(1);
    ttl = 0;
    await cached.getStatus();
    expect(inner.calls).toBe(2);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter server test -- tests/services/failed-login.test.ts tests/auth.test.ts tests/providers/market-status/cached.test.ts`
Expected: FAIL. The keys are not live, and `FailedLoginTracker` has the wrong constructor shape. The function TTL compares against a function, so it never hits the cache.

- [ ] **Step 3: Move the keys and flip the descriptors**

`env.ts`: move `LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_FAILURE_WINDOW_MS`, `LOGIN_LOCKOUT_MS`, and `MARKET_STATUS_CACHE_TTL_MS` (with their JSDoc) into `liveBootConfig`. Fix the two JSDoc `{@link env.LOGIN_LOCKOUT_MS}` references to `{@link liveBootConfig.LOGIN_LOCKOUT_MS}`.

`registry.ts`:

```ts
  LOGIN_MAX_FAILED_ATTEMPTS: {
    category: 'security', kind: 'integer', mutability: 'live', min: 3, max: 100,
    description: 'Consecutive failed logins for one username before it is throttled.',
  },
  LOGIN_FAILURE_WINDOW_MS: {
    category: 'security', kind: 'integer', unit: 'ms', mutability: 'live', min: MINUTE, max: DAY,
    description: 'Failures older than this stop counting toward the threshold.',
  },
  // Capped at an hour: anyone can trip a lockout for any username, so a long
  // one becomes a denial-of-service tool against a chosen account.
  LOGIN_LOCKOUT_MS: {
    category: 'security', kind: 'integer', unit: 'ms', mutability: 'live', min: MINUTE, max: HOUR,
    description: 'How long a throttled username stays locked. Keep short: anyone can trigger it for any name.',
  },
  MARKET_STATUS_CACHE_TTL_MS: {
    category: 'market-hours', kind: 'integer', unit: 'ms', mutability: 'live', min: SECOND, max: HOUR,
    description: 'How long the market open/closed state is cached.',
  },
```

- [ ] **Step 4: Implement**

`services/failed-login.ts`: replace `import { env } from '../env.js';` with `import type { ConfigReader } from '../config/runtime-config.js';`. Then:

```ts
/** Options for {@link FailedLoginTracker}. Thresholds come from the live `LOGIN_*` config. */
export interface FailedLoginOptions {
  /** When true, every method is a no-op. Tests and the e2e suite. */
  disabled?: boolean;
}
```

Constructor and accessors, which replace the three captured fields:

```ts
  private readonly entries = new Map<string, Entry>();
  private readonly disabled: boolean;

  constructor(
    private readonly config: ConfigReader,
    opts: FailedLoginOptions = {},
  ) {
    this.disabled = opts.disabled ?? false;
  }

  // Read per call, not captured, so an admin override applies to the next attempt.
  private get maxAttempts(): number {
    return this.config.get('LOGIN_MAX_FAILED_ATTEMPTS');
  }

  private get windowMs(): number {
    return this.config.get('LOGIN_FAILURE_WINDOW_MS');
  }

  private get lockoutMs(): number {
    return this.config.get('LOGIN_LOCKOUT_MS');
  }
```

`providers/market-status/cached.ts`:

```ts
  /** `ttlMs` may be a getter so a runtime override applies without rebuilding the cache. */
  constructor(
    private readonly inner: MarketStatusProvider,
    private readonly ttlMs: number | (() => number),
  ) {}

  async getStatus(): Promise<MarketStatusResult> {
    const ttl = typeof this.ttlMs === 'function' ? this.ttlMs() : this.ttlMs;
    if (this.cached && Date.now() - this.cached.fetchedAt < ttl) {
      return this.cached.result;
    }
    const result = await this.inner.getStatus();
    this.cached = { result, fetchedAt: Date.now() };
    return result;
  }
```

`app.ts`:

```ts
    new CachedMarketStatus(
      createMarketStatusProvider(provider),
      () => runtimeConfig.get('MARKET_STATUS_CACHE_TTL_MS'),
    );
```

and `authRoutes(db, new FailedLoginTracker(runtimeConfig, loginThrottle))`. Update the `loginThrottle` option's JSDoc to: "Pass `{ disabled: true }` in tests; thresholds come from `runtimeConfig`."

- [ ] **Step 5: Run the tests**

Run: `pnpm typecheck && pnpm --filter server test -- tests/services/failed-login.test.ts tests/auth.test.ts tests/providers/market-status tests/config`
Expected: PASS. Then run `pnpm --filter server test`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm lint
git add packages/server
git commit -m "feat(config): live login-throttle thresholds and market-status TTL"
```

---

### Task 6 (optional): Live worker intervals

Drop this task if the reviewer rejects the timer change. The three keys then stay in `env`, as restart-only.

**Files:**
- Modify: `src/env.ts`, `src/config/registry.ts`
- Modify: `src/workers/interval-worker.ts`, `src/workers/pending-orders.ts`, `src/workers/portfolio-snapshot.ts`, `src/workers/discover.ts`, `src/app.ts`
- Modify tests: the single test call sites of `startPortfolioSnapshotWorker` and `startDiscoverWorker` (find them with `grep -rn "startPortfolioSnapshotWorker(\|startDiscoverWorker(" packages/server/tests`)
- Test: append to `tests/workers/interval-worker.test.ts`

**Interfaces:**
- Produces:
  - `startIntervalWorker(name, tick, intervalMs: number | (() => number), onError?, options?)`; `IntervalWorker` is unchanged.
  - The `startPortfolioSnapshotWorker` and `startDiscoverWorker` deps gain `config: ConfigReader`.
  - Three new `LiveKey`s.

- [ ] **Step 1: Write the failing test**

Append to `tests/workers/interval-worker.test.ts` (add `afterEach` to the vitest import):

```ts
describe('startIntervalWorker with a dynamic interval', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies a changed interval from the next fire onward', async () => {
    vi.useFakeTimers();
    let interval = 1000;
    const tick = vi.fn(async () => {});
    const worker = startIntervalWorker('test-dynamic', tick, () => interval);

    await vi.advanceTimersByTimeAsync(500);
    interval = 100; // the timer armed at t=0 still fires at t=1000
    await vi.advanceTimersByTimeAsync(500);
    expect(tick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300); // fires at 1100, 1200, 1300
    expect(tick).toHaveBeenCalledTimes(4);
    await worker.stop();
  });

  it('keeps a fixed cadence regardless of tick duration, like setInterval', async () => {
    vi.useFakeTimers();
    const tick = vi.fn(() => new Promise<void>((r) => setTimeout(r, 30)));
    const worker = startIntervalWorker('test-cadence', tick, () => 100);
    await vi.advanceTimersByTimeAsync(350);
    expect(tick).toHaveBeenCalledTimes(3); // 100, 200, 300 — not delayed by the 30ms ticks
    await worker.stop();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter server test -- tests/workers/interval-worker.test.ts`
Expected: FAIL. A function interval is a type error, and at runtime `setInterval` coerces it to 1 ms.

- [ ] **Step 3: Implement**

`workers/interval-worker.ts`: change the signature and the scheduling. Keep `fire`, `running`, `stopped`, and `inflight` exactly as they are:

```ts
export function startIntervalWorker(
  name: string,
  tick: () => Promise<void>,
  intervalMs: number | (() => number),
  onError?: (err: unknown) => void,
  options: { immediate?: boolean } = {},
): IntervalWorker {
  const nextDelay = typeof intervalMs === 'function' ? intervalMs : () => intervalMs;
  let running = false;
  let stopped = false;
  let inflight: Promise<void> | null = null;
  let handle: ReturnType<typeof setTimeout> | undefined;

  const fire = () => {
    // … unchanged …
  };

  // A self-re-arming timeout instead of setInterval, so a changed interval
  // applies at the next fire without restarting the worker. Re-armed right
  // after fire(), not after the tick settles, to keep setInterval's cadence.
  const schedule = () => {
    handle = setTimeout(() => {
      fire();
      if (!stopped) schedule();
    }, nextDelay());
  };
  schedule();
  if (options.immediate) fire();

  return {
    stop: async () => {
      stopped = true;
      clearTimeout(handle);
      await inflight;
    },
  };
}
```

Add to the function's JSDoc: "`intervalMs` may be a getter; it is re-read each time the timer re-arms."

`env.ts`: move `PENDING_ORDERS_TICK_MS`, `PORTFOLIO_SNAPSHOT_INTERVAL_MS`, and `DISCOVER_REFRESH_INTERVAL_MS` into `liveBootConfig`. Fix the `{@link env.PORTFOLIO_SNAPSHOT_INTERVAL_MS}` in `db/schema.sqlite.ts` (and `schema.pg.ts`, if it has the same reference) to `liveBootConfig.…`.

`registry.ts`:

```ts
  PENDING_ORDERS_TICK_MS: {
    category: 'workers', kind: 'integer', unit: 'ms', mutability: 'live', min: 5 * SECOND, max: HOUR,
    description: 'How often pending orders settle and resting orders are checked for fills and expiry.',
  },
  // Floor of a minute: every tick writes one row per active player.
  PORTFOLIO_SNAPSHOT_INTERVAL_MS: {
    category: 'workers', kind: 'integer', unit: 'ms', mutability: 'live', min: MINUTE, max: DAY,
    description: 'How often every active player’s portfolio value is captured for charts.',
  },
  DISCOVER_REFRESH_INTERVAL_MS: {
    category: 'workers', kind: 'integer', unit: 'ms', mutability: 'live', min: MINUTE, max: DAY,
    description: 'How often the Discover worker looks for missing market-mover and daily-pick lists.',
  },
```

Workers:
- `pending-orders.ts`: `const intervalMs = deps.intervalMs ?? (() => deps.config.get('PENDING_ORDERS_TICK_MS'));`
- `portfolio-snapshot.ts`: add `config: ConfigReader` to the deps type, then `const intervalMs = deps.intervalMs ?? (() => deps.config.get('PORTFOLIO_SNAPSHOT_INTERVAL_MS'));`
- `discover.ts`: add `config: ConfigReader` to `startDiscoverWorker`'s deps, then `deps.intervalMs ?? (() => deps.config.get('DISCOVER_REFRESH_INTERVAL_MS')),`

`app.ts`: pass `config: runtimeConfig` to `startPortfolioSnapshotWorker` and `startDiscoverWorker`. In the two test call sites, add `config: RuntimeConfig.fromEnvironment()` to the deps.

- [ ] **Step 4: Run the tests**

Run: `pnpm typecheck && pnpm --filter server test -- tests/workers tests/config tests/app-workers.test.ts`
Expected: PASS, including the four existing `interval-worker` tests.

- [ ] **Step 5: Commit**

```bash
pnpm lint
git add packages/server
git commit -m "feat(workers): interval workers accept a live interval"
```

---

### Task 7: URL redaction + `ConfigOverridesService`

**Files:**
- Create: `packages/server/src/config/redact.ts`, `packages/server/src/services/config-overrides.ts`
- Test: `packages/server/tests/config/redact.test.ts`, `packages/server/tests/services/config-overrides.test.ts`

**Interfaces:**
- Consumes:
  - from the registry: `CONFIG_REGISTRY`, `descriptorFor`, `isLiveKey`, `isExplicitlySet`, `liveValueSchema`, `EnvKey`, `LiveKey`, `LiveConfigValues`
  - `env` (restart values) and `RuntimeConfig`
  - `recordAdminAction`, plus `schema.systemSettings` / `schema.users`
- Produces:
  - `redactConfigUrl(raw: string): string`
  - `CONFIG_OVERRIDE_PREFIX`
  - `class ConfigOverridesService(db: Db, config: RuntimeConfig)`:
    - `load(logger?): Promise<LiveKey[]>`
    - `list(): Promise<AdminConfigEntry[]>`
    - `get(key: EnvKey)`
    - `set<K extends LiveKey>(key: K, value: LiveConfigValues[K], actorId: string)`
    - `reset(key: LiveKey, actorId: string)`

- [ ] **Step 1: Write the failing redaction tests**

Create `packages/server/tests/config/redact.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { redactConfigUrl } from '../../src/config/redact.js';

describe('redactConfigUrl', () => {
  it.each([
    ['postgres://user:pw@db:5432/app', 'postgres://***@db:5432/app'],
    ['postgres://user:p@ss@db/app', 'postgres://***@db/app'],
    ['postgres://user@db/app', 'postgres://***@db/app'],
    ['libsql://db.turso.io?authToken=abc.def', 'libsql://db.turso.io?authToken=***'],
    ['https://x.io/?a=1&token=s3cret&b=2', 'https://x.io/?a=1&token=***&b=2'],
    ['http://localhost:4318', 'http://localhost:4318'],
    ['./dev.db', './dev.db'],
    ['/var/lib/markettrader/app.db', '/var/lib/markettrader/app.db'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(redactConfigUrl(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Write the failing service tests**

Create `packages/server/tests/services/config-overrides.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import * as schema from '../../src/db/schema.sqlite.js';
import { env } from '../../src/env.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import {
  CONFIG_OVERRIDE_PREFIX,
  ConfigOverridesService,
} from '../../src/services/config-overrides.js';

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

// Only the audit FK needs a real user row. If `users` gains another NOT NULL
// column without a default, add it here.
async function insertAdmin(db: TestDb, username: string): Promise<string> {
  const [row] = await db
    .insert(schema.users)
    .values({ username, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  return row!.id;
}

describe('ConfigOverridesService', () => {
  let db: TestDb;
  let config: RuntimeConfig;
  let svc: ConfigOverridesService;

  beforeEach(async () => {
    db = await createTestDb();
    // The in-memory DB is shared across this file; start each test clean.
    await db.delete(schema.systemSettings).where(like(schema.systemSettings.key, `${CONFIG_OVERRIDE_PREFIX}%`));
    config = RuntimeConfig.fromEnvironment();
    svc = new ConfigOverridesService(db, config);
  });

  it('load() applies valid rows and skips invalid ones with a warning', async () => {
    const row = (key: string, value: string) => ({ key: `${CONFIG_OVERRIDE_PREFIX}${key}`, value });
    await db.insert(schema.systemSettings).values([
      row('WATCHLIST_MAX_PER_USER', JSON.stringify({ value: 7 })),
      row('NO_SUCH_KEY', JSON.stringify({ value: 1 })),
      row('JWT_SECRET', JSON.stringify({ value: 'x'.repeat(40) })),
      row('STOCK_CACHE_TTL_MS', 'not json'),
      row('WATCHLIST_MAX_ITEMS', JSON.stringify({ value: 0 })),
      row('STOCK_ALLOW_STALE_TRADES', JSON.stringify({ nope: true })),
    ]);
    config.set('PRICE_POLLER_MAX_SYMBOLS', 3); // not in the DB, so load() must drop it
    const warn = vi.fn();

    const applied = await svc.load({ warn });

    expect(applied).toEqual(['WATCHLIST_MAX_PER_USER']);
    expect(config.get('WATCHLIST_MAX_PER_USER')).toBe(7);
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(config.bootValue('WATCHLIST_MAX_ITEMS'));
    expect(config.get('PRICE_POLLER_MAX_SYMBOLS')).toBe(config.bootValue('PRICE_POLLER_MAX_SYMBOLS'));
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it('set() persists, audits, and applies; get() reports it with the admin username', async () => {
    const adminId = await insertAdmin(db, 'cfg-admin-set');

    const entry = await svc.set('WATCHLIST_MAX_ITEMS', 9, adminId);

    expect(entry).toMatchObject({ key: 'WATCHLIST_MAX_ITEMS', source: 'override', effectiveValue: 9 });
    expect(entry.override).toMatchObject({ value: 9, updatedBy: 'cfg-admin-set' });
    expect(entry.bootValue).toBe(config.bootValue('WATCHLIST_MAX_ITEMS'));
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(9);

    // Filtered by actor: the shared in-memory DB keeps audit rows from other tests.
    const audit = await db
      .select()
      .from(schema.adminAuditLog)
      .where(and(eq(schema.adminAuditLog.action, 'system.config.override'), eq(schema.adminAuditLog.adminUserId, adminId)));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.targetId).toBe('WATCHLIST_MAX_ITEMS');
  });

  it('reset() removes the override, restores the boot value, and audits only real removals', async () => {
    const adminId = await insertAdmin(db, 'cfg-admin-reset');
    await svc.set('WATCHLIST_MAX_ITEMS', 9, adminId);

    const entry = await svc.reset('WATCHLIST_MAX_ITEMS', adminId);
    await svc.reset('WATCHLIST_MAX_ITEMS', adminId);

    expect(entry.override).toBeNull();
    expect(entry.source).not.toBe('override');
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(config.bootValue('WATCHLIST_MAX_ITEMS'));
    const audit = await db
      .select()
      .from(schema.adminAuditLog)
      .where(and(eq(schema.adminAuditLog.action, 'system.config.reset'), eq(schema.adminAuditLog.adminUserId, adminId)));
    expect(audit).toHaveLength(1);
  });

  it('list() covers every option and never exposes a secret value', async () => {
    const entries = await svc.list();
    const jwt = entries.find((e) => e.key === 'JWT_SECRET')!;
    expect(jwt).toMatchObject({ secret: true, isSet: true, bootValue: null, effectiveValue: null });
    expect(JSON.stringify(entries)).not.toContain(env.JWT_SECRET);
    // No `source` assertion: whether PORT reads 'env' or 'default' depends on the shell running the suite.
    expect(entries.find((e) => e.key === 'PORT')).toMatchObject({ mutability: 'restart', override: null });
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter server test -- tests/config/redact.test.ts tests/services/config-overrides.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement redaction**

Create `packages/server/src/config/redact.ts`:

```ts
const USERINFO = /^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i;
const CREDENTIAL_PARAM = /([?&](?:auth[_-]?token|token|password|secret|key)=)[^&#]*/gi;

/**
 * Masks credentials in a URL-shaped config value for display: the userinfo part
 * (`user:pass@`) and credential-looking query parameters such as libsql's
 * `authToken`. Anything that is not a URL (a SQLite path) is returned unchanged.
 */
export function redactConfigUrl(raw: string): string {
  return raw.replace(USERINFO, '$1***@').replace(CREDENTIAL_PARAM, '$1***');
}
```

The userinfo match is greedy up to the last `@` before the first `/`, `?`, or `#`. That covers an unencoded `@` inside a password, which is the second test case.

- [ ] **Step 5: Implement the service**

Create `packages/server/src/services/config-overrides.ts`:

```ts
import { eq, like } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AdminConfigEntry, ConfigValue } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { env } from '../env.js';
import {
  CONFIG_REGISTRY,
  descriptorFor,
  isExplicitlySet,
  isLiveKey,
  liveValueSchema,
  type EnvKey,
  type LiveConfigValues,
  type LiveKey,
} from '../config/registry.js';
import { redactConfigUrl } from '../config/redact.js';
import type { RuntimeConfig } from '../config/runtime-config.js';
import { recordAdminAction } from './admin-audit.js';

/** `system_settings` key prefix for persisted overrides: `config.override.<KEY>`. */
export const CONFIG_OVERRIDE_PREFIX = 'config.override.';

interface OverrideRow {
  key: string;
  value: string;
  updatedAt: string;
  updatedBy: string | null;
  username: string | null;
}

type Parsed =
  | { ok: true; key: LiveKey; value: LiveConfigValues[LiveKey] }
  | { ok: false; reason: string };

function parseRow(row: Pick<OverrideRow, 'key' | 'value'>): Parsed {
  const key = row.key.slice(CONFIG_OVERRIDE_PREFIX.length);
  if (!isLiveKey(key)) return { ok: false, reason: 'not a live-editable option' };
  let stored: unknown;
  try {
    stored = JSON.parse(row.value);
  } catch {
    return { ok: false, reason: 'value is not valid JSON' };
  }
  if (typeof stored !== 'object' || stored === null || !('value' in stored)) {
    return { ok: false, reason: 'value has no "value" field' };
  }
  const result = liveValueSchema(key).safeParse(stored.value);
  if (!result.success) return { ok: false, reason: result.error.issues.map((i) => i.message).join('; ') };
  return { ok: true, key, value: result.data };
}

/**
 * Persists admin overrides of live options in `system_settings` and keeps one
 * app's {@link RuntimeConfig} in step with them. Audits in the same transaction
 * as the write and touches the config only after commit. Rows that no longer
 * validate (renamed key, tightened bounds) are ignored, never fatal.
 */
export class ConfigOverridesService {
  constructor(
    private readonly db: Db,
    private readonly config: RuntimeConfig,
  ) {}

  /** Makes the config's overrides exactly the valid persisted rows. Returns the keys applied. */
  async load(logger?: Pick<FastifyBaseLogger, 'warn'>): Promise<LiveKey[]> {
    const valid: Extract<Parsed, { ok: true }>[] = [];
    for (const row of await this.readRows()) {
      const parsed = parseRow(row);
      if (parsed.ok) valid.push(parsed);
      else logger?.warn({ key: row.key, reason: parsed.reason }, 'ignoring invalid runtime config override');
    }
    this.config.clearAll();
    for (const { key, value } of valid) this.config.set(key, value);
    return valid.map((p) => p.key);
  }

  /** Every option in registry order, with secrets reduced to `isSet`. */
  async list(): Promise<AdminConfigEntry[]> {
    const rows = new Map((await this.readRows()).map((r) => [r.key, r]));
    return (Object.keys(CONFIG_REGISTRY) as EnvKey[]).map((key) =>
      this.toEntry(key, rows.get(CONFIG_OVERRIDE_PREFIX + key)),
    );
  }

  async get(key: EnvKey): Promise<AdminConfigEntry> {
    const [row] = await this.readRows(key);
    return this.toEntry(key, row);
  }

  /** Persists and applies an override. `value` must already satisfy `liveValueSchema(key)`. */
  async set<K extends LiveKey>(key: K, value: LiveConfigValues[K], actorId: string): Promise<AdminConfigEntry> {
    const before = this.config.get(key);
    const stored = JSON.stringify({ value });
    const now = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await tx
        .insert(schema.systemSettings)
        .values({ key: CONFIG_OVERRIDE_PREFIX + key, value: stored, updatedAt: now, updatedBy: actorId })
        .onConflictDoUpdate({
          target: schema.systemSettings.key,
          set: { value: stored, updatedAt: now, updatedBy: actorId },
        });
      await recordAdminAction(tx, {
        adminUserId: actorId,
        action: 'system.config.override',
        targetType: 'system',
        targetId: key,
        before: { value: before },
        after: { value },
      });
    });
    this.config.set(key, value);
    return this.get(key);
  }

  /** Removes an override so the boot value applies again. Idempotent; audits only a real removal. */
  async reset(key: LiveKey, actorId: string): Promise<AdminConfigEntry> {
    const before = this.config.get(key);
    await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(schema.systemSettings)
        .where(eq(schema.systemSettings.key, CONFIG_OVERRIDE_PREFIX + key))
        .returning({ key: schema.systemSettings.key });
      if (removed.length === 0) return;
      await recordAdminAction(tx, {
        adminUserId: actorId,
        action: 'system.config.reset',
        targetType: 'system',
        targetId: key,
        before: { value: before },
        after: { value: this.config.bootValue(key) },
      });
    });
    this.config.clear(key);
    return this.get(key);
  }

  private async readRows(key?: EnvKey): Promise<OverrideRow[]> {
    const { systemSettings, users } = schema;
    return this.db
      .select({
        key: systemSettings.key,
        value: systemSettings.value,
        updatedAt: systemSettings.updatedAt,
        updatedBy: systemSettings.updatedBy,
        username: users.username,
      })
      .from(systemSettings)
      .leftJoin(users, eq(users.id, systemSettings.updatedBy))
      .where(
        key === undefined
          ? like(systemSettings.key, `${CONFIG_OVERRIDE_PREFIX}%`)
          : eq(systemSettings.key, CONFIG_OVERRIDE_PREFIX + key),
      );
  }

  private toEntry(key: EnvKey, row: OverrideRow | undefined): AdminConfigEntry {
    const d = descriptorFor(key);
    const parsed = row ? parseRow(row) : null;
    const override =
      row && parsed?.ok ? { value: parsed.value, updatedAt: row.updatedAt, updatedBy: row.username } : null;
    const boot: ConfigValue = isLiveKey(key) ? this.config.bootValue(key) : env[key];
    const effective: ConfigValue = isLiveKey(key) ? this.config.get(key) : boot;
    const show = (v: ConfigValue): ConfigValue | null =>
      d.secret ? null : d.redactUrl && typeof v === 'string' ? redactConfigUrl(v) : v;

    return {
      key,
      envVars: [...(d.envVars ?? [key])],
      category: d.category,
      description: d.description,
      kind: d.kind,
      unit: d.unit ?? null,
      options: d.options ? [...d.options] : null,
      min: d.mutability === 'live' ? (d.min ?? null) : null,
      max: d.mutability === 'live' ? (d.max ?? null) : null,
      mutability: d.mutability,
      restartReason: d.mutability === 'restart' ? d.restartReason : null,
      secret: d.secret ?? false,
      isSet: boot !== '',
      source: override ? 'override' : isExplicitlySet(key) ? 'env' : 'default',
      bootValue: show(boot),
      effectiveValue: show(effective),
      override,
    };
  }
}
```

Notes for the implementer:
- `isLiveKey(key) ? … : env[key]`: in the false branch, `key` narrows to `RestartKey`, so `env[key]` typechecks.
- On Postgres, `updatedAt` is a `mode: 'string'` timestamp, so both dialects return a string.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter server test -- tests/config/redact.test.ts tests/services/config-overrides.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm typecheck && pnpm lint
git add packages/server/src/config/redact.ts packages/server/src/services/config-overrides.ts packages/server/tests/config/redact.test.ts packages/server/tests/services/config-overrides.test.ts
git commit -m "feat(config): persist and audit runtime config overrides"
```

---

### Task 8: Admin routes, boot wiring, CLAUDE.md

**Files:**
- Create: `packages/server/src/routes/admin/config.ts`
- Modify: `packages/server/src/routes/admin/index.ts`, `packages/server/src/app.ts`
- Modify: `CLAUDE.md`
- Test: `packages/server/tests/routes/admin-config.test.ts`

**Interfaces:**
- Consumes: `ConfigOverridesService` (Task 7), and `isConfigKey`, `isLiveKey`, `liveValueSchema` (Task 1).
- Produces:
  - `GET /admin/config` → `AdminConfigResponse`
  - `PUT /admin/config/:key` with an `AdminSetConfigRequest` body → `AdminConfigEntry`
  - `DELETE /admin/config/:key` → `AdminConfigEntry`
  - Errors use the `{ code, message }` shape: 404 `UNKNOWN_CONFIG_KEY`, 409 `CONFIG_NOT_LIVE`, 400 `INVALID_CONFIG_VALUE`.
  - `adminConfigRoutes(svc: ConfigOverridesService)`
  - `adminRoutes(db, provider, systemSettings, configOverrides, bus?, registry?)`

- [ ] **Step 1: Write the failing route tests**

Create `packages/server/tests/routes/admin-config.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AdminConfigEntry, AdminConfigResponse } from '@markettrader/shared';
import { createTestAppWithDb, registerAdmin } from '../helpers/app.js';
import { env } from '../../src/env.js';
import { CONFIG_REGISTRY } from '../../src/config/registry.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';

describe('/admin/config', () => {
  let app: FastifyInstance;
  let config: RuntimeConfig;
  let admin: { authorization: string };
  let member: { authorization: string };

  beforeAll(async () => {
    ({ app, config } = await createTestAppWithDb());
    admin = { authorization: `Bearer ${(await registerAdmin(app, 'cfg-admin')).token}` };
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'cfg-member', password: 'password123' },
    });
    member = { authorization: `Bearer ${reg.json<{ token: string }>().token}` };
  });

  // Overrides persist in the file's shared in-memory DB, so remove them between tests.
  afterEach(async () => {
    for (const key of config.overriddenKeys()) {
      await app.inject({ method: 'DELETE', url: `/admin/config/${key}`, headers: admin });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const put = (key: string, value: unknown) =>
    app.inject({ method: 'PUT', url: `/admin/config/${key}`, headers: admin, payload: { value } });

  it('rejects unauthenticated (401) and non-admin (403) callers', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/config' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/admin/config', headers: member })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'PUT', url: '/admin/config/WATCHLIST_MAX_ITEMS', headers: member, payload: { value: 5 } })).statusCode,
    ).toBe(403);
  });

  it('lists every option in registry order without leaking secrets', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/config', headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.json<AdminConfigResponse>().entries.map((e) => e.key)).toEqual(Object.keys(CONFIG_REGISTRY));
    expect(res.body).not.toContain(env.JWT_SECRET);
  });

  it('applies a live override immediately and reports its source', async () => {
    const res = await put('WATCHLIST_MAX_ITEMS', 12);
    expect(res.statusCode).toBe(200);
    expect(res.json<AdminConfigEntry>()).toMatchObject({ source: 'override', effectiveValue: 12 });
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(12);
  });

  it.each([
    ['STOCK_CACHE_TTL_MS', 1],
    ['STOCK_CACHE_TTL_MS', 1.5],
    ['STOCK_CACHE_TTL_MS', '60000'],
    ['STOCK_ALLOW_STALE_TRADES', 'true'],
    ['MARKET_HOURS_MODE', 'sometimes'],
  ])('rejects %s = %j with 400 and changes nothing', async (key, value) => {
    const res = await put(key, value);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe('INVALID_CONFIG_VALUE');
    expect(config.overriddenKeys()).toEqual([]);
  });

  it.each(['PORT', 'JWT_SECRET', 'DATABASE_URL'])('refuses to override restart-only %s (409)', async (key) => {
    const res = await put(key, 'x');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code: string }>().code).toBe('CONFIG_NOT_LIVE');
  });

  it.each(['NOPE', 'toString', 'constructor', 'watchlist_max_items'])('answers 404 for %s', async (key) => {
    expect((await put(key, 1)).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/admin/config/${key}`, headers: admin })).statusCode).toBe(404);
  });

  it('DELETE restores the boot value', async () => {
    await put('WATCHLIST_MAX_ITEMS', 12);
    const res = await app.inject({ method: 'DELETE', url: '/admin/config/WATCHLIST_MAX_ITEMS', headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.json<AdminConfigEntry>()).toMatchObject({
      override: null,
      effectiveValue: config.bootValue('WATCHLIST_MAX_ITEMS'),
    });
    expect(config.get('WATCHLIST_MAX_ITEMS')).toBe(config.bootValue('WATCHLIST_MAX_ITEMS'));
  });

  it('an override reaches the feature it controls', async () => {
    await put('WATCHLIST_MAX_PER_USER', 1);
    const create = (name: string) =>
      app.inject({ method: 'POST', url: '/watchlists', headers: admin, payload: { name } });
    expect((await create('cfg-a')).statusCode).toBe(201);
    expect((await create('cfg-b')).statusCode).toBe(409);
  });

  it('persists across a rebuild, and so does a reset', async () => {
    await put('STOCK_SEARCH_CACHE_TTL_MS', 120_000);

    // A second app on the same (shared in-memory) database is a restart: it
    // starts from boot values and buildApp's load() restores the override.
    const second = await createTestAppWithDb();
    try {
      expect(second.config.get('STOCK_SEARCH_CACHE_TTL_MS')).toBe(120_000);
      const entries = (await second.app.inject({ method: 'GET', url: '/admin/config', headers: admin }))
        .json<AdminConfigResponse>().entries;
      expect(entries.find((e) => e.key === 'STOCK_SEARCH_CACHE_TTL_MS')!.override).toMatchObject({
        value: 120_000,
        updatedBy: 'cfg-admin',
      });
      await second.app.inject({ method: 'DELETE', url: '/admin/config/STOCK_SEARCH_CACHE_TTL_MS', headers: admin });
    } finally {
      await second.app.close();
    }

    const third = await createTestAppWithDb();
    try {
      expect(third.config.get('STOCK_SEARCH_CACHE_TTL_MS')).toBe(third.config.bootValue('STOCK_SEARCH_CACHE_TTL_MS'));
    } finally {
      await third.app.close();
    }
    // The DELETE went through the second app, so the first app's config still
    // holds the override in memory; drop it so later tests in this file start clean.
    config.clear('STOCK_SEARCH_CACHE_TTL_MS');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter server test -- tests/routes/admin-config.test.ts`
Expected: FAIL, 404 on `/admin/config`.

- [ ] **Step 3: Implement the routes**

Create `packages/server/src/routes/admin/config.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AdminConfigEntry, AdminConfigResponse } from '@markettrader/shared';
import { isConfigKey, isLiveKey, liveValueSchema, type LiveKey } from '../../config/registry.js';
import type { ConfigOverridesService } from '../../services/config-overrides.js';

const keyParams = z.object({ key: z.string().min(1).max(64) });
const setBody = z.object({ value: z.union([z.string().max(2048), z.number(), z.boolean()]) });

type KeyCheck =
  | { ok: true; key: LiveKey }
  | { ok: false; status: 404 | 409; code: string; message: string };

function resolveLiveKey(raw: string): KeyCheck {
  if (!isConfigKey(raw)) {
    return { ok: false, status: 404, code: 'UNKNOWN_CONFIG_KEY', message: `No configuration option named ${raw}.` };
  }
  if (!isLiveKey(raw)) {
    return {
      ok: false,
      status: 409,
      code: 'CONFIG_NOT_LIVE',
      message: `${raw} is read once at startup. Change it in the environment and restart.`,
    };
  }
  return { ok: true, key: raw };
}

/**
 * Admin configuration panel endpoints (all `requireAdmin`):
 *   GET    /admin/config      — every option, secrets reduced to `isSet`
 *   PUT    /admin/config/:key — override a live option (persists, audited)
 *   DELETE /admin/config/:key — drop the override, restoring the boot value
 */
export function adminConfigRoutes(svc: ConfigOverridesService) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();

    app.get('/admin/config', {
      onRequest: rawApp.requireAdmin,
      schema: { tags: ['Admin'], summary: 'List every host configuration option.', security: [{ bearerAuth: [] }] },
    }, async (_request, reply) => {
      const body: AdminConfigResponse = { entries: await svc.list() };
      return reply.send(body);
    });

    app.put('/admin/config/:key', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Override a live configuration option.',
        security: [{ bearerAuth: [] }],
        params: keyParams,
        body: setBody,
      },
    }, async (request, reply) => {
      const check = resolveLiveKey(request.params.key);
      if (!check.ok) return reply.status(check.status).send({ code: check.code, message: check.message });

      const parsed = liveValueSchema(check.key).safeParse(request.body.value);
      if (!parsed.success) {
        return reply.status(400).send({
          code: 'INVALID_CONFIG_VALUE',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }
      const entry: AdminConfigEntry = await svc.set(check.key, parsed.data, request.user.id);
      return reply.send(entry);
    });

    app.delete('/admin/config/:key', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Remove an override; the boot value applies again.',
        security: [{ bearerAuth: [] }],
        params: keyParams,
      },
    }, async (request, reply) => {
      const check = resolveLiveKey(request.params.key);
      if (!check.ok) return reply.status(check.status).send({ code: check.code, message: check.message });
      const entry: AdminConfigEntry = await svc.reset(check.key, request.user.id);
      return reply.send(entry);
    });
  };
}
```

- [ ] **Step 4: Wire it in**

`routes/admin/index.ts`:
- Import `adminConfigRoutes` and `type ConfigOverridesService`.
- Add a required parameter `configOverrides: ConfigOverridesService` after `systemSettings`.
- Register `await app.register(adminConfigRoutes(configOverrides));` after `adminSystemRoutes`.
- Mention it in the JSDoc.

`app.ts`, right after `await systemSettings.ensureSeeded();`:

```ts
  // Before any worker arms a timer, so their first reads already see the
  // persisted overrides.
  const configOverrides = new ConfigOverridesService(db, runtimeConfig);
  const activeOverrides = await configOverrides.load(app.log);
  if (activeOverrides.length > 0) {
    app.log.warn(
      { keys: activeOverrides },
      'runtime config overrides active; they take precedence over the environment until reset in /admin/config',
    );
  }
```

Update the registration to `adminRoutes(db, provider, systemSettings, configOverrides, bus, registry)`, and add `import { ConfigOverridesService } from './services/config-overrides.js';`. Confirm there are no other callers: `grep -rn "adminRoutes(" packages/server` should show only `app.ts`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter server test -- tests/routes/admin-config.test.ts tests/config tests/services/config-overrides.test.ts tests/docs.test.ts`
Expected: PASS. `docs.test.ts` confirms the OpenAPI spec still builds. Then run `pnpm --filter server test`. Expected: PASS.

- [ ] **Step 6: Update CLAUDE.md**

In `CLAUDE.md` → **Environment Variables**, after the paragraph ending "`env.ts` is the source of truth for the full set.", add:

```markdown
**Live-editable options (`/admin/config`).** `env.ts` exports two objects: `env` (read once at
startup) and `liveBootConfig` (boot values of options an admin may override at runtime). Live
options are not on `env`, so `env.KEY` for one is a type error — read it through the
`ConfigReader` that `buildApp` passes in (`config.get('KEY')`), never by importing
`liveBootConfig` (a lint rule allows that only in `config/runtime-config.ts`). Each app owns one
`RuntimeConfig`; `ConfigOverridesService` loads persisted overrides (`system_settings` rows keyed
`config.override.<KEY>`) into it at boot, before any worker starts, and they win over the
environment until reset. Every option has a descriptor in `config/registry.ts`; its `satisfies`
clause fails typecheck if one is missing or has the wrong mutability.

To make an option live: move it from `env` to `liveBootConfig`, switch its descriptor to `live`
with a `min`/`max`, and give each consumer the compiler then flags a `ConfigReader` parameter.
Read it per use, never once at construction. Secrets are never live. Override bounds are
deliberately tighter than env parsing. In tests, simulate the host's environment with
`createTestApp(provider, status, { runtimeConfig: RuntimeConfig.fromEnvironment({ KEY: v }) })`
and an admin override with `config.set` — never by mutating `env`.
```

- [ ] **Step 7: Commit**

```bash
pnpm typecheck && pnpm lint
git add packages/server CLAUDE.md
git commit -m "feat(admin): /admin/config endpoints for viewing and overriding host options"
```

---

### Task 9: Frontend data layer and row components

**Files:**
- Create: `packages/frontend/src/api/admin/config.ts`, `src/lib/configFormat.ts`, `src/components/admin/ConfigValueEditor.tsx`, `src/components/admin/ConfigEntryRow.tsx`
- Test: `packages/frontend/tests/lib/configFormat.test.ts`, `packages/frontend/tests/components/admin/ConfigEntryRow.test.tsx`

**Interfaces:**
- Consumes:
  - shared: `AdminConfigEntry`, `AdminConfigResponse`, `AdminSetConfigRequest`, `ConfigValue`, `ConfigValueSource`
  - `apiFetch`, `toast`, `toastApiError`, `cn`
  - ShadCN `Button` (variants include `outline`, sizes include `sm`), `Input`, `TableRow`, `TableCell`
- Produces:
  - hooks: `adminConfigKeys`, `useAdminConfig()`, `useAdminSetConfig()`, `useAdminResetConfig()`
  - formatting: `formatMs(ms)`, `formatConfigValue(entry, value)`, `parseConfigDraft(entry, draft): DraftResult`
  - components: `<ConfigValueEditor entry pending onSave onReset />`, `<ConfigEntryRow entry />`

- [ ] **Step 1: Write the failing formatting tests**

Create `packages/frontend/tests/lib/configFormat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AdminConfigEntry } from '@markettrader/shared';
import { formatConfigValue, formatMs, parseConfigDraft } from '@/lib/configFormat';

const base: AdminConfigEntry = {
  key: 'STOCK_CACHE_TTL_MS', envVars: ['STOCK_CACHE_TTL_MS'], category: 'stock-data',
  description: '', kind: 'integer', unit: 'ms', options: null, min: 1000, max: 3_600_000,
  mutability: 'live', restartReason: null, secret: false, isSet: true, source: 'default',
  bootValue: 60000, effectiveValue: 60000, override: null,
};

describe('formatMs', () => {
  it.each([[900, '900ms'], [1000, '1s'], [90_000, '1m 30s'], [3_600_000, '1h'], [86_400_000, '1d']])(
    '%i → %s',
    (ms, text) => expect(formatMs(ms)).toBe(text),
  );
});

describe('formatConfigValue', () => {
  it('appends a human duration to ms values', () => {
    expect(formatConfigValue(base, 300000)).toBe('300000 ms (5m)');
  });
  it('never renders a secret', () => {
    const secret = { ...base, kind: 'string' as const, unit: null, secret: true };
    expect(formatConfigValue(secret, null)).toBe('Set (hidden)');
    expect(formatConfigValue({ ...secret, isSet: false }, null)).toBe('Not set');
  });
  it('labels the empty string', () => {
    expect(formatConfigValue({ ...base, kind: 'string', unit: null }, '')).toBe('(empty)');
  });
});

describe('parseConfigDraft', () => {
  it('enforces integer form and bounds', () => {
    expect(parseConfigDraft(base, '5000')).toEqual({ ok: true, value: 5000 });
    expect(parseConfigDraft(base, '1.5').ok).toBe(false);
    expect(parseConfigDraft(base, '10').ok).toBe(false);
    expect(parseConfigDraft(base, '').ok).toBe(false);
  });
  it('maps boolean drafts', () => {
    expect(parseConfigDraft({ ...base, kind: 'boolean', unit: null }, 'false')).toEqual({ ok: true, value: false });
  });
  it('restricts enums to their options', () => {
    const e = { ...base, kind: 'enum' as const, unit: null, options: ['instant', 'pending'] };
    expect(parseConfigDraft(e, 'pending')).toEqual({ ok: true, value: 'pending' });
    expect(parseConfigDraft(e, 'nope').ok).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing row test**

Create `packages/frontend/tests/components/admin/ConfigEntryRow.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdminConfigEntry } from '@markettrader/shared';

const setMutate = vi.fn().mockResolvedValue({});
const resetMutate = vi.fn().mockResolvedValue({});

vi.mock('@/api/admin/config', () => ({
  useAdminSetConfig: () => ({ mutateAsync: setMutate, isPending: false }),
  useAdminResetConfig: () => ({ mutateAsync: resetMutate, isPending: false }),
}));

import { ConfigEntryRow } from '@/components/admin/ConfigEntryRow';

const live: AdminConfigEntry = {
  key: 'WATCHLIST_MAX_ITEMS', envVars: ['WATCHLIST_MAX_ITEMS'], category: 'limits',
  description: 'Symbols one watchlist may hold.', kind: 'integer', unit: null, options: null,
  min: 1, max: 500, mutability: 'live', restartReason: null, secret: false, isSet: true,
  source: 'default', bootValue: 50, effectiveValue: 50, override: null,
};

function renderRow(entry: AdminConfigEntry) {
  return render(
    <table>
      <tbody>
        <ConfigEntryRow entry={entry} />
      </tbody>
    </table>,
  );
}

describe('ConfigEntryRow', () => {
  beforeEach(() => {
    setMutate.mockClear();
    resetMutate.mockClear();
  });

  it('saves a typed integer for a live option', async () => {
    renderRow(live);
    const input = screen.getByLabelText('WATCHLIST_MAX_ITEMS value');
    await userEvent.clear(input);
    await userEvent.type(input, '75');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(setMutate).toHaveBeenCalledWith({ key: 'WATCHLIST_MAX_ITEMS', value: 75 });
  });

  it('disables Save for an out-of-range value', async () => {
    renderRow(live);
    const input = screen.getByLabelText('WATCHLIST_MAX_ITEMS value');
    await userEvent.clear(input);
    await userEvent.type(input, '9999');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Maximum 500')).toBeInTheDocument();
  });

  it('offers reset only when overridden, and shows the environment value', async () => {
    renderRow({
      ...live, source: 'override', effectiveValue: 10,
      override: { value: 10, updatedAt: '2026-10-13T12:00:00.000Z', updatedBy: 'root' },
    });
    expect(screen.getByText(/environment: 50/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reset to environment' }));
    expect(resetMutate).toHaveBeenCalledWith('WATCHLIST_MAX_ITEMS');
  });

  it('renders restart-only options read-only', () => {
    renderRow({ ...live, key: 'PORT', mutability: 'restart', restartReason: 'Bound once.' });
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByText('Restart required')).toHaveAttribute('title', 'Bound once.');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm build:shared && pnpm --filter frontend test -- tests/lib/configFormat.test.ts tests/components/admin/ConfigEntryRow.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement the API hooks**

Create `packages/frontend/src/api/admin/config.ts`:

```ts
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type { AdminConfigEntry, AdminConfigResponse, AdminSetConfigRequest } from '@markettrader/shared';

export const adminConfigKeys = {
  all: ['admin', 'config'] as const,
};

/** GET every host configuration option. */
export function useAdminConfig() {
  return useQuery({
    queryKey: adminConfigKeys.all,
    queryFn: () => apiFetch<AdminConfigResponse>('/admin/config'),
  });
}

function replaceEntry(qc: QueryClient, next: AdminConfigEntry) {
  qc.setQueryData<AdminConfigResponse>(adminConfigKeys.all, (prev) =>
    prev ? { entries: prev.entries.map((e) => (e.key === next.key ? next : e)) } : prev,
  );
}

/** PUT an override for a live option; the cached list is patched with the returned entry. */
export function useAdminSetConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string } & AdminSetConfigRequest) =>
      apiFetch<AdminConfigEntry>(`/admin/config/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: { value },
      }),
    onSuccess: (next) => replaceEntry(qc, next),
  });
}

/** DELETE an override so the environment value applies again. */
export function useAdminResetConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      apiFetch<AdminConfigEntry>(`/admin/config/${encodeURIComponent(key)}`, { method: 'DELETE' }),
    onSuccess: (next) => replaceEntry(qc, next),
  });
}
```

- [ ] **Step 5: Implement the formatting helpers**

Create `packages/frontend/src/lib/configFormat.ts`:

```ts
import type { AdminConfigEntry, ConfigValue } from '@markettrader/shared';

const UNITS: [suffix: string, ms: number][] = [
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000],
  ['s', 1_000],
];

/** `90000` → `1m 30s`. Sub-second values stay in ms. */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const parts: string[] = [];
  let rest = ms;
  for (const [suffix, size] of UNITS) {
    const n = Math.floor(rest / size);
    if (n > 0) parts.push(`${n}${suffix}`);
    rest -= n * size;
  }
  return parts.join(' ');
}

/** Display text for a config value. Secrets render as set/not set, never as a value. */
export function formatConfigValue(entry: AdminConfigEntry, value: ConfigValue | null): string {
  if (entry.secret) return entry.isSet ? 'Set (hidden)' : 'Not set';
  if (value === null) return '—';
  if (value === '') return '(empty)';
  if (entry.unit === 'ms' && typeof value === 'number') return `${value} ms (${formatMs(value)})`;
  return String(value);
}

export type DraftResult = { ok: true; value: ConfigValue } | { ok: false; error: string };

/** Parses editor text into the option's JSON type. Advisory — the server re-validates. */
export function parseConfigDraft(entry: AdminConfigEntry, draft: string): DraftResult {
  switch (entry.kind) {
    case 'integer': {
      if (!/^\d+$/.test(draft.trim())) return { ok: false, error: 'Whole number required' };
      const n = Number(draft);
      if (entry.min !== null && n < entry.min) return { ok: false, error: `Minimum ${entry.min}` };
      if (entry.max !== null && n > entry.max) return { ok: false, error: `Maximum ${entry.max}` };
      return { ok: true, value: n };
    }
    case 'boolean':
      return { ok: true, value: draft === 'true' };
    case 'enum':
      return entry.options?.includes(draft) ? { ok: true, value: draft } : { ok: false, error: 'Pick an option' };
    case 'string':
      return { ok: true, value: draft };
  }
}
```

- [ ] **Step 6: Implement the editor and the row**

Create `packages/frontend/src/components/admin/ConfigValueEditor.tsx`:

```tsx
import { useState } from 'react';
import type { AdminConfigEntry, ConfigValue } from '@markettrader/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMs, parseConfigDraft } from '@/lib/configFormat';

interface ConfigValueEditorProps {
  entry: AdminConfigEntry;
  pending: boolean;
  onSave: (value: ConfigValue) => void;
  onReset: () => void;
}

const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/**
 * Inline editor for one live option. Client-side parsing only gates the Save
 * button; the server re-validates every write. Remount it (via `key`) when the
 * effective value changes so the draft resets.
 */
export function ConfigValueEditor({ entry, pending, onSave, onReset }: ConfigValueEditorProps) {
  const [draft, setDraft] = useState(() => String(entry.effectiveValue ?? ''));
  const parsed = parseConfigDraft(entry, draft);
  const changed = parsed.ok && parsed.value !== entry.effectiveValue;
  const label = `${entry.key} value`;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {entry.kind === 'boolean' || entry.kind === 'enum' ? (
          <select aria-label={label} className={selectClass} value={draft} onChange={(e) => setDraft(e.target.value)}>
            {(entry.kind === 'boolean' ? ['true', 'false'] : (entry.options ?? [])).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        ) : (
          <Input
            aria-label={label}
            className="h-9 w-36"
            inputMode={entry.kind === 'integer' ? 'numeric' : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        )}
        <Button size="sm" disabled={!changed || pending} onClick={() => parsed.ok && onSave(parsed.value)}>
          Save
        </Button>
        {entry.override && (
          <Button size="sm" variant="outline" disabled={pending} onClick={onReset}>
            Reset to environment
          </Button>
        )}
      </div>
      {!parsed.ok && <span className="text-xs text-destructive">{parsed.error}</span>}
      {parsed.ok && entry.unit === 'ms' && typeof parsed.value === 'number' && (
        <span className="text-xs text-muted-foreground">{formatMs(parsed.value)}</span>
      )}
      {entry.min !== null && entry.max !== null && (
        <span className="text-xs text-muted-foreground">
          Allowed here: {entry.min}–{entry.max} (stricter than the environment allows)
        </span>
      )}
    </div>
  );
}
```

Create `packages/frontend/src/components/admin/ConfigEntryRow.tsx`:

```tsx
import type { AdminConfigEntry, ConfigValue, ConfigValueSource } from '@markettrader/shared';
import { TableCell, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { toastApiError } from '@/lib/toastApiError';
import { formatConfigValue } from '@/lib/configFormat';
import { cn } from '@/lib/utils';
import { useAdminResetConfig, useAdminSetConfig } from '@/api/admin/config';
import { ConfigValueEditor } from './ConfigValueEditor';

const SOURCE_STYLE: Record<ConfigValueSource, { label: string; className: string }> = {
  default: { label: 'Default', className: 'bg-muted text-muted-foreground' },
  env: { label: 'Environment', className: 'bg-secondary text-secondary-foreground' },
  override: { label: 'Override', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
};

/** One option in the configuration table: value, provenance, and an editor when live. */
export function ConfigEntryRow({ entry }: { entry: AdminConfigEntry }) {
  const setConfig = useAdminSetConfig();
  const resetConfig = useAdminResetConfig();
  const source = SOURCE_STYLE[entry.source];

  async function save(value: ConfigValue) {
    try {
      await setConfig.mutateAsync({ key: entry.key, value });
      toast({ title: `${entry.key} updated`, variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Update failed');
    }
  }

  async function reset() {
    try {
      await resetConfig.mutateAsync(entry.key);
      toast({ title: `${entry.key} reset to environment`, variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Reset failed');
    }
  }

  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="font-mono text-xs font-medium">{entry.key}</div>
        {entry.envVars.length > 1 && (
          <div className="text-xs text-muted-foreground">also read: {entry.envVars.slice(1).join(', ')}</div>
        )}
        <p className="mt-1 max-w-md text-xs text-muted-foreground">{entry.description}</p>
      </TableCell>
      <TableCell className="align-top font-mono text-xs">
        <div>{formatConfigValue(entry, entry.effectiveValue)}</div>
        {entry.override && (
          <div className="text-muted-foreground">
            environment: {formatConfigValue(entry, entry.bootValue)}
            {entry.override.updatedBy && ` · set by ${entry.override.updatedBy}`}
          </div>
        )}
      </TableCell>
      <TableCell className="align-top">
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', source.className)}>{source.label}</span>
      </TableCell>
      <TableCell className="align-top">
        {entry.mutability === 'live' ? (
          <ConfigValueEditor
            key={String(entry.effectiveValue)}
            entry={entry}
            pending={setConfig.isPending || resetConfig.isPending}
            onSave={(v) => void save(v)}
            onReset={() => void reset()}
          />
        ) : (
          <span className="text-xs text-muted-foreground" title={entry.restartReason ?? undefined}>
            Restart required
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter frontend test -- tests/lib/configFormat.test.ts tests/components/admin/ConfigEntryRow.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pnpm typecheck && pnpm lint
git add packages/frontend
git commit -m "feat(admin-ui): config hooks, value formatting, and editable rows"
```

---

### Task 10: Configuration page, navigation, e2e, docs, changeset

**Files:**
- Create: `packages/frontend/src/lib/clientBuildConfig.ts`, `packages/frontend/src/pages/admin/AdminConfigPage.tsx`
- Modify: `packages/frontend/src/components/admin/AdminLayout.tsx`, `packages/frontend/src/App.tsx`
- Test: `packages/frontend/tests/pages/AdminConfigPage.test.tsx`, `packages/frontend/e2e/admin/config.spec.ts`
- Modify: `docs/design.md`, `.env.example`; create `.changeset/admin-config-panel.md`

**Interfaces:**
- Consumes: `useAdminConfig`, `ConfigEntryRow` (Task 9); ShadCN `Card*`, `Table*`, `Input`, `Skeleton`.
- Produces: `clientBuildConfig(): ClientBuildEntry[]`, `<AdminConfigPage />` at `/admin/config`, and a **Config** nav link.

- [ ] **Step 1: Write the failing page test**

Create `packages/frontend/tests/pages/AdminConfigPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import type { AdminConfigEntry } from '@markettrader/shared';

function entry(over: Partial<AdminConfigEntry>): AdminConfigEntry {
  return {
    key: 'X', envVars: [over.key ?? 'X'], category: 'core', description: '', kind: 'integer',
    unit: null, options: null, min: null, max: null, mutability: 'restart', restartReason: 'r',
    secret: false, isSet: true, source: 'default', bootValue: 1, effectiveValue: 1, override: null,
    ...over,
  };
}

const entries: AdminConfigEntry[] = [
  entry({ key: 'PORT', category: 'core', bootValue: 3000, effectiveValue: 3000 }),
  entry({ key: 'JWT_SECRET', category: 'security', kind: 'string', secret: true, bootValue: null, effectiveValue: null }),
  entry({
    key: 'WATCHLIST_MAX_ITEMS', category: 'limits', mutability: 'live', restartReason: null, min: 1, max: 500,
    source: 'override', bootValue: 50, effectiveValue: 10,
    override: { value: 10, updatedAt: '2026-10-13T00:00:00.000Z', updatedBy: 'root' },
  }),
];

vi.mock('@/api/admin/config', () => ({
  useAdminConfig: () => ({ data: { entries }, isLoading: false, isError: false }),
  useAdminSetConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAdminResetConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { AdminConfigPage } from '@/pages/admin/AdminConfigPage';

describe('AdminConfigPage', () => {
  it('groups options by category and never shows a secret value', () => {
    render(<AdminConfigPage />);
    expect(screen.getByRole('heading', { name: 'Configuration' })).toBeInTheDocument();
    expect(screen.getByText('Core')).toBeInTheDocument();
    expect(screen.getByText('Security & auth')).toBeInTheDocument();
    expect(screen.getByText('Set (hidden)')).toBeInTheDocument();
  });

  it('counts active overrides in a banner', () => {
    render(<AdminConfigPage />);
    expect(screen.getByText(/1 runtime override active/)).toBeInTheDocument();
  });

  it('filters by key text and by live-only', async () => {
    render(<AdminConfigPage />);
    await userEvent.type(screen.getByPlaceholderText('Filter options…'), 'port');
    expect(screen.getByText('PORT')).toBeInTheDocument();
    expect(screen.queryByText('WATCHLIST_MAX_ITEMS')).toBeNull();

    await userEvent.clear(screen.getByPlaceholderText('Filter options…'));
    await userEvent.click(screen.getByLabelText('Live-editable only'));
    expect(screen.queryByText('PORT')).toBeNull();
    expect(screen.getByText('WATCHLIST_MAX_ITEMS')).toBeInTheDocument();
  });

  it('shows the bundle’s build-time variables', () => {
    render(<AdminConfigPage />);
    expect(screen.getByText('VITE_POSTHOG_HOST')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter frontend test -- tests/pages/AdminConfigPage.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `clientBuildConfig`**

Create `packages/frontend/src/lib/clientBuildConfig.ts`:

```ts
/** One Vite build-time variable baked into this bundle. */
export interface ClientBuildEntry {
  key: string;
  value: string | null;
  description: string;
}

/**
 * The `VITE_*` values this bundle was built with. Read-only by nature: Vite
 * inlines them at build time, so changing one means rebuilding the frontend.
 * All of them ship to every browser, so none is secret.
 */
export function clientBuildConfig(): ClientBuildEntry[] {
  const env = import.meta.env;
  return [
    { key: 'MODE', value: env.MODE, description: 'Vite build mode.' },
    {
      key: 'VITE_OTEL_EXPORTER_URL',
      value: env.VITE_OTEL_EXPORTER_URL ?? null,
      description: 'Where the browser sends OTLP telemetry. Empty disables it.',
    },
    {
      key: 'VITE_POSTHOG_KEY',
      value: env.VITE_POSTHOG_KEY ?? null,
      description: 'PostHog project token for the SPA. Public by design.',
    },
    {
      key: 'VITE_POSTHOG_HOST',
      value: env.VITE_POSTHOG_HOST ?? null,
      description: 'PostHog ingestion path — normally the same-origin /relay proxy.',
    },
    {
      key: 'VITE_POSTHOG_UI_HOST',
      value: env.VITE_POSTHOG_UI_HOST ?? null,
      description: 'PostHog app URL used for links out of the SPA.',
    },
  ];
}
```

If `src/vite-env.d.ts` lacks any of these, add them to `ImportMetaEnv` as `readonly VITE_…?: string`.

- [ ] **Step 4: Implement the page**

Create `packages/frontend/src/pages/admin/AdminConfigPage.tsx`:

```tsx
import { useMemo, useState } from 'react';
import type { AdminConfigEntry, ConfigCategory } from '@markettrader/shared';
import { useAdminConfig } from '@/api/admin/config';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfigEntryRow } from '@/components/admin/ConfigEntryRow';
import { clientBuildConfig } from '@/lib/clientBuildConfig';

const CATEGORY_LABELS: Record<ConfigCategory, string> = {
  core: 'Core',
  security: 'Security & auth',
  database: 'Database',
  'stock-data': 'Stock data',
  'market-hours': 'Market hours',
  workers: 'Background workers',
  limits: 'Limits',
  websocket: 'WebSockets',
  observability: 'OpenTelemetry',
  analytics: 'PostHog',
};

function matches(entry: AdminConfigEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || entry.key.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q);
}

export function AdminConfigPage() {
  const config = useAdminConfig();
  const [query, setQuery] = useState('');
  const [liveOnly, setLiveOnly] = useState(false);

  const groups = useMemo(() => {
    const visible = (config.data?.entries ?? []).filter(
      (e) => matches(e, query) && (!liveOnly || e.mutability === 'live'),
    );
    return (Object.keys(CATEGORY_LABELS) as ConfigCategory[])
      .map((category) => ({ category, entries: visible.filter((e) => e.category === category) }))
      .filter((g) => g.entries.length > 0);
  }, [config.data, query, liveOnly]);

  const overrideCount = config.data?.entries.filter((e) => e.override).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Configuration</h1>
        <p className="text-sm text-muted-foreground">
          The options this server booted with. Live options can be changed here: the change applies
          immediately, persists across restarts, and wins over the environment until you reset it.
        </p>
      </div>

      {overrideCount > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {overrideCount} runtime override{overrideCount === 1 ? '' : 's'} active — the environment value
          is ignored for {overrideCount === 1 ? 'it' : 'them'} until reset.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Input
          className="max-w-xs"
          placeholder="Filter options…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} />
          Live-editable only
        </label>
      </div>

      {config.isLoading && <Skeleton className="h-64 w-full" />}
      {config.isError && <p className="text-sm text-destructive">Could not load configuration.</p>}

      {groups.map(({ category, entries }) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle className="text-base">{CATEGORY_LABELS[category]}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Option</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <ConfigEntryRow key={e.key} entry={e} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Frontend build</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <p className="mb-2 text-xs text-muted-foreground">
            Inlined by Vite when this bundle was built. Changing one requires rebuilding the frontend.
          </p>
          <Table>
            <TableBody>
              {clientBuildConfig().map((b) => (
                <TableRow key={b.key}>
                  <TableCell className="align-top">
                    <div className="font-mono text-xs font-medium">{b.key}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{b.description}</p>
                  </TableCell>
                  <TableCell className="align-top font-mono text-xs">{b.value || '(empty)'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Add navigation and the route**

`components/admin/AdminLayout.tsx` → `NAV_LINKS`, between System and Audit:

```ts
  { to: '/admin/config', label: 'Config' },
```

`App.tsx`: add the lazy import next to the other admin pages:

```ts
const AdminConfigPage = lazy(() =>
  import('@/pages/admin/AdminConfigPage').then((m) => ({ default: m.AdminConfigPage })),
);
```

and add the route inside the `/admin` block, after `system`:

```tsx
                <Route path="config" element={<AdminConfigPage />} />
```

- [ ] **Step 6: Run the unit tests**

Run: `pnpm --filter frontend test`
Expected: PASS, including `App.test.tsx`.

- [ ] **Step 7: Add the e2e spec**

Create `packages/frontend/e2e/admin/config.spec.ts`:

```ts
import { test, expect } from '../fixtures/base';

test.describe('Admin config', () => {
  test('API: list, override, and reset a live option', async ({ apiClient, adminUser }) => {
    const headers = { Authorization: `Bearer ${adminUser.accessToken}` };

    const list = await apiClient.get('/admin/config', { headers });
    expect(list.ok()).toBeTruthy();
    const { entries } = (await list.json()) as { entries: { key: string; secret: boolean; bootValue: unknown }[] };
    expect(entries.some((e) => e.key === 'WATCHLIST_MAX_ITEMS')).toBeTruthy();
    expect(entries.filter((e) => e.secret).every((e) => e.bootValue === null)).toBeTruthy();

    const put = await apiClient.put('/admin/config/WATCHLIST_MAX_ITEMS', { headers, data: { value: 42 } });
    expect(put.ok(), await put.text()).toBeTruthy();
    expect((await put.json()).effectiveValue).toBe(42);

    const reset = await apiClient.delete('/admin/config/WATCHLIST_MAX_ITEMS', { headers });
    expect(reset.ok()).toBeTruthy();
    expect((await reset.json()).override).toBeNull();
  });

  test('UI: config page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/config');
    await expect(adminPage.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    await expect(adminPage.getByText('WATCHLIST_MAX_ITEMS')).toBeVisible();
  });
});
```

Run: `pnpm --filter frontend e2e -- e2e/admin/config.spec.ts`
Expected: PASS. If Playwright browsers are missing, run `pnpm --filter frontend exec playwright install chromium` first. If it still cannot run, say so in the task report rather than skipping silently.

- [ ] **Step 8: Docs and changeset**

`docs/design.md`: add after "### Discover" (under *Entities*):

```markdown
### Runtime configuration (admin)

`/admin/config` lists every option the server reads from its environment — one descriptor per
option in `packages/server/src/config/registry.ts` — with the effective value, where it came
from (default / environment / override), and whether it can change live. Secrets report only
whether they are set; URL credentials are masked.

Live options (cache TTLs, rate-limit backoff, stale-trade policy, market-hours mode and extended
hours, login-throttle thresholds, worker intervals, watchlist and poller caps) live in
`liveBootConfig` rather than `env` and are read through the app's injected `RuntimeConfig`. An
override is a `system_settings` row keyed `config.override.<KEY>`, audited as
`system.config.override` / `system.config.reset`, applied immediately, re-applied at boot (which
logs a warning listing them), and wins over the environment until reset. Override bounds are
tighter than environment parsing so a mis-click cannot, say, set a 1 ms cache TTL. Restart-only
options are read-only and say why. The panel also shows the bundle's `VITE_*` build-time values.
```

`.env.example`: add at the very top:

```bash
# Many tunables below can also be overridden at runtime from the admin panel
# (/admin/config). An override persists in the database and takes precedence over
# this file until it is reset there — check the panel if a change here seems ignored.
```

Create `.changeset/admin-config-panel.md`:

```markdown
---
'@markettrader/frontend': minor
'@markettrader/server': minor
'@markettrader/shared': minor
---

Admin configuration panel at `/admin/config`: every option the server reads from its environment, with its effective value (secrets masked), where it came from, and whether it can change live. Cache TTLs, rate-limit backoff, stale-trade policy, market-hours mode, login-throttle thresholds, worker intervals, and watchlist/poller caps can be overridden from the panel; overrides apply immediately, persist across restarts, and win over the environment until reset. The pending-orders worker now runs in every market-hours mode, so limit/stop/bracket orders fill and day orders expire on servers using the default `instant` mode too.
```

If Task 6 was dropped, remove "worker intervals" from both texts.

- [ ] **Step 9: Full gate and commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add packages/frontend docs/design.md .env.example .changeset/admin-config-panel.md
git commit -m "feat(admin-ui): configuration page for host options"
```

---

## Deployment notes (for the final summary)

- **Nothing outside this repo changes.** No new environment variable, proxy route, process-launch change, or migration. Server and frontend deploy together as usual.
- **The pending-orders worker now starts on every host.** Production already ran it (`MARKET_HOURS_MODE=pending`), so its behavior is unchanged there.
- **Overrides live in the production database.** Restoring a backup restores its overrides with it. The boot `warn` lists any that are active.
