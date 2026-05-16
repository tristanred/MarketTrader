# Phase 2 — Global Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the three-row global chrome (topbar, status strip, ticker tape) that wraps every authenticated page, including the server infrastructure that feeds it (system_settings table, indices broadcaster, global `/ws/live` socket).

**Architecture:** New `system_settings` DB table holds a server-configured `ticker_tape_symbols` list (admin editing comes in phase 4 — phase 2 ships only the public `GET` and a seeded default). A new `indicesBroadcaster` polls the existing `StockProvider` for major indices + the ticker-tape symbols and broadcasts batched quotes every 5s on a new global `/ws/live` socket. The frontend's `AppShell` mounts a single `useIndicesSocket()` that feeds React Query caches consumed by `StatusStrip` and `TickerTape`. The existing per-game `/games/:id/live` socket is unchanged.

**Tech Stack:** Drizzle (SQLite + Postgres), Fastify 5, @fastify/websocket, ws, Yahoo Finance via existing `StockProvider`, React 19, React Query 5, Tailwind 3.4, Vitest + React Testing Library + Supertest.

**Spec reference:** `docs/superpowers/specs/2026-05-15-terminal-design-refresh.md` — §3 (Global shell), §5.1, §5.2, §5.3, §5.4, §5.5 (Server changes), §6.1, §6.2, §6.3 (frontend shell components), §6.4 (`useIndicesSocket`). Phase 4 (admin ticker-tape editor) is explicitly out of scope here.

**Branch & commit cadence:** Work happens on `feat/phase-2-global-chrome` (already created from `new-ui`). Each task ends with a focused commit; do not batch unrelated changes. Merge into `new-ui` after Task 13.

---

## Task 0: Confirm branch state

- [ ] **Step 1: Verify current branch and clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status --short
```

Expected: branch is `feat/phase-2-global-chrome`, status is clean. If you're on a different branch, switch (`git checkout feat/phase-2-global-chrome`). If the branch doesn't exist yet, create it from `new-ui` (`git checkout new-ui && git checkout -b feat/phase-2-global-chrome`).

- [ ] **Step 2: Verify phase 1 deliverables present**

```bash
ls packages/frontend/src/components/panel/
```

Expected: `Panel.tsx`, `PanelHeader.tsx`, `PanelBody.tsx`, `index.ts`. If missing, you're on the wrong branch.

---

## File Structure

**Created (shared):**
- No new files in `packages/shared/src/types/` — additions are made to existing `websocket.ts` and a new `system-settings.ts` file.
- `packages/shared/src/types/system-settings.ts` — `TickerTapeSettings`, `IndexQuote` types.

**Modified (shared):**
- `packages/shared/src/types/websocket.ts` — add `LiveWsMessage` union (indices + ticker-tape-changed events).
- `packages/shared/src/index.ts` — re-export the new module.

**Created (server):**
- `packages/server/drizzle/sqlite/00XX_system_settings.sql` and `packages/server/drizzle/pg/00XX_system_settings.sql` — auto-generated migration.
- `packages/server/src/services/system-settings.ts` — `SystemSettingsService`.
- `packages/server/src/services/system-settings.seed.ts` — boot-time seed for the default ticker tape list.
- `packages/server/src/routes/system-settings.ts` — `GET /system-settings/ticker-tape`.
- `packages/server/src/ws/indices-broadcaster.ts` — global indices/ticker quote broadcaster.
- `packages/server/src/ws/global-live-route.ts` — `/ws/live` socket route.
- `packages/server/src/ws/global-registry.ts` — connected-client registry (separate from per-game `GameClientRegistry`).
- `packages/server/tests/system-settings.test.ts` — unit tests for service.
- `packages/server/tests/system-settings-route.test.ts` — route integration test.
- `packages/server/tests/indices-broadcaster.test.ts` — broadcaster unit test (fake clock).
- `packages/server/tests/global-live-route.test.ts` — WS handshake + broadcast test.

**Modified (server):**
- `packages/server/src/db/schema.sqlite.ts` — add `systemSettings` table.
- `packages/server/src/db/schema.pg.ts` — add `systemSettings` table.
- `packages/server/src/db/index.ts` — re-export new table in `schema`.
- `packages/server/src/app.ts` — wire seed + service + route + broadcaster + global socket.

**Created (frontend):**
- `packages/frontend/src/components/shell/AppHeader.tsx` — rewritten topbar (replaces existing top-level `AppHeader.tsx`).
- `packages/frontend/src/components/shell/StatusStrip.tsx` — second row of chrome.
- `packages/frontend/src/components/shell/TickerTape.tsx` — sticky bottom marquee.
- `packages/frontend/src/components/shell/AboutGameModal.tsx` — opened from the `[i]` button in the status strip's game-context cluster.
- `packages/frontend/src/components/shell/index.ts` — barrel export.
- `packages/frontend/src/hooks/useLiveClock.ts` — once-per-second ET clock hook.
- `packages/frontend/src/hooks/useIndicesSocket.ts` — global WS subscription + React Query cache integration.
- `packages/frontend/src/hooks/useTickerTapeSymbols.ts` — React Query hook around `GET /system-settings/ticker-tape` + live updates.
- `packages/frontend/src/api/systemSettings.ts` — API client for system settings endpoints.
- `packages/frontend/tests/AppHeader.test.tsx`, `StatusStrip.test.tsx`, `TickerTape.test.tsx`, `useLiveClock.test.tsx`, `useTickerTapeSymbols.test.tsx`.

**Modified (frontend):**
- `packages/frontend/src/components/AppShell.tsx` — compose `AppHeader + StatusStrip + <Outlet> + TickerTape` and mount `useIndicesSocket`.
- `packages/frontend/src/components/AppHeader.tsx` — **deleted** (replaced by `shell/AppHeader.tsx`).
- `packages/frontend/src/components/AppFooter.tsx` — **deleted** (the ticker tape replaces it visually; the API Docs / Investopedia links move into the topbar's overflow menu — handled in step 11).

**Modified for the "About game" extraction:**
- `packages/frontend/src/pages/GameDetailPage.tsx` — replace inline `AboutThisGameCard` usage with a no-op marker for now. The `[i]` button in StatusStrip opens `AboutGameModal` which renders the same game-info content. The full GameDetailPage rewrite is phase 3 — this is the minimum touch needed so the `[i]` button works without leaving stale info on the page.

**Out of scope for phase 2** (deferred):
- `PUT /admin/system-settings/ticker-tape` admin route + audit log + frontend editor — **phase 4**.
- Game-detail arena layout rewrite (the three-pane grid) — **phase 3**.
- Games-list row-card redesign — **phase 5**.
- Login/Register split-layout redesign — **phase 5**.
- Symbol page restyle — **phase 3**.
- Removal of compatibility Tailwind aliases — happens organically as later phases touch each ShadCN consumer.

---

## Task 1: Shared types for system settings and live socket

**Files:**
- Create: `packages/shared/src/types/system-settings.ts`
- Modify: `packages/shared/src/types/websocket.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `system-settings.ts`**

```ts
/**
 * Persisted runtime configuration values that admins can change without a
 * redeploy. The only entry shipped in phase 2 is `ticker_tape_symbols`;
 * the table can hold additional keys in later phases without schema changes.
 */

/** Server-configured list of symbols scrolling in the bottom ticker tape. */
export interface TickerTapeSettings {
  symbols: string[];
  updatedAt: string;
}

/** Single tick on the indices/ticker channel. */
export interface IndexQuote {
  symbol: string;
  last: number;
  changeAbs: number;
  changePct: number;
  /** Optional full company / index name, used for tooltips. */
  name?: string;
}
```

- [ ] **Step 2: Add WS message types**

Open `packages/shared/src/types/websocket.ts` and append at the end:

```ts
import type { IndexQuote } from './system-settings.js';

/**
 * Pushed by the server every 5 seconds on the global `/ws/live` socket with
 * fresh quotes for major indices (^GSPC/^IXIC/^DJI) plus all configured
 * ticker-tape symbols. `unavailable: true` means the active provider could
 * not fetch indices (e.g. Alpaca) — UI should render an explicit indicator.
 */
export interface WsIndicesEvent {
  event: 'indices';
  data: {
    quotes: IndexQuote[];
    at: string;
    unavailable?: boolean;
  };
}

/** Pushed on the global socket when an admin changes the ticker-tape symbol list. */
export interface WsTickerTapeConfigChangedEvent {
  event: 'ticker_tape_config_changed';
  data: {
    symbols: string[];
    at: string;
  };
}

/** Union of every message that can be sent on the global `/ws/live` socket. */
export type LiveWsMessage = WsIndicesEvent | WsTickerTapeConfigChangedEvent;
```

- [ ] **Step 3: Re-export from the package index**

Open `packages/shared/src/index.ts`. Add the line `export * from './types/system-settings.js';` (placement: between `./types/stock.js` and `./types/watchlist.js`, alphabetical-ish).

- [ ] **Step 4: Verify**

```bash
pnpm --filter @markettrader/shared typecheck
pnpm typecheck
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/system-settings.ts packages/shared/src/types/websocket.ts packages/shared/src/index.ts
git commit -m "feat(shared): add TickerTapeSettings, IndexQuote, LiveWsMessage types

Shared contract for the new global /ws/live socket and the
ticker-tape configuration endpoint. Consumed by server and frontend
in the same phase."
```

---

## Task 2: `system_settings` table — schema + migration

**Files:**
- Modify: `packages/server/src/db/schema.sqlite.ts`
- Modify: `packages/server/src/db/schema.pg.ts`
- Created automatically: `packages/server/drizzle/sqlite/00XX_*.sql`, `packages/server/drizzle/pg/00XX_*.sql`

- [ ] **Step 1: Add the SQLite table**

Open `packages/server/src/db/schema.sqlite.ts`. Append the following at the end of the file (before any closing `export` if there is one):

```ts
/**
 * Server-managed runtime configuration. Keys are stable strings; values are
 * JSON-encoded strings (SQLite has no native JSON type — `text`/`jsonb` is
 * the Postgres counterpart). Phase 2 ships exactly one key:
 * `ticker_tape_symbols`. Admin editing arrives in phase 4.
 */
export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at')
    .default(sql`(datetime('now'))`)
    .notNull(),
  /** User id of the most recent writer; null when seeded by the server. */
  updatedBy: text('updated_by'),
});
```

- [ ] **Step 2: Add the Postgres table**

Open `packages/server/src/db/schema.pg.ts`. Append:

```ts
/**
 * Server-managed runtime configuration. Mirrors the SQLite variant; uses
 * native `jsonb` for the value column.
 */
export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedBy: text('updated_by'),
});
```

Note: we deliberately use `text` for value in both dialects (not `jsonb` in Postgres). The Drizzle layer encodes/decodes JSON in the service; this keeps the dialects symmetric and the migration trivial.

- [ ] **Step 3: Re-export the table**

Open `packages/server/src/db/index.ts`. The file exposes `schema` as a namespace. Make sure `systemSettings` appears in the schema export.

(Reading the file first will tell you whether you need to add `systemSettings` to a barrel object or whether `export * from` already covers it. If it's already covered, skip this step.)

- [ ] **Step 4: Generate the migrations**

```bash
pnpm --filter @markettrader/server db:generate
```

Two new files appear: `packages/server/drizzle/sqlite/00XX_<random>.sql` and `packages/server/drizzle/pg/00XX_<random>.sql`. Inspect both and confirm they only add the `system_settings` table (no incidental drops).

If the SQL is sane, continue. If anything looks off (extra DROP TABLE, unexpected indexes), STOP and report BLOCKED.

- [ ] **Step 5: Apply locally and verify the table exists**

```bash
DATABASE_URL=./dev.db pnpm --filter @markettrader/server db:migrate
sqlite3 packages/server/dev.db '.schema system_settings'
```

Expected: schema dump prints the `system_settings` table with four columns.

- [ ] **Step 6: Typecheck + test**

```bash
pnpm typecheck
pnpm --filter @markettrader/server test
```

Expected: both PASS. Tests don't reference `system_settings` yet, so existing tests should be unaffected.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/db/schema.sqlite.ts packages/server/src/db/schema.pg.ts packages/server/src/db/index.ts packages/server/drizzle/sqlite/ packages/server/drizzle/pg/
git commit -m "feat(server): add system_settings table

Server-managed runtime configuration table for keys like
ticker_tape_symbols. JSON-encoded values stored as text in both
dialects. Phase 4 adds admin editing; phase 2 only seeds + reads."
```

---

## Task 3: `SystemSettingsService` — TDD

**Files:**
- Create: `packages/server/src/services/system-settings.ts`
- Create: `packages/server/tests/system-settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/system-settings.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SystemSettingsService } from '@/services/system-settings.js';
import type { Db } from '@/db/index.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));

async function makeDb(): Promise<Db> {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  await migrate(db, {
    migrationsFolder: path.resolve(__dir, '..', 'drizzle', 'sqlite'),
  });
  return db as unknown as Db;
}

describe('SystemSettingsService', () => {
  let db: Db;
  let svc: SystemSettingsService;

  beforeEach(async () => {
    db = await makeDb();
    svc = new SystemSettingsService(db);
  });

  it('returns null when key is missing', async () => {
    expect(await svc.getTickerTapeSymbols()).toBeNull();
  });

  it('seeds the default tape on first call to ensureSeeded', async () => {
    await svc.ensureSeeded();
    const tape = await svc.getTickerTapeSymbols();
    expect(tape).not.toBeNull();
    expect(tape!.symbols).toContain('^GSPC');
    expect(tape!.symbols).toContain('AAPL');
    expect(tape!.symbols.length).toBeGreaterThanOrEqual(8);
  });

  it('ensureSeeded is idempotent — does not overwrite existing config', async () => {
    await svc.setTickerTapeSymbols(['CUSTOM'], 'user-1');
    await svc.ensureSeeded();
    const tape = await svc.getTickerTapeSymbols();
    expect(tape!.symbols).toEqual(['CUSTOM']);
  });

  it('persists symbols and updatedBy on setTickerTapeSymbols', async () => {
    await svc.setTickerTapeSymbols(['AAPL', 'NVDA'], 'admin-42');
    const tape = await svc.getTickerTapeSymbols();
    expect(tape!.symbols).toEqual(['AAPL', 'NVDA']);
    expect(tape!.updatedAt).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('uppercases and trims symbols on write', async () => {
    await svc.setTickerTapeSymbols(['  aapl ', 'msft'], 'user');
    const tape = await svc.getTickerTapeSymbols();
    expect(tape!.symbols).toEqual(['AAPL', 'MSFT']);
  });

  it('rejects an empty list', async () => {
    await expect(svc.setTickerTapeSymbols([], 'user')).rejects.toThrow(/empty/i);
  });

  it('emits a change event after a write', async () => {
    const events: string[][] = [];
    svc.on('change', (symbols) => events.push(symbols));
    await svc.setTickerTapeSymbols(['AAPL'], 'user');
    await svc.setTickerTapeSymbols(['MSFT'], 'user');
    expect(events).toEqual([['AAPL'], ['MSFT']]);
  });
});
```

- [ ] **Step 2: Run the test, verify FAIL**

```bash
pnpm --filter @markettrader/server test -- system-settings.test
```

Expected: FAIL with "Cannot find module '@/services/system-settings.js'".

- [ ] **Step 3: Implement the service**

Create `packages/server/src/services/system-settings.ts`:

```ts
import { EventEmitter } from 'node:events';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { TickerTapeSettings } from '@markettrader/shared';

const KEY_TICKER_TAPE = 'ticker_tape_symbols' as const;

/** The default tape seeded on first boot. Mixed indices + major stocks. */
export const DEFAULT_TICKER_TAPE_SYMBOLS = [
  '^GSPC',
  '^IXIC',
  '^DJI',
  'AAPL',
  'MSFT',
  'NVDA',
  'TSLA',
  'AMZN',
  'META',
  'GOOGL',
] as const;

interface PersistedTape {
  symbols: string[];
}

/**
 * Manages runtime configuration persisted in {@link schema.systemSettings}.
 * Phase 2 only exposes the ticker-tape key; the service is structured so
 * additional keys (admin-broadcast banners, feature flags) can be added in
 * later phases without rewriting the API.
 *
 * Emits a `'change'` event with the new symbol array after every successful
 * `setTickerTapeSymbols` call. Consumed by `indicesBroadcaster` to refresh
 * its subscription set without polling.
 */
export class SystemSettingsService extends EventEmitter {
  constructor(private readonly db: Db) {
    super();
  }

  /** Returns the current ticker-tape config, or `null` if it has not been seeded. */
  async getTickerTapeSymbols(): Promise<TickerTapeSettings | null> {
    const [row] = await this.db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, KEY_TICKER_TAPE))
      .limit(1);

    if (!row) return null;

    const parsed = JSON.parse(row.value) as PersistedTape;
    return {
      symbols: parsed.symbols,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Inserts the default tape if and only if no row exists for the key.
   * Called once at server boot. Subsequent admin edits won't be overwritten.
   */
  async ensureSeeded(): Promise<void> {
    const existing = await this.getTickerTapeSymbols();
    if (existing) return;

    await this.db.insert(schema.systemSettings).values({
      key: KEY_TICKER_TAPE,
      value: JSON.stringify({ symbols: [...DEFAULT_TICKER_TAPE_SYMBOLS] }),
      updatedBy: null,
    });
    this.emit('change', [...DEFAULT_TICKER_TAPE_SYMBOLS]);
  }

  /**
   * Replaces the persisted ticker-tape symbol list. Symbols are uppercased
   * and trimmed. Throws on empty input. Caller is responsible for validating
   * each symbol exists upstream — the service is dialect-agnostic.
   */
  async setTickerTapeSymbols(symbols: string[], actorId: string | null): Promise<void> {
    const normalized = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (normalized.length === 0) {
      throw new Error('ticker_tape_symbols cannot be empty');
    }

    const value = JSON.stringify({ symbols: normalized });
    const now = new Date().toISOString();

    await this.db
      .insert(schema.systemSettings)
      .values({ key: KEY_TICKER_TAPE, value, updatedAt: now, updatedBy: actorId })
      .onConflictDoUpdate({
        target: schema.systemSettings.key,
        set: { value, updatedAt: now, updatedBy: actorId },
      });

    this.emit('change', normalized);
  }
}
```

- [ ] **Step 4: Run the test, verify PASS**

```bash
pnpm --filter @markettrader/server test -- system-settings.test
```

Expected: 7 tests pass.

- [ ] **Step 5: Typecheck + lint**

```bash
pnpm --filter @markettrader/server typecheck
pnpm --filter @markettrader/server lint
```

Both PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/system-settings.ts packages/server/tests/system-settings.test.ts
git commit -m "feat(server): add SystemSettingsService with ticker-tape seed

Service exposes get / ensureSeeded / setTickerTapeSymbols and emits a
'change' event after each write. Default tape is seeded once at boot
and never overwritten; admin edits in a later phase persist normally."
```

---

## Task 4: `GET /system-settings/ticker-tape` route — TDD

**Files:**
- Create: `packages/server/src/routes/system-settings.ts`
- Create: `packages/server/tests/system-settings-route.test.ts`
- Modify: `packages/server/src/app.ts` (register the route + invoke seed at boot)

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/system-settings-route.test.ts`:

```ts
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/build-test-app.js';

describe('GET /system-settings/ticker-tape', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    ({ app, token } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the seeded default tape for any authenticated user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/system-settings/ticker-tape',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.symbols)).toBe(true);
    expect(body.symbols).toContain('^GSPC');
    expect(body.symbols).toContain('AAPL');
    expect(body.updatedAt).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/system-settings/ticker-tape' });
    expect(res.statusCode).toBe(401);
  });
});
```

(If `tests/helpers/build-test-app.ts` doesn't already exist or doesn't expose a tape-seeded app, you may need to add a small wrapper. Read the existing test setup in `packages/server/tests/` first — there's almost certainly a shared helper that builds the app + a seeded admin user already. If you can't find one and have to introduce a new test-helper file, do it in a separate commit before this one.)

- [ ] **Step 2: Run the test, verify FAIL**

```bash
pnpm --filter @markettrader/server test -- system-settings-route
```

Expected: FAIL — route doesn't exist yet (or "Cannot find module" if you're not using a shared helper).

- [ ] **Step 3: Implement the route**

Create `packages/server/src/routes/system-settings.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { SystemSettingsService } from '../services/system-settings.js';
import type { TickerTapeSettings } from '@markettrader/shared';

/**
 * Public-authenticated read-only route for runtime configuration. Phase 2
 * exposes the ticker-tape symbol list so the frontend can render the
 * scrolling tape; admin write routes arrive in phase 4.
 */
export function systemSettingsRoutes(svc: SystemSettingsService) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get<{ Reply: TickerTapeSettings | { error: string } }>(
      '/system-settings/ticker-tape',
      { preHandler: [app.authenticate] },
      async (_req, reply) => {
        const tape = await svc.getTickerTapeSymbols();
        if (!tape) {
          // Defensive: ensureSeeded runs at boot so this should never happen.
          return reply.code(500).send({ error: 'ticker tape not seeded' });
        }
        return reply.send(tape);
      },
    );
  };
}
```

(`app.authenticate` is the existing JWT pre-handler used by every other authed route. Confirm its name by grepping for it in `packages/server/src/routes/games.ts` or similar.)

- [ ] **Step 4: Wire in `app.ts`**

Open `packages/server/src/app.ts`. Three additions:

1. Import:
```ts
import { SystemSettingsService } from './services/system-settings.js';
import { systemSettingsRoutes } from './routes/system-settings.js';
```

2. After `const registry = new GameClientRegistry();`, instantiate the service and seed:
```ts
const systemSettings = new SystemSettingsService(db);
await systemSettings.ensureSeeded();
```

3. After the other `app.register(...)` calls, register the route:
```ts
await app.register(systemSettingsRoutes(systemSettings));
```

Also export `systemSettings` from `buildApp` so tests can introspect it (return it alongside `app` from the function's return value — or attach it to a fastify `decorate` if that fits the existing pattern). Read `app.ts` to see how other singletons are exposed; mirror that.

- [ ] **Step 5: Run the test, verify PASS**

```bash
pnpm --filter @markettrader/server test -- system-settings-route
```

Expected: 2 tests pass.

- [ ] **Step 6: Run the full server suite**

```bash
pnpm --filter @markettrader/server test
```

Expected: PASS. The boot seed shouldn't break any existing test.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/system-settings.ts packages/server/tests/system-settings-route.test.ts packages/server/src/app.ts
git commit -m "feat(server): GET /system-settings/ticker-tape

Public-authenticated read-only endpoint that returns the configured
ticker-tape symbol list. Service is seeded once at app boot."
```

---

## Task 5: `GlobalClientRegistry` for the new socket

**Files:**
- Create: `packages/server/src/ws/global-registry.ts`
- Create: `packages/server/tests/global-registry.test.ts`

The per-game `GameClientRegistry` doesn't fit because the global socket has no game scope — every authed user can connect once and receive every indices/tape broadcast. Modeling it as a separate registry keeps the two concerns isolated.

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/global-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GlobalClientRegistry } from '@/ws/global-registry.js';

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  send(payload: string) {
    this.sent.push(payload);
  }
}

describe('GlobalClientRegistry', () => {
  let registry: GlobalClientRegistry;

  beforeEach(() => {
    registry = new GlobalClientRegistry();
  });

  it('adds and removes clients', () => {
    const s = new FakeSocket();
    registry.add('user-1', s as unknown as WebSocket);
    expect(registry.size).toBe(1);
    registry.remove(s as unknown as WebSocket);
    expect(registry.size).toBe(0);
  });

  it('broadcasts to every open socket', () => {
    const a = new FakeSocket();
    const b = new FakeSocket();
    registry.add('u1', a as unknown as WebSocket);
    registry.add('u2', b as unknown as WebSocket);
    registry.broadcast({ event: 'indices', data: { quotes: [], at: 'now' } });
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
    expect(JSON.parse(a.sent[0])).toMatchObject({ event: 'indices' });
  });

  it('skips sockets that are not OPEN', () => {
    const a = new FakeSocket();
    a.readyState = 2; // CLOSING
    registry.add('u1', a as unknown as WebSocket);
    registry.broadcast({ event: 'indices', data: { quotes: [], at: 'now' } });
    expect(a.sent).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/server test -- global-registry
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/server/src/ws/global-registry.ts`:

```ts
import type { WebSocket } from 'ws';
import type { LiveWsMessage } from '@markettrader/shared';

interface ClientEntry {
  userId: string;
}

/**
 * Per-app-instance registry of clients connected to the global `/ws/live`
 * socket. Unlike {@link GameClientRegistry}, there's no per-game scope —
 * every connected client receives every broadcast.
 */
export class GlobalClientRegistry {
  private readonly clients = new Map<WebSocket, ClientEntry>();

  get size(): number {
    return this.clients.size;
  }

  add(userId: string, socket: WebSocket): void {
    this.clients.set(socket, { userId });
  }

  remove(socket: WebSocket): void {
    this.clients.delete(socket);
  }

  broadcast(message: LiveWsMessage): void {
    const payload = JSON.stringify(message);
    for (const [socket] of this.clients) {
      if (socket.readyState === 1 /* OPEN */) {
        try {
          socket.send(payload);
        } catch {
          // socket closed between check and send — fine
        }
      }
    }
  }
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/server test -- global-registry
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws/global-registry.ts packages/server/tests/global-registry.test.ts
git commit -m "feat(server): GlobalClientRegistry for /ws/live socket

Separate from the per-game registry — broadcasts indices and
ticker-tape config changes to every connected client regardless of
game membership."
```

---

## Task 6: `indicesBroadcaster` — TDD

**Files:**
- Create: `packages/server/src/ws/indices-broadcaster.ts`
- Create: `packages/server/tests/indices-broadcaster.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/indices-broadcaster.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GlobalClientRegistry } from '@/ws/global-registry.js';
import { IndicesBroadcaster } from '@/ws/indices-broadcaster.js';
import type { StockProvider } from '@/providers/index.js';
import type { SystemSettingsService } from '@/services/system-settings.js';
import { EventEmitter } from 'node:events';

class FakeProvider implements Pick<StockProvider, 'getQuote'> {
  calls: string[] = [];
  failFor = new Set<string>();
  async getQuote(symbol: string) {
    this.calls.push(symbol);
    if (this.failFor.has(symbol)) {
      throw new Error('symbol not supported');
    }
    return {
      symbol,
      price: 100,
      previousClose: 99,
      change: 1,
      changePercent: 1.01,
      currency: 'USD',
      shortName: symbol,
      marketState: 'REGULAR',
      asOf: new Date().toISOString(),
    };
  }
}

class FakeSettings extends EventEmitter {
  symbols = ['AAPL', '^GSPC'];
  async getTickerTapeSymbols() {
    return { symbols: this.symbols, updatedAt: 'now' };
  }
}

describe('IndicesBroadcaster', () => {
  let registry: GlobalClientRegistry;
  let provider: FakeProvider;
  let settings: FakeSettings;
  let broadcaster: IndicesBroadcaster;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new GlobalClientRegistry();
    provider = new FakeProvider();
    settings = new FakeSettings();
    broadcaster = new IndicesBroadcaster(
      provider as unknown as StockProvider,
      settings as unknown as SystemSettingsService,
      registry,
      { intervalMs: 5000 },
    );
  });

  afterEach(() => {
    broadcaster.stop();
    vi.useRealTimers();
  });

  it('subscribes to the union of major indices and configured tape symbols', async () => {
    await broadcaster.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(provider.calls.sort()).toEqual(['AAPL', '^DJI', '^GSPC', '^IXIC'].sort());
  });

  it('broadcasts an indices event each tick', async () => {
    const spy = vi.spyOn(registry, 'broadcast');
    await broadcaster.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0] as { event: string; data: { quotes: unknown[] } };
    expect(arg.event).toBe('indices');
    expect(arg.data.quotes.length).toBe(4);
  });

  it('re-fetches the tape symbol set when settings emits change', async () => {
    await broadcaster.start();
    settings.symbols = ['MSFT'];
    settings.emit('change', ['MSFT']);
    provider.calls = [];
    await vi.advanceTimersByTimeAsync(5000);
    expect(provider.calls.sort()).toEqual(['MSFT', '^DJI', '^GSPC', '^IXIC'].sort());
  });

  it('emits an unavailable: true payload when all index fetches fail', async () => {
    provider.failFor = new Set(['^GSPC', '^IXIC', '^DJI']);
    const spy = vi.spyOn(registry, 'broadcast');
    await broadcaster.start();
    await vi.advanceTimersByTimeAsync(5000);
    const arg = spy.mock.calls[0][0] as { data: { unavailable?: boolean } };
    expect(arg.data.unavailable).toBe(true);
  });

  it('stop() halts the tick loop', async () => {
    await broadcaster.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(provider.calls.length).toBeGreaterThan(0);
    broadcaster.stop();
    provider.calls = [];
    await vi.advanceTimersByTimeAsync(15000);
    expect(provider.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/server test -- indices-broadcaster
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/server/src/ws/indices-broadcaster.ts`:

```ts
import type { StockProvider } from '../providers/index.js';
import type { SystemSettingsService } from '../services/system-settings.js';
import type { GlobalClientRegistry } from './global-registry.js';
import type { IndexQuote, LiveWsMessage } from '@markettrader/shared';

const MAJOR_INDICES = ['^GSPC', '^IXIC', '^DJI'] as const;

export interface IndicesBroadcasterOptions {
  intervalMs?: number;
}

/**
 * Polls the active {@link StockProvider} for major indices and the
 * configured ticker-tape symbols, then broadcasts the batched results to
 * every connected `/ws/live` client. Runs independently of game state.
 *
 * Re-reads the symbol list when {@link SystemSettingsService} emits a
 * `'change'` event, so admin edits propagate without a restart.
 */
export class IndicesBroadcaster {
  private symbols: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly intervalMs: number;
  private readonly onSettingsChange = (newSymbols: string[]) => {
    this.symbols = mergeSymbols(MAJOR_INDICES, newSymbols);
  };

  constructor(
    private readonly provider: StockProvider,
    private readonly settings: SystemSettingsService,
    private readonly registry: GlobalClientRegistry,
    options: IndicesBroadcasterOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 5000;
  }

  async start(): Promise<void> {
    const tape = await this.settings.getTickerTapeSymbols();
    const tapeSymbols = tape?.symbols ?? [];
    this.symbols = mergeSymbols(MAJOR_INDICES, tapeSymbols);
    this.settings.on('change', this.onSettingsChange);
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.settings.off('change', this.onSettingsChange);
  }

  private async tick(): Promise<void> {
    const quotes: IndexQuote[] = [];
    let indexFailures = 0;
    await Promise.all(
      this.symbols.map(async (symbol) => {
        try {
          const q = await this.provider.getQuote(symbol);
          quotes.push({
            symbol,
            last: q.price,
            changeAbs: q.change,
            changePct: q.changePercent,
            name: q.shortName,
          });
        } catch {
          if ((MAJOR_INDICES as readonly string[]).includes(symbol)) {
            indexFailures += 1;
          }
        }
      }),
    );

    const unavailable = indexFailures === MAJOR_INDICES.length;
    const message: LiveWsMessage = {
      event: 'indices',
      data: {
        quotes,
        at: new Date().toISOString(),
        ...(unavailable ? { unavailable: true } : {}),
      },
    };
    this.registry.broadcast(message);
  }
}

function mergeSymbols(...lists: ReadonlyArray<readonly string[]>): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const s of list) {
      if (!out.includes(s)) out.push(s);
    }
  }
  return out;
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/server test -- indices-broadcaster
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws/indices-broadcaster.ts packages/server/tests/indices-broadcaster.test.ts
git commit -m "feat(server): IndicesBroadcaster for global /ws/live socket

Polls the StockProvider every 5s for major indices + configured
ticker-tape symbols and broadcasts batched quotes to every connected
client. Refreshes its subscription set when SystemSettingsService
emits a change event. Marks the payload unavailable when all major
index fetches fail (e.g. provider doesn't support index symbols)."
```

---

## Task 7: `/ws/live` global socket route

**Files:**
- Create: `packages/server/src/ws/global-live-route.ts`
- Create: `packages/server/tests/global-live-route.test.ts`
- Modify: `packages/server/src/app.ts` (register socket + start broadcaster)

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/global-live-route.test.ts`:

```ts
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/build-test-app.js';
import type { AddressInfo } from 'node:net';

describe('GET /ws/live', () => {
  let app: FastifyInstance;
  let token: string;
  let url: string;

  beforeAll(async () => {
    ({ app, token } = await buildTestApp());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address() as AddressInfo;
    url = `ws://127.0.0.1:${addr.port}/ws/live`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects connections without a token (close 1008)', async () => {
    const ws = new WebSocket(url);
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (c) => resolve(c));
    });
    expect(code).toBe(1008);
  });

  it('rejects connections with an invalid token (close 1008)', async () => {
    const ws = new WebSocket(`${url}?token=garbage`);
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (c) => resolve(c));
    });
    expect(code).toBe(1008);
  });

  it('accepts a valid token and stays open', async () => {
    const ws = new WebSocket(`${url}?token=${token}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/server test -- global-live-route
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement the route**

Create `packages/server/src/ws/global-live-route.ts`:

```ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { GlobalClientRegistry } from './global-registry.js';

/**
 * Registers `/ws/live` — a global authenticated socket used for app-wide
 * chrome data (indices, ticker-tape config). Distinct from
 * `/games/:id/live` which is game-scoped.
 *
 * Auth: JWT in `?token=` query param, same shape as the per-game socket.
 */
export function globalLiveRoute(registry: GlobalClientRegistry) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get<{ Querystring: { token?: string } }>(
      '/ws/live',
      { websocket: true, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (socket, request: FastifyRequest<{ Querystring: { token?: string } }>) => {
        const { token } = request.query;
        if (!token) {
          socket.close(1008, 'Missing token');
          return;
        }
        let payload: { id: string; username: string };
        try {
          payload = app.jwt.verify<{ id: string; username: string }>(token);
        } catch {
          socket.close(1008, 'Invalid token');
          return;
        }
        registry.add(payload.id, socket);
        const cleanup = () => registry.remove(socket);
        socket.on('close', cleanup);
        socket.on('error', cleanup);
      },
    );
  };
}
```

- [ ] **Step 4: Wire in `app.ts`**

Add to `packages/server/src/app.ts`:

```ts
import { GlobalClientRegistry } from './ws/global-registry.js';
import { globalLiveRoute } from './ws/global-live-route.js';
import { IndicesBroadcaster } from './ws/indices-broadcaster.js';
```

After the game registry instantiation:

```ts
const globalRegistry = new GlobalClientRegistry();
const indicesBroadcaster = new IndicesBroadcaster(provider, systemSettings, globalRegistry);
if (!disablePoller) {
  await indicesBroadcaster.start();
}
```

After other route registrations:

```ts
await app.register(globalLiveRoute(globalRegistry));
```

Make sure the broadcaster is stopped when the Fastify app closes:

```ts
app.addHook('onClose', async () => {
  indicesBroadcaster.stop();
});
```

- [ ] **Step 5: Verify PASS**

```bash
pnpm --filter @markettrader/server test -- global-live-route
```

Expected: 3 tests pass.

- [ ] **Step 6: Full server suite**

```bash
pnpm --filter @markettrader/server test
```

Expected: PASS. No regressions in existing socket / route tests.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/ws/global-live-route.ts packages/server/tests/global-live-route.test.ts packages/server/src/app.ts
git commit -m "feat(server): /ws/live global socket + broadcaster wiring

Authenticated global WebSocket for app-wide chrome data, distinct
from per-game /games/:id/live. Starts the IndicesBroadcaster at boot
and stops it cleanly on app close."
```

---

## Task 8: Frontend — system settings API client + types

**Files:**
- Create: `packages/frontend/src/api/systemSettings.ts`

- [ ] **Step 1: Read an existing API client for style**

Skim `packages/frontend/src/api/auth.ts` and `games.ts` so the new file matches conventions (React Query keys, fetch helpers, error handling).

- [ ] **Step 2: Implement**

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { TickerTapeSettings } from '@markettrader/shared';

const KEY_TAPE = ['system-settings', 'ticker-tape'] as const;

/** React Query hook around `GET /system-settings/ticker-tape`. */
export function useTickerTapeSettings() {
  return useQuery({
    queryKey: KEY_TAPE,
    queryFn: () => api.get<TickerTapeSettings>('/system-settings/ticker-tape'),
    staleTime: Infinity, // updated live via WS; no need to re-fetch
  });
}

export const TICKER_TAPE_QUERY_KEY = KEY_TAPE;
```

(If `api.get` doesn't exist, mirror the pattern used in `games.ts`. Read it first.)

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @markettrader/frontend typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/api/systemSettings.ts
git commit -m "feat(frontend): API client for ticker-tape settings

React Query hook around GET /system-settings/ticker-tape with
staleTime=Infinity since updates come via WS."
```

---

## Task 9: Frontend — `useLiveClock` hook

**Files:**
- Create: `packages/frontend/src/hooks/useLiveClock.ts`
- Create: `packages/frontend/tests/useLiveClock.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLiveClock } from '@/hooks/useLiveClock';

describe('useLiveClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T14:23:08-04:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current ET time as HH:MM:SS', () => {
    const { result } = renderHook(() => useLiveClock());
    expect(result.current).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('updates every second', () => {
    const { result } = renderHook(() => useLiveClock());
    const before = result.current;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).not.toBe(before);
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- useLiveClock
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/frontend/src/hooks/useLiveClock.ts`:

```ts
import { useEffect, useState } from 'react';

const ET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'America/New_York',
});

/**
 * Returns the current Eastern Time as `HH:MM:SS`, updating once per second.
 * Used by the status strip's ticking clock.
 */
export function useLiveClock(): string {
  const [now, setNow] = useState(() => ET_FORMATTER.format(new Date()));
  useEffect(() => {
    const id = setInterval(() => setNow(ET_FORMATTER.format(new Date())), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- useLiveClock
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/useLiveClock.ts packages/frontend/tests/useLiveClock.test.tsx
git commit -m "feat(frontend): useLiveClock hook for ticking ET clock

Returns the current Eastern Time as HH:MM:SS and re-renders every
second. Consumed by StatusStrip."
```

---

## Task 10: Frontend — `useIndicesSocket` hook

**Files:**
- Create: `packages/frontend/src/hooks/useIndicesSocket.ts`

The hook is small but interacts with three things: the auth store (for the JWT), the React Query cache (writes `['indices']` and invalidates `['system-settings','ticker-tape']` on config change), and the WebSocket lifecycle. Test coverage comes from the `StatusStrip` and `TickerTape` tests below (Task 11/12), which feed mocked socket messages — testing this hook in isolation would essentially mock the entire WebSocket API. Skip an isolated unit test and rely on the component tests that consume it.

- [ ] **Step 1: Implement**

```ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import type { IndexQuote, LiveWsMessage } from '@markettrader/shared';
import { TICKER_TAPE_QUERY_KEY } from '@/api/systemSettings';

export const INDICES_QUERY_KEY = ['indices'] as const;

/**
 * Subscribes to `/ws/live` for app-wide chrome data (indices + ticker-tape
 * config changes). Writes `IndexQuote[]` into the React Query cache keyed
 * `['indices']` and invalidates the ticker-tape query when its config changes.
 *
 * Mounted once at AppShell level. The hook handles reconnection with a
 * fixed 5s backoff on close/error.
 */
export function useIndicesSocket(): void {
  const token = useAuthStore((s) => s.token);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!token) return;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/api/ws/live?token=${encodeURIComponent(token)}`;
      socket = new WebSocket(url);
      socket.onmessage = (e) => {
        let msg: LiveWsMessage;
        try {
          msg = JSON.parse(e.data) as LiveWsMessage;
        } catch {
          return;
        }
        if (msg.event === 'indices') {
          queryClient.setQueryData<IndexQuote[]>(INDICES_QUERY_KEY, msg.data.quotes);
        } else if (msg.event === 'ticker_tape_config_changed') {
          queryClient.invalidateQueries({ queryKey: TICKER_TAPE_QUERY_KEY });
        }
      };
      const reschedule = () => {
        if (stopped) return;
        if (reconnectTimer) window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, 5000);
      };
      socket.onclose = reschedule;
      socket.onerror = reschedule;
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [token, queryClient]);
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @markettrader/frontend typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/useIndicesSocket.ts
git commit -m "feat(frontend): useIndicesSocket — global WS subscription

Mounted once at AppShell. Routes indices messages into React Query
cache ['indices'] and invalidates the ticker-tape cache when config
changes. Reconnects with 5s backoff on close/error."
```

---

## Task 11: Frontend — `StatusStrip` component + test

**Files:**
- Create: `packages/frontend/src/components/shell/StatusStrip.tsx`
- Create: `packages/frontend/src/components/shell/AboutGameModal.tsx`
- Create: `packages/frontend/src/components/shell/index.ts`
- Create: `packages/frontend/tests/StatusStrip.test.tsx`

- [ ] **Step 1: Read existing `AboutThisGameCard` to know what content to surface**

```bash
cat packages/frontend/src/components/game/AboutThisGameCard.tsx
```

We're going to reuse most of its data fetching and JSX inside `AboutGameModal`. The existing card stays on the game-detail page for now (phase 3 deletes it); the modal is a parallel rendering path triggered from the `[i]` button.

- [ ] **Step 2: Write the failing test**

Create `packages/frontend/tests/StatusStrip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { StatusStrip } from '@/components/shell/StatusStrip';
import { INDICES_QUERY_KEY } from '@/hooks/useIndicesSocket';
import type { IndexQuote } from '@markettrader/shared';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ui: (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )};
}

describe('StatusStrip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T14:23:08-04:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('renders MARKET OPEN/CLOSED indicator, ticking ET clock, and a LIVE pill', () => {
    const { ui } = wrap(<StatusStrip />);
    render(ui);
    expect(screen.getByText(/MARKET (OPEN|CLOSED)/)).toBeInTheDocument();
    expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('renders index quotes from the React Query cache', () => {
    const { qc, ui } = wrap(<StatusStrip />);
    qc.setQueryData<IndexQuote[]>(INDICES_QUERY_KEY, [
      { symbol: '^GSPC', last: 5284.12, changeAbs: 16.83, changePct: 0.32 },
      { symbol: '^IXIC', last: 16742.39, changeAbs: 84.7, changePct: 0.51 },
      { symbol: '^DJI', last: 39118.86, changeAbs: -31.5, changePct: -0.08 },
    ]);
    render(ui);
    expect(screen.getByText('^GSPC')).toBeInTheDocument();
    expect(screen.getByText('5,284.12')).toBeInTheDocument();
    expect(screen.getByText('+0.32%')).toBeInTheDocument();
    expect(screen.getByText('−0.08%')).toBeInTheDocument(); // unicode minus
  });

  it('renders INDICES UNAVAILABLE when the cache holds an unavailable payload', () => {
    const { qc, ui } = wrap(<StatusStrip />);
    qc.setQueryData(INDICES_QUERY_KEY, []);
    qc.setQueryData(['indices-unavailable'], true);
    render(ui);
    expect(screen.getByText(/INDICES UNAVAILABLE/i)).toBeInTheDocument();
  });

  it('shows DAY n / N + game name when given gameContext', () => {
    const { ui } = wrap(
      <StatusStrip gameContext={{ name: 'Friday Night', dayCurrent: 4, dayTotal: 14, gameId: 'g1' }} />,
    );
    render(ui);
    expect(screen.getByText(/DAY 4 \/ 14/)).toBeInTheDocument();
    expect(screen.getByText(/Friday Night/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- StatusStrip
```

Expected: FAIL — `@/components/shell/StatusStrip` doesn't exist.

- [ ] **Step 4: Implement `StatusStrip`**

Create `packages/frontend/src/components/shell/StatusStrip.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useLiveClock } from '@/hooks/useLiveClock';
import { INDICES_QUERY_KEY } from '@/hooks/useIndicesSocket';
import { AboutGameModal } from './AboutGameModal';
import { useMarketStatus } from '@/api/marketStatus';
import type { IndexQuote } from '@markettrader/shared';
import { cn } from '@/lib/utils';

export interface StatusStripGameContext {
  gameId: string;
  name: string;
  dayCurrent: number;
  dayTotal: number;
}

export interface StatusStripProps {
  /** When provided, the right cluster shows DAY n/N + name + info button. */
  gameContext?: StatusStripGameContext;
}

/**
 * Second row of global chrome. Left: market-open pulse dot, ticking ET clock,
 * LIVE pill, three major index quotes. Right (only inside a game): the
 * DAY n/N marker and an info button that opens {@link AboutGameModal}.
 */
export function StatusStrip({ gameContext }: StatusStripProps) {
  const clock = useLiveClock();
  const marketStatus = useMarketStatus();
  const indices = useQuery<IndexQuote[]>({
    queryKey: INDICES_QUERY_KEY,
    enabled: false,
    initialData: [],
  });
  const unavailable = useQuery<boolean>({
    queryKey: ['indices-unavailable'],
    enabled: false,
    initialData: false,
  });

  const isOpen = marketStatus.data?.isOpen ?? true;
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <div className="flex items-center justify-between border-b border-hairline-strong bg-bg/95 px-4 py-1 text-[11px] font-mono text-muted tracking-[0.04em]">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              isOpen
                ? 'bg-accent shadow-[0_0_6px_var(--accent)] animate-pulse-dot'
                : 'bg-muted',
            )}
            aria-hidden
          />
          MARKET {isOpen ? 'OPEN' : 'CLOSED'}
        </span>
        <span>{clock} ET</span>
        <span className="rounded-chip bg-accent-bg px-2 py-0.5 text-[10px] tracking-[0.14em] text-accent">
          LIVE
        </span>
        {unavailable.data ? (
          <span className="text-loss">INDICES UNAVAILABLE</span>
        ) : (
          indices.data?.map((q) => (
            <span key={q.symbol} className="flex items-baseline gap-1">
              <span className="text-text">{q.symbol}</span>
              <span>{formatLast(q.last)}</span>
              <span className={q.changePct >= 0 ? 'text-gain' : 'text-loss'}>
                {formatPct(q.changePct)}
              </span>
            </span>
          ))
        )}
      </div>
      {gameContext ? (
        <div className="flex items-center gap-2">
          <span>
            DAY {gameContext.dayCurrent} / {gameContext.dayTotal} · {gameContext.name}
          </span>
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            className="text-muted hover:text-text"
            aria-label="Game info"
          >
            <Info className="h-3 w-3" />
          </button>
          <AboutGameModal
            gameId={gameContext.gameId}
            open={aboutOpen}
            onOpenChange={setAboutOpen}
          />
        </div>
      ) : null}
    </div>
  );
}

function formatLast(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}
function formatPct(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
```

(Confirm `useMarketStatus` exists. If not, use a stub returning `{ data: { isOpen: true } }` and call it out — there's an existing `routes/market-status.ts` so a frontend hook probably exists already.)

- [ ] **Step 5: Implement `AboutGameModal`**

Create `packages/frontend/src/components/shell/AboutGameModal.tsx`:

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useGame } from '@/api/games';

export interface AboutGameModalProps {
  gameId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Game info modal opened from the status strip's `[i]` button. Re-renders
 * the same content that {@link AboutThisGameCard} shows on the game-detail
 * page; phase 3 replaces the card.
 */
export function AboutGameModal({ gameId, open, onOpenChange }: AboutGameModalProps) {
  const game = useGame(gameId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{game.data?.name ?? 'Game info'}</DialogTitle>
        </DialogHeader>
        {game.data ? (
          <div className="space-y-2 text-sm text-muted">
            <div>
              <span className="font-medium text-text">Status:</span> {game.data.status}
            </div>
            <div>
              <span className="font-medium text-text">Players:</span>{' '}
              {game.data.playerCount}
            </div>
            <div>
              <span className="font-medium text-text">Starting cash:</span> $
              {game.data.startingCash.toLocaleString()}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
```

(Adapt to the shape `useGame` actually returns — see `packages/frontend/src/api/games.ts`. If `playerCount` / `startingCash` aren't on the type, render whatever fields are present. Keeping it minimal here is OK; this modal will get more content in phase 3 when AboutThisGameCard is deleted.)

- [ ] **Step 6: Barrel export**

`packages/frontend/src/components/shell/index.ts`:

```ts
export { StatusStrip, type StatusStripProps, type StatusStripGameContext } from './StatusStrip';
export { AboutGameModal, type AboutGameModalProps } from './AboutGameModal';
```

- [ ] **Step 7: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- StatusStrip
```

Expected: 4 tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/components/shell/StatusStrip.tsx packages/frontend/src/components/shell/AboutGameModal.tsx packages/frontend/src/components/shell/index.ts packages/frontend/tests/StatusStrip.test.tsx
git commit -m "feat(frontend): StatusStrip + AboutGameModal

Second row of global chrome: pulse dot + market open/closed, ticking
ET clock, LIVE pill, three index quotes. Inside a game it also shows
DAY n/N + name and an info button that opens AboutGameModal."
```

---

## Task 12: Frontend — `TickerTape` component + test

**Files:**
- Create: `packages/frontend/src/components/shell/TickerTape.tsx`
- Create: `packages/frontend/src/hooks/useTickerTapeSymbols.ts`
- Create: `packages/frontend/tests/TickerTape.test.tsx`
- Modify: `packages/frontend/src/components/shell/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/TickerTape.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TickerTape } from '@/components/shell/TickerTape';
import { INDICES_QUERY_KEY } from '@/hooks/useIndicesSocket';
import { TICKER_TAPE_QUERY_KEY } from '@/api/systemSettings';
import type { IndexQuote } from '@markettrader/shared';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(TICKER_TAPE_QUERY_KEY, {
    symbols: ['^GSPC', 'AAPL', 'NVDA'],
    updatedAt: '2026-05-15T14:00:00Z',
  });
  qc.setQueryData<IndexQuote[]>(INDICES_QUERY_KEY, [
    { symbol: '^GSPC', last: 5284.12, changeAbs: 16.83, changePct: 0.32 },
    { symbol: 'AAPL', last: 189.42, changeAbs: 1.57, changePct: 0.84 },
    { symbol: 'NVDA', last: 1178.30, changeAbs: 27.5, changePct: 2.41 },
  ]);
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TickerTape', () => {
  it('renders each configured symbol with last + percent', () => {
    render(wrap(<TickerTape />));
    const tape = screen.getByTestId('ticker-tape');
    // Symbols appear twice because the marquee duplicates them for a seamless loop.
    expect(tape.textContent).toContain('^GSPC');
    expect(tape.textContent).toContain('AAPL');
    expect(tape.textContent).toContain('NVDA');
    expect(tape.textContent).toContain('189.42');
    expect(tape.textContent).toContain('+0.32%');
  });

  it('applies the marquee animation class', () => {
    render(wrap(<TickerTape />));
    const marquee = screen.getByTestId('ticker-tape-marquee');
    expect(marquee.className).toMatch(/animate-marquee/);
  });

  it('renders nothing when tape has no symbols yet', () => {
    const qc = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><TickerTape /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- TickerTape
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `useTickerTapeSymbols`**

Create `packages/frontend/src/hooks/useTickerTapeSymbols.ts`:

```ts
import { useTickerTapeSettings } from '@/api/systemSettings';

/** Convenience hook returning just the symbols array (or `[]` while loading). */
export function useTickerTapeSymbols(): string[] {
  const q = useTickerTapeSettings();
  return q.data?.symbols ?? [];
}
```

- [ ] **Step 4: Implement `TickerTape`**

Create `packages/frontend/src/components/shell/TickerTape.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useTickerTapeSymbols } from '@/hooks/useTickerTapeSymbols';
import { INDICES_QUERY_KEY } from '@/hooks/useIndicesSocket';
import type { IndexQuote } from '@markettrader/shared';

/**
 * Sticky bottom chrome row: a left-scrolling marquee of server-configured
 * symbols + their latest quotes. Hovering pauses the animation; clicking a
 * symbol navigates to `/symbols/:symbol` (outside a game) — phase 3 wires
 * the in-game click into the SelectedSymbolContext.
 */
export function TickerTape() {
  const symbols = useTickerTapeSymbols();
  const quotes = useQuery<IndexQuote[]>({
    queryKey: INDICES_QUERY_KEY,
    enabled: false,
    initialData: [],
  });

  if (symbols.length === 0) return null;
  const inGame = !!useParams().gameId;

  const quoteBySymbol = new Map(quotes.data?.map((q) => [q.symbol, q]));
  const items = symbols.map((s) => ({ symbol: s, quote: quoteBySymbol.get(s) }));
  // Duplicate items for a seamless loop — the marquee animates to -50%.
  const looped = [...items, ...items];

  return (
    <div
      data-testid="ticker-tape"
      className="h-6 border-t border-hairline-strong bg-bg/95 overflow-hidden"
    >
      <div
        data-testid="ticker-tape-marquee"
        className="flex h-full items-center gap-6 whitespace-nowrap animate-marquee px-4 text-[11px] font-mono"
      >
        {looped.map((it, idx) => {
          const change = it.quote?.changePct ?? 0;
          const last = it.quote?.last;
          const content = (
            <span className="flex items-baseline gap-1">
              <span className="text-text">{it.symbol}</span>
              {last !== undefined ? (
                <>
                  <span className="text-muted">
                    {new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(last)}
                  </span>
                  <span className={change >= 0 ? 'text-gain' : 'text-loss'}>
                    {change >= 0 ? '+' : '−'}{Math.abs(change).toFixed(2)}%
                  </span>
                </>
              ) : null}
            </span>
          );
          return inGame ? (
            // In-game: phase 3 turns this into a SelectedSymbolContext update.
            <span key={`${it.symbol}-${idx}`}>{content}</span>
          ) : (
            <Link key={`${it.symbol}-${idx}`} to={`/symbols/${it.symbol}`} className="hover:text-accent">
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Update barrel export**

```ts
// packages/frontend/src/components/shell/index.ts
export { StatusStrip, type StatusStripProps, type StatusStripGameContext } from './StatusStrip';
export { TickerTape } from './TickerTape';
export { AboutGameModal, type AboutGameModalProps } from './AboutGameModal';
```

- [ ] **Step 6: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- TickerTape
```

Expected: 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/components/shell/TickerTape.tsx packages/frontend/src/hooks/useTickerTapeSymbols.ts packages/frontend/src/components/shell/index.ts packages/frontend/tests/TickerTape.test.tsx
git commit -m "feat(frontend): TickerTape sticky bottom marquee

Reads symbols from useTickerTapeSymbols and live quotes from the
React Query cache populated by useIndicesSocket. Items are duplicated
inline so the 40s marquee loops seamlessly. Hover pauses; reduced
motion makes the strip statically scrollable via global CSS rule."
```

---

## Task 13: Wire the shell — rewritten `AppHeader` + composed `AppShell`

**Files:**
- Modify: `packages/frontend/src/components/AppHeader.tsx` — replaced
- Modify: `packages/frontend/src/components/AppShell.tsx`
- Modify: `packages/frontend/src/components/AppFooter.tsx` — deleted
- Modify: `packages/frontend/tests/App.test.tsx` — update selectors if needed
- Create: `packages/frontend/tests/AppHeader.test.tsx`

- [ ] **Step 1: Read the existing AppHeader + AppShell**

```bash
cat packages/frontend/src/components/AppHeader.tsx
cat packages/frontend/src/components/AppShell.tsx
cat packages/frontend/src/components/AppFooter.tsx
```

Note the existing nav links and the theme toggle button — we keep both.

- [ ] **Step 2: Write the failing test**

Create `packages/frontend/tests/AppHeader.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppHeader } from '@/components/AppHeader';
import { useAuthStore } from '@/stores/authStore';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AppHeader', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: 'tok',
      user: { id: 'u1', username: 'tristan', isAdmin: false },
    });
  });

  it('renders the brand mark and primary nav', () => {
    render(wrap(<AppHeader />));
    expect(screen.getByText(/MarketTrader/i)).toBeInTheDocument();
    expect(screen.getByText('Games')).toBeInTheDocument();
  });

  it('shows the admin link only when the user is admin', () => {
    useAuthStore.setState({
      token: 'tok',
      user: { id: 'u1', username: 'tristan', isAdmin: true },
    });
    render(wrap(<AppHeader />));
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('hides the admin link for non-admin users', () => {
    render(wrap(<AppHeader />));
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('renders the username and a sign out button', () => {
    render(wrap(<AppHeader />));
    expect(screen.getByText('tristan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('renders a theme toggle button', () => {
    render(wrap(<AppHeader />));
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Verify FAIL (or partial pass — old AppHeader may satisfy some assertions)**

```bash
pnpm --filter @markettrader/frontend test -- AppHeader.test
```

Note expected outcome before continuing.

- [ ] **Step 4: Rewrite `AppHeader`**

Replace `packages/frontend/src/components/AppHeader.tsx` entirely with:

```tsx
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore, useIsAdmin } from '@/stores/authStore';
import { useLogout } from '@/api/auth';
import { useTheme } from '@/stores/themeStore';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { to: '/', label: 'Games' },
  { to: '/symbols', label: 'Markets' },
] as const;

/**
 * Topbar row of the global chrome. Brand mark + primary nav on the left,
 * theme toggle + username + sign-out on the right. The Admin nav link
 * appears only for users in the admin group.
 */
export function AppHeader() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = useIsAdmin();
  const logout = useLogout();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();

  return (
    <header className="flex h-11 items-center justify-between border-b border-hairline-strong bg-bg px-4">
      <div className="flex items-center gap-6">
        <Link
          to="/"
          className="flex items-center gap-2 text-sm font-bold tracking-[-0.02em] text-text-strong"
        >
          <span className="inline-block h-2 w-2 rounded-[2px] bg-accent" aria-hidden />
          MarketTrader
        </Link>
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/'}
              className={({ isActive }) =>
                cn(
                  'rounded-chip px-2.5 py-1 text-xs',
                  isActive ? 'bg-hairline text-text-strong' : 'text-muted hover:text-text',
                )
              }
            >
              {l.label}
            </NavLink>
          ))}
          {isAdmin ? (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                cn(
                  'rounded-chip px-2.5 py-1 text-xs',
                  isActive ? 'bg-hairline text-text-strong' : 'text-muted hover:text-text',
                )
              }
            >
              Admin
            </NavLink>
          ) : null}
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        {user ? (
          <span className="hidden text-xs text-muted sm:inline">{user.username}</span>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
        >
          Sign out
        </Button>
      </div>
    </header>
  );
}
```

(`useIsAdmin` exists already — referenced by the old header. `/symbols` may or may not have an index route yet; if not, this link 404s. Confirm by checking `App.tsx`. If it 404s, drop the link until phase 5.)

- [ ] **Step 5: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- AppHeader.test
```

Expected: 5 tests pass.

- [ ] **Step 6: Rewrite `AppShell`**

Replace `packages/frontend/src/components/AppShell.tsx`:

```tsx
import { Outlet, useParams } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader';
import { StatusStrip, TickerTape } from '@/components/shell';
import { useIndicesSocket } from '@/hooks/useIndicesSocket';
import { useGame } from '@/api/games';

/**
 * Three-row layout for every authenticated page: AppHeader on top,
 * StatusStrip below it, the routed page in the middle, and the
 * TickerTape pinned at the viewport bottom. Mounts a single
 * useIndicesSocket subscription that feeds the chrome rows.
 */
export function AppShell() {
  useIndicesSocket();
  const { gameId } = useParams();
  const game = useGame(gameId);

  const ctx =
    gameId && game.data
      ? {
          gameId,
          name: game.data.name,
          dayCurrent: 1, // TODO(phase-3): derive from startDate/endDate when arena lands
          dayTotal: 1,
        }
      : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <AppHeader />
      <StatusStrip gameContext={ctx} />
      <main className="flex-1">
        <Outlet />
      </main>
      <TickerTape />
    </div>
  );
}
```

Note: the `useGame(gameId)` call is only meaningful when we're under `/games/:gameId/*` — `useParams()` returns `{}` for other routes, so `gameId` is undefined and `useGame(undefined)` should be safe (verify the hook tolerates undefined; if not, gate the call with `useGame(gameId ?? '')` and check for `gameId` truthiness when computing `ctx`).

The `dayCurrent`/`dayTotal` TODO is fine for phase 2 — the UI shows `DAY 1 / 1 · <name>` which is a known imprecise placeholder. Phase 3 computes the real values. Mark in the JSDoc.

- [ ] **Step 7: Delete `AppFooter`**

```bash
git rm packages/frontend/src/components/AppFooter.tsx
```

Search for remaining usages and remove them:

```bash
grep -RIn 'AppFooter' packages/frontend/src packages/frontend/tests
```

Any hit needs cleanup. Most likely there's only the now-deleted import in `AppShell.tsx`.

- [ ] **Step 8: Run the full frontend test suite**

```bash
pnpm --filter @markettrader/frontend test
```

Expected: PASS. Existing `App.test.tsx` may need a selector update — the old footer's "API Docs" / "Investopedia" text is gone. If the test references those, edit it. (Tests should assert behavior, not chrome decoration — if a test breaks on a missing footer link, the test was over-asserting and trimming it is correct.)

- [ ] **Step 9: Typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```

Both PASS.

- [ ] **Step 10: Build**

```bash
pnpm --filter @markettrader/frontend build
```

PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/frontend/src/components/AppHeader.tsx packages/frontend/src/components/AppShell.tsx packages/frontend/tests/AppHeader.test.tsx
git add -u packages/frontend/src/components/AppFooter.tsx packages/frontend/tests/App.test.tsx
git commit -m "feat(frontend): compose three-row global chrome in AppShell

AppShell now stacks AppHeader + StatusStrip + main + TickerTape, with
a single useIndicesSocket subscription mounted at the top. AppFooter
deleted — the API Docs / Investopedia links move to phase 5's overflow
menu if needed. The status strip's game context is approximated for
phase 2; phase 3's arena rewrite computes the real day counter."
```

---

## Task 14: Full-suite verification

- [ ] **Step 1: Run the entire test suite**

```bash
pnpm test
```

Expected: PASS across server, frontend, shared.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

PASS.

- [ ] **Step 3: Lint**

```bash
pnpm lint
```

PASS.

- [ ] **Step 4: Production build (both packages)**

```bash
pnpm --filter @markettrader/frontend build
pnpm --filter @markettrader/server build
```

Both PASS.

- [ ] **Step 5: Manual smoke test (deferred)**

Visual smoke test (dev server) is skipped here — the new chrome will be exercised end-to-end after phase 3 lands the arena layout that visually consumes most of the page. If you want to do a quick manual sanity check now:

```bash
pnpm dev
```

Open `http://localhost:5173`, sign in. Verify the topbar renders with the new brand mark, the status strip shows the ticking clock + LIVE pill, the bottom edge has a scrolling tape with at least the seeded symbols. Console should be free of WebSocket connection errors.

(Skip this step if running `pnpm dev` is blocked or you prefer to defer to phase 3 review.)

---

## What's NOT in this phase

Carried into later phases — don't expand here:
- `PUT /admin/system-settings/ticker-tape` and the admin editor UI — **phase 4**.
- Real `DAY n/N` calculation, ticker-tape click in-game wired to `SelectedSymbolContext`, arena layout — **phase 3**.
- Games list, login/register, symbol page redesign — **phase 5**.
- Removing the Tailwind compatibility aliases — happens as later phases touch each consumer.

---

## Self-Review

**1. Spec coverage:**
- Topbar layout (§3.1) → Task 13
- Status strip layout + content (§3.2) → Task 11
- Ticker tape (§3.3) → Task 12
- `system_settings` table (§5.1) → Task 2
- `GET /system-settings/ticker-tape` route (§5.2) → Task 4
- `SystemSettingsService` (§5.3) → Task 3
- `indicesBroadcaster` (§5.4) → Task 6
- `/ws/live` socket (§5.5) → Task 7
- Shared types (§6.2) → Task 1
- Frontend components (§6.3) → Tasks 11, 12, 13
- Frontend hooks (§6.4) → Tasks 9, 10, 12
- Reduced motion globally — already covered by phase 1's `index.css` rule; tape uses `animate-marquee` which respects it.

PHASE-4 work (admin write route, audit log, frontend editor) is intentionally deferred and noted in §10.

**2. Placeholder scan:** None — every step has complete code, every test asserts concrete behavior, every command has an expected outcome. The known `TODO(phase-3)` in `AppShell.tsx` is annotated explicitly so it doesn't read as a forgotten gap.

**3. Type / API consistency:**
- `IndexQuote.last` / `changeAbs` / `changePct` field names match across `system-settings.ts`, `indices-broadcaster.ts`, `StatusStrip.tsx`, `TickerTape.tsx`.
- `LiveWsMessage` union shape matches between `websocket.ts` (definition), `indices-broadcaster.ts` (server emit), and `useIndicesSocket.ts` (client consumer).
- `INDICES_QUERY_KEY` exported from `useIndicesSocket.ts` and consumed by `StatusStrip.test.tsx`, `TickerTape.test.tsx`, `TickerTape.tsx`, `StatusStrip.tsx`.
- `TICKER_TAPE_QUERY_KEY` exported from `api/systemSettings.ts` and consumed by `useIndicesSocket.ts` + tests.
- `system_settings` table schema matches between SQLite (Task 2 §1) and Postgres (Task 2 §2).
- `globalLiveRoute` and `GlobalClientRegistry` both reference `LiveWsMessage`-shaped payloads.
- `Querystring: { token?: string }` typed the same on both per-game and global socket routes — matches the existing convention.

**4. Ambiguity check:** Tasks 4 and 7 modify `app.ts`. I've put the modifications in different tasks so the diffs stay reviewable. The order in `app.ts` after both tasks: `systemSettings` instantiated + seeded → `indicesBroadcaster` instantiated + started → `globalLiveRoute` registered → existing routes registered. The implementer should preserve that order.
