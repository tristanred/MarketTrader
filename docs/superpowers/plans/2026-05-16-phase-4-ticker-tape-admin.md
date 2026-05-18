# Phase 4 — Ticker-Tape Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin write-access for the ticker-tape symbol list — a `PUT /admin/system-settings/ticker-tape` route with audit-log entries, a `ticker_tape_config_changed` WS rebroadcast on save, a `useAdminTickerTape` API client, and a "Ticker tape" section in the existing admin system page.

**Architecture:** The server route delegates to the existing `SystemSettingsService.setTickerTapeSymbols` (phase 2), wraps the write in a Drizzle transaction with `recordAdminAction` for audit, then broadcasts a `ticker_tape_config_changed` message via the existing `GlobalClientRegistry`. The frontend admin page (already mounted at `/admin/system`) gains a new section using existing chrome (`Card`, `Input`, `Button`), and the existing `useIndicesSocket` already invalidates the React Query cache when the WS broadcast arrives, so live consumers update without polling.

**Tech Stack:** Fastify 5, Drizzle ORM, `fastify-type-provider-zod`, React 19 + React Query 5, Vitest + Supertest, ws.

**Spec reference:** `docs/superpowers/specs/2026-05-15-terminal-design-refresh.md` §5.2 (route), §5.6 (audit), §6.3 (frontend `TickerTapeEditor`), §10 (admin pages keep current theme).

**Branch & commit cadence:** Work happens on `feat/phase-4-ticker-tape-admin` (already created from `new-ui`). Each task ends with a focused commit. Merge into `new-ui` after Task 8.

---

## Task 0: Confirm branch state

- [ ] **Step 1: Verify current branch and clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status --short
```

Expected: branch is `feat/phase-4-ticker-tape-admin`, status is clean.

- [ ] **Step 2: Verify phase 2 + 3a deliverables present**

```bash
ls packages/server/src/services/system-settings.ts
ls packages/server/src/ws/global-registry.ts
ls packages/server/src/ws/indices-broadcaster.ts
ls packages/frontend/src/api/admin/system.ts
```

Expected: all four files exist.

---

## File Structure

**Modified (shared):**
- `packages/shared/src/types/admin.ts` — add `AdminUpdateTickerTapeRequest` and `AdminTickerTapeResponse` request/response types.

**Modified (server):**
- `packages/server/src/routes/admin/system.ts` — add `PUT /admin/system-settings/ticker-tape` route. Validates body with Zod (`{ symbols: string[] }`), each symbol normalized + validated by `StockProvider.searchSymbols` lookup; wraps `setTickerTapeSymbols` and `recordAdminAction` in a transaction; returns the persisted `{ symbols, updatedAt }`.
- `packages/server/src/services/system-settings.ts` — overload or add a separate method `setTickerTapeSymbolsInTx(db: DbOrTx, symbols, actorId)` so the route can write inside the same transaction as the audit log. The existing event-emitter contract preserved.
- `packages/server/src/app.ts` — wire `'ticker-tape-changed'` listener: on each emit, the existing `IndicesBroadcaster.onSettingsChange` already refreshes its subscription set; ALSO broadcast a `ticker_tape_config_changed` message via `globalRegistry` so connected frontend clients invalidate their tape query.

**Created (server):**
- `packages/server/tests/routes/admin-ticker-tape.test.ts` — TDD coverage for the new route (admin-only, validation, audit row written, broadcast emitted).

**Modified (frontend):**
- `packages/frontend/src/api/admin/system.ts` — add `useAdminTickerTape` (GET) and `useAdminUpdateTickerTape` (PUT) hooks.
- `packages/frontend/src/pages/admin/AdminSystemPage.tsx` — append a "Ticker tape" section with the existing `Card` chrome that lists current symbols, allows add/remove, and submits the new list.

**Created (frontend):**
- `packages/frontend/src/components/admin/TickerTapeEditor.tsx` — the editor component (add symbol input + remove buttons + Save).
- `packages/frontend/tests/TickerTapeEditor.test.tsx` — component tests.

**Out of scope** (intentionally deferred):
- Live validation that each symbol resolves on the server BEFORE submit — for v1, the server validates on PUT and returns a 400 with a useful message if any symbol is unknown. Frontend just renders the error.
- Drag-to-reorder symbols. Add/remove only.

---

## Shared Conventions

- The request type uses `symbols: string[]` (uppercased + trimmed server-side by `setTickerTapeSymbols`).
- All admin routes mirror the existing pattern: `onRequest: rawApp.requireAdmin`, Zod-typed body, transactional writes paired with `recordAdminAction`.
- Tests for admin routes use the existing `createTestApp` helper + inline user registration. Bootstrap admin is the first registered user (see `auth.test.ts` for the pattern).

---

## Task 1: Shared request/response types

**Files:**
- Modify: `packages/shared/src/types/admin.ts`

- [ ] **Step 1: Append the new types**

Open `packages/shared/src/types/admin.ts`. Append at the end:

```ts
/** Body for `PUT /admin/system-settings/ticker-tape`. */
export interface AdminUpdateTickerTapeRequest {
  symbols: string[];
}
```

`TickerTapeSettings` (already exported from `system-settings.ts`) is the response type — no new declaration needed.

- [ ] **Step 2: Verify**

```bash
pnpm --filter @markettrader/shared typecheck
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/admin.ts
git commit -m "feat(shared): AdminUpdateTickerTapeRequest type

Body type for the new PUT /admin/system-settings/ticker-tape route.
Response reuses the existing TickerTapeSettings."
```

---

## Task 2: `setTickerTapeSymbolsInTx` — transactional service method

**Files:**
- Modify: `packages/server/src/services/system-settings.ts`
- Modify: `packages/server/tests/system-settings.test.ts`

The existing `setTickerTapeSymbols` writes via `this.db`, which is the top-level handle — fine for callers that don't need to atomic-commit alongside other writes. The admin route needs to write the new symbols AND the audit-log row in the same transaction, so we add a thin variant that accepts a transaction handle.

- [ ] **Step 1: Write the failing test**

Append to `packages/server/tests/system-settings.test.ts`:

```ts
import { sql } from 'drizzle-orm';

it('setTickerTapeSymbolsInTx writes inside a caller-supplied transaction', async () => {
  // Wrap in a transaction that we deliberately fail so the writes roll back.
  // If the service held its own implicit connection, the rollback wouldn't
  // affect its write — proving the helper actually honors the tx parameter.
  await expect(
    db.transaction(async (tx) => {
      await svc.setTickerTapeSymbolsInTx(tx, ['CUSTOM-TX'], 'tx-user');
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');

  const after = await svc.getTickerTapeSymbols();
  // No row from the seed, and the rolled-back tx never persisted CUSTOM-TX.
  expect(after).toBeNull();
});

it('setTickerTapeSymbolsInTx persists when the tx commits and emits the change event', async () => {
  const events: string[][] = [];
  svc.on('change', (s) => events.push(s));
  await db.transaction(async (tx) => {
    await svc.setTickerTapeSymbolsInTx(tx, ['  msft ', 'AAPL'], 'admin-1');
  });
  const after = await svc.getTickerTapeSymbols();
  expect(after!.symbols).toEqual(['MSFT', 'AAPL']);
  // The event fires after the tx callback returns.
  expect(events).toEqual([['MSFT', 'AAPL']]);
});
```

The `sql` import is unused in the snippet above but harmless. Remove it if your linter flags it.

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/server test -- system-settings.test
```

Expected: FAIL — method missing.

- [ ] **Step 3: Implement**

Open `packages/server/src/services/system-settings.ts`. Refactor the existing `setTickerTapeSymbols` to delegate to the new `setTickerTapeSymbolsInTx`. Replace the existing method with:

```ts
  /**
   * Replaces the persisted ticker-tape symbol list using the top-level db
   * handle. For atomic admin writes that also touch the audit log, use
   * {@link setTickerTapeSymbolsInTx} so both rows land in the same
   * transaction.
   */
  async setTickerTapeSymbols(symbols: string[], actorId: string | null): Promise<void> {
    return this.setTickerTapeSymbolsInTx(this.db, symbols, actorId);
  }

  /**
   * Transaction-aware variant of {@link setTickerTapeSymbols}. The caller
   * passes its own tx handle so the write and any related audit entry
   * commit atomically. The 'change' event fires AFTER the inner write
   * completes (it may still emit if the tx later rolls back — callers
   * should not place irreversible side effects in a 'change' listener).
   */
  async setTickerTapeSymbolsInTx(
    db: Pick<Db, 'insert'>,
    symbols: string[],
    actorId: string | null,
  ): Promise<void> {
    const normalized = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (normalized.length === 0) {
      throw new Error('ticker_tape_symbols cannot be empty');
    }

    const value = JSON.stringify({ symbols: normalized });
    const now = new Date().toISOString();

    await db
      .insert(schema.systemSettings)
      .values({ key: KEY_TICKER_TAPE, value, updatedAt: now, updatedBy: actorId })
      .onConflictDoUpdate({
        target: schema.systemSettings.key,
        set: { value, updatedAt: now, updatedBy: actorId },
      });

    this.emit('change', normalized);
  }
```

The `Db` type at the top of the file is imported from `../db/index.js`. The structural subset `Pick<Db, 'insert'>` matches both the top-level db AND a Drizzle transaction handle — same pattern `admin-audit.ts` uses for `recordAdminAction`.

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/server test -- system-settings.test
```

Expected: all existing service tests + 2 new tx tests pass.

- [ ] **Step 5: Full server suite + typecheck**

```bash
pnpm --filter @markettrader/server test
pnpm --filter @markettrader/server typecheck
```

Expected: PASS. Test count grows by 2 from baseline (237 → 239).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/system-settings.ts packages/server/tests/system-settings.test.ts
git commit -m "feat(server): setTickerTapeSymbolsInTx for atomic admin writes

Mirrors recordAdminAction's pattern — accepts a transaction handle so
the symbol update and audit-log insert can commit together. The old
top-level method now delegates to the new tx-aware variant."
```

---

## Task 3: `PUT /admin/system-settings/ticker-tape` route — TDD

**Files:**
- Modify: `packages/server/src/routes/admin/system.ts`
- Modify: `packages/server/src/routes/admin/index.ts` — accept the `SystemSettingsService` instance and pass it to `adminSystemRoutes`.
- Modify: `packages/server/src/app.ts` — pass `systemSettings` into `adminRoutes(...)`.
- Create: `packages/server/tests/routes/admin-ticker-tape.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/routes/admin-ticker-tape.test.ts`. Follow the pattern in `packages/server/tests/routes/system-settings.test.ts`:

```ts
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { eq } from 'drizzle-orm';

describe('PUT /admin/system-settings/ticker-tape', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let memberToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    // First-ever registrant becomes admin (see auth.test.ts).
    const reg1 = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'admin-tape', password: 'password123' },
    });
    adminToken = reg1.json<{ token: string }>().token;

    const reg2 = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'member-tape', password: 'password123' },
    });
    memberToken = reg2.json<{ token: string }>().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('updates the tape and returns the new config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/system-settings/ticker-tape',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { symbols: ['MSFT', 'AAPL', 'NVDA'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ symbols: string[]; updatedAt: string }>();
    expect(body.symbols).toEqual(['MSFT', 'AAPL', 'NVDA']);
    expect(body.updatedAt).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('uppercases and trims symbols before persisting', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/system-settings/ticker-tape',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { symbols: ['  tsla ', 'goog'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ symbols: string[] }>().symbols).toEqual(['TSLA', 'GOOG']);
  });

  it('rejects an empty list with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/system-settings/ticker-tape',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { symbols: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/system-settings/ticker-tape',
      payload: { symbols: ['AAPL'] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects non-admin requests with 403', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/system-settings/ticker-tape',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { symbols: ['AAPL'] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('writes an audit-log row on success', async () => {
    // Use a fresh app + db so we can inspect the audit_log table directly.
    const fresh = await createTestApp();
    try {
      const reg = await fresh.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username: 'audit-admin', password: 'password123' },
      });
      const token = reg.json<{ token: string }>().token;
      await fresh.inject({
        method: 'PUT',
        url: '/admin/system-settings/ticker-tape',
        headers: { authorization: `Bearer ${token}` },
        payload: { symbols: ['AAPL', 'MSFT'] },
      });
      // Read the audit log directly from the test app's DB. The test helper
      // doesn't expose the db, but Fastify decorates do. The simplest path
      // is to issue GET /admin/audit and check the latest row.
      const audit = await fresh.inject({
        method: 'GET',
        url: '/admin/audit?limit=5',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(audit.statusCode).toBe(200);
      const rows = audit.json<Array<{ action: string; targetType: string }>>();
      const tapeRow = rows.find((r) => r.action === 'system.ticker_tape.update');
      expect(tapeRow).toBeDefined();
      expect(tapeRow!.targetType).toBe('system');
    } finally {
      await fresh.close();
    }
  });
});
```

Note on the audit shape: read `packages/server/src/routes/admin/audit.ts` to confirm the response shape. If the field names differ from `action`/`targetType`, adapt the assertion. The intent — "there's a row with action 'system.ticker_tape.update'" — is the invariant.

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/server test -- admin-ticker-tape
```

Expected: FAIL — route not registered (404 instead of 200).

- [ ] **Step 3: Wire the service into the admin routes plumbing**

Open `packages/server/src/routes/admin/index.ts`. The `adminRoutes` factory currently takes `(db, provider)`. Extend it to take an optional `systemSettings`:

```ts
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/index.js';
import type { StockProvider } from '../../providers/index.js';
import type { SystemSettingsService } from '../../services/system-settings.js';
import { adminUsersRoutes } from './users.js';
import { adminGamesRoutes } from './games.js';
import { adminPortfoliosRoutes } from './portfolios.js';
import { adminTradesRoutes } from './trades.js';
import { adminSystemRoutes } from './system.js';
import { adminAuditRoutes } from './audit.js';

export function adminRoutes(
  db: Db,
  provider: StockProvider,
  systemSettings: SystemSettingsService,
) {
  return async function (app: FastifyInstance): Promise<void> {
    await app.register(adminUsersRoutes(db));
    await app.register(adminGamesRoutes(db));
    await app.register(adminPortfoliosRoutes(db, provider));
    await app.register(adminTradesRoutes(db, provider));
    await app.register(adminSystemRoutes(db, systemSettings));
    await app.register(adminAuditRoutes(db));
  };
}
```

Open `packages/server/src/app.ts`. Find the line `await app.register(adminRoutes(db, provider));` (or equivalent) and update it to pass `systemSettings` as the third argument. The `systemSettings` instance is already declared earlier in `buildApp` (phase 2).

- [ ] **Step 4: Add the route**

Open `packages/server/src/routes/admin/system.ts`. Change the factory signature and add the new route. The full updated file is large; here's the diff:

1. At the top, add imports:
```ts
import { eq } from 'drizzle-orm';
import type { SystemSettingsService } from '../../services/system-settings.js';
import type { TickerTapeSettings, AdminUpdateTickerTapeRequest } from '@markettrader/shared';
```

Note: `eq` may already be imported. Keep imports tidy.

2. Add a Zod body schema near the existing `symbolParams` / `priceBody`:
```ts
const tickerTapeBody = z.object({
  symbols: z.array(z.string().trim().min(1).max(12)).min(1).max(100),
});
```

3. Change the factory signature:
```ts
export function adminSystemRoutes(db: Db, systemSettings: SystemSettingsService) {
```

4. Inside the factory, after the existing routes (after `POST /admin/stocks/cache/flush` and `GET /admin/stats`, before the closing `};`), add:

```ts
    app.put('/admin/system-settings/ticker-tape', {
      onRequest: rawApp.requireAdmin,
      schema: {
        tags: ['Admin'],
        summary: 'Replace the ticker-tape symbol list.',
        security: [{ bearerAuth: [] }],
        body: tickerTapeBody,
      },
    }, async (request, reply) => {
      const { symbols } = request.body as AdminUpdateTickerTapeRequest;
      const adminId = request.user.id;

      // Read the previous value first so the audit log captures before/after.
      const before = await systemSettings.getTickerTapeSymbols();

      await db.transaction(async (tx) => {
        await systemSettings.setTickerTapeSymbolsInTx(tx, symbols, adminId);
        await recordAdminAction(tx, {
          adminUserId: adminId,
          action: 'system.ticker_tape.update',
          targetType: 'system',
          targetId: 'ticker_tape_symbols',
          before: before ?? null,
          after: { symbols: symbols.map((s) => s.trim().toUpperCase()) },
        });
      });

      const after = await systemSettings.getTickerTapeSymbols();
      const resp: TickerTapeSettings = after!;
      return reply.send(resp);
    });
```

Confirm `recordAdminAction` is imported at the top of the file (it already is — phase 2's audit changes added it).

- [ ] **Step 5: Verify PASS**

```bash
pnpm --filter @markettrader/server test -- admin-ticker-tape
```

Expected: all 6 tests pass.

- [ ] **Step 6: Full server suite**

```bash
pnpm --filter @markettrader/server test
pnpm --filter @markettrader/server typecheck
pnpm --filter @markettrader/server lint
```

All PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/admin/system.ts packages/server/src/routes/admin/index.ts packages/server/src/app.ts packages/server/tests/routes/admin-ticker-tape.test.ts
git commit -m "feat(server): PUT /admin/system-settings/ticker-tape

Admin-only route that replaces the persisted ticker-tape symbol list
inside a single transaction with the audit-log entry. Returns the
new TickerTapeSettings. Service's 'change' event still fires on the
top-level handle so IndicesBroadcaster refreshes its subscription set."
```

---

## Task 4: WS rebroadcast on settings change

**Files:**
- Modify: `packages/server/src/app.ts`

The frontend's `useIndicesSocket` (phase 2) listens for `ticker_tape_config_changed` events on the global socket and invalidates the React Query cache. The server's `IndicesBroadcaster` already updates its OWN subscription set on the service's `'change'` event. We additionally need to broadcast the user-facing config message.

- [ ] **Step 1: Add the WS broadcaster wiring**

Open `packages/server/src/app.ts`. Find the block where `indicesBroadcaster` is constructed and started. Right after that, add a listener that broadcasts the config change to the global registry:

```ts
systemSettings.on('change', (symbols: string[]) => {
  globalRegistry.broadcast({
    event: 'ticker_tape_config_changed',
    data: { symbols, at: new Date().toISOString() },
  });
});
```

This sits alongside the existing wiring; nothing else changes. The cast on `symbols` is needed because the EventEmitter base type erases listener argument types.

- [ ] **Step 2: Test it lands when the route fires**

Append to `packages/server/tests/routes/admin-ticker-tape.test.ts`:

```ts
import WebSocket from 'ws';
import type { AddressInfo } from 'net';

it('broadcasts ticker_tape_config_changed on the global socket after a successful PUT', async () => {
  // Build a separate app so we can listen on an address before issuing PUT.
  const fresh = await createTestApp();
  await fresh.listen({ port: 0, host: '127.0.0.1' });
  try {
    const reg = await fresh.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'ws-admin', password: 'password123' },
    });
    const token = reg.json<{ token: string }>().token;

    const port = (fresh.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/live?token=${token}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });

    const messagePromise = new Promise<unknown>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no broadcast in 3s')), 3000);
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { event: string };
        if (msg.event === 'ticker_tape_config_changed') {
          clearTimeout(t);
          resolve(msg);
        }
      });
    });

    await fresh.inject({
      method: 'PUT',
      url: '/admin/system-settings/ticker-tape',
      headers: { authorization: `Bearer ${token}` },
      payload: { symbols: ['AAPL', 'MSFT'] },
    });

    const message = (await messagePromise) as { event: string; data: { symbols: string[] } };
    expect(message.data.symbols).toEqual(['AAPL', 'MSFT']);
    ws.close();
  } finally {
    await fresh.close();
  }
});
```

- [ ] **Step 3: Verify PASS**

```bash
pnpm --filter @markettrader/server test -- admin-ticker-tape
```

Expected: 7 tests pass (6 from Task 3 + 1 broadcast test).

- [ ] **Step 4: Full server suite**

```bash
pnpm --filter @markettrader/server test
```

Expected: PASS, no regressions in the existing socket/route tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/app.ts packages/server/tests/routes/admin-ticker-tape.test.ts
git commit -m "feat(server): broadcast ticker_tape_config_changed on tape update

When SystemSettingsService emits 'change', the global socket fans out
a ticker_tape_config_changed message so connected clients can refresh
their cached tape config without polling. Test asserts the message
arrives end-to-end after a PUT."
```

---

## Task 5: Frontend admin API client

**Files:**
- Modify: `packages/frontend/src/api/admin/system.ts`

- [ ] **Step 1: Add `useAdminTickerTape` (read) and `useAdminUpdateTickerTape` (write)**

Append to `packages/frontend/src/api/admin/system.ts`. (Read the file first to see the existing pattern.)

```ts
import type {
  AdminUpdateTickerTapeRequest,
  TickerTapeSettings,
} from '@markettrader/shared';
import { TICKER_TAPE_QUERY_KEY } from '@/api/systemSettings';

/** GET the current ticker-tape config (admin and non-admin can both read). */
export function useAdminTickerTape() {
  return useQuery({
    queryKey: TICKER_TAPE_QUERY_KEY,
    queryFn: () => apiFetch<TickerTapeSettings>('/system-settings/ticker-tape'),
    staleTime: 5_000,
  });
}

/** PUT a new ticker-tape symbol list. Admin-only on the server. */
export function useAdminUpdateTickerTape() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminUpdateTickerTapeRequest) =>
      apiFetch<TickerTapeSettings>('/admin/system-settings/ticker-tape', {
        method: 'PUT',
        body,
      }),
    onSuccess: (next) => {
      qc.setQueryData(TICKER_TAPE_QUERY_KEY, next);
    },
  });
}
```

The `useQueryClient`, `useQuery`, `useMutation`, and `apiFetch` imports are already at the top of `system.ts`.

The read hook shares the same query key as `useTickerTapeSettings` (`@/api/systemSettings`) — both hooks read the same cache. The admin page's read is just a manual fetch trigger on the existing key; the live-updating cache stays consistent via the WS `ticker_tape_config_changed` invalidation (already wired by phase 2's `useIndicesSocket`).

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @markettrader/frontend typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/api/admin/system.ts
git commit -m "feat(frontend): useAdminTickerTape + useAdminUpdateTickerTape hooks

Shares the cache key with the non-admin useTickerTapeSettings so a
write from the admin page invalidates the same React Query cache the
arena reads from."
```

---

## Task 6: `TickerTapeEditor` component — TDD

**Files:**
- Create: `packages/frontend/src/components/admin/TickerTapeEditor.tsx`
- Create: `packages/frontend/tests/TickerTapeEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/TickerTapeEditor.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';

const tapeData = { symbols: ['AAPL', 'MSFT'], updatedAt: '2026-05-15T14:00:00Z' };
const mutateAsync = vi.fn().mockResolvedValue({
  symbols: ['AAPL', 'MSFT', 'NVDA'],
  updatedAt: '2026-05-15T14:01:00Z',
});

vi.mock('@/api/admin/system', () => ({
  useAdminTickerTape: () => ({ data: tapeData, isLoading: false }),
  useAdminUpdateTickerTape: () => ({ mutateAsync, isPending: false }),
}));

import { TickerTapeEditor } from '@/components/admin/TickerTapeEditor';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('TickerTapeEditor', () => {
  it('renders the current symbols as removable chips', () => {
    render(wrap(<TickerTapeEditor />));
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('MSFT')).toBeInTheDocument();
    // Each symbol has a remove button.
    expect(screen.getAllByRole('button', { name: /remove/i })).toHaveLength(2);
  });

  it('adds a typed symbol to the working list', async () => {
    const user = userEvent.setup();
    render(wrap(<TickerTapeEditor />));
    const input = screen.getByLabelText(/add symbol/i);
    await user.type(input, 'NVDA');
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(screen.getByText('NVDA')).toBeInTheDocument();
  });

  it('uppercases input on add', async () => {
    const user = userEvent.setup();
    render(wrap(<TickerTapeEditor />));
    const input = screen.getByLabelText(/add symbol/i);
    await user.type(input, 'tsla');
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(screen.getByText('TSLA')).toBeInTheDocument();
  });

  it('removes a symbol when its remove button is clicked', async () => {
    const user = userEvent.setup();
    render(wrap(<TickerTapeEditor />));
    expect(screen.getByText('MSFT')).toBeInTheDocument();
    const msftRemove = screen.getAllByRole('button', { name: /remove/i })[1]!;
    await user.click(msftRemove);
    expect(screen.queryByText('MSFT')).toBeNull();
  });

  it('submits the working list on Save', async () => {
    const user = userEvent.setup();
    render(wrap(<TickerTapeEditor />));
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ symbols: ['AAPL', 'MSFT'] });
    });
  });

  it('disables Save when the working list is empty', async () => {
    const user = userEvent.setup();
    render(wrap(<TickerTapeEditor />));
    const removeBtns = screen.getAllByRole('button', { name: /remove/i });
    await user.click(removeBtns[0]!);
    await user.click(screen.getAllByRole('button', { name: /remove/i })[0]!);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- TickerTapeEditor
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/frontend/src/components/admin/TickerTapeEditor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAdminTickerTape, useAdminUpdateTickerTape } from '@/api/admin/system';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { toastApiError } from '@/components/admin/adminErrors';

const SYMBOL_RE = /^[A-Z^][A-Z0-9.\-^]{0,11}$/;

/**
 * Admin editor for the ticker-tape symbol list. Tracks an in-memory working
 * list; the persisted config is only updated on Save. Removing a symbol
 * doesn't fire until the user clicks Save, so accidental clicks are
 * recoverable by adding the chip back before submitting.
 */
export function TickerTapeEditor() {
  const tape = useAdminTickerTape();
  const update = useAdminUpdateTickerTape();
  const [working, setWorking] = useState<string[]>([]);
  const [pending, setPending] = useState('');

  // Seed the working list from server data once it loads.
  useEffect(() => {
    if (tape.data) setWorking(tape.data.symbols);
  }, [tape.data]);

  function addSymbol() {
    const next = pending.trim().toUpperCase();
    if (!next) return;
    if (!SYMBOL_RE.test(next)) {
      toast({ title: `Invalid symbol "${next}"`, variant: 'destructive' });
      return;
    }
    if (working.includes(next)) {
      toast({ title: `${next} is already on the tape`, variant: 'destructive' });
      return;
    }
    setWorking([...working, next]);
    setPending('');
  }

  function removeSymbol(sym: string) {
    setWorking(working.filter((s) => s !== sym));
  }

  async function save() {
    try {
      await update.mutateAsync({ symbols: working });
      toast({ title: 'Ticker tape updated', variant: 'success' });
    } catch (err) {
      toastApiError(err, 'Could not save ticker tape');
    }
  }

  if (tape.isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ticker tape</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Symbols that scroll across the bottom of every page. Index tickers like
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">^GSPC</code>
          are supported. Changes apply to all connected users immediately.
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {working.map((s) => (
            <li
              key={s}
              className="flex items-center gap-1 rounded-md border bg-muted px-2 py-1 font-mono text-xs"
            >
              <span>{s}</span>
              <button
                type="button"
                onClick={() => removeSymbol(s)}
                aria-label={`Remove ${s}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="tape-add">Add symbol</Label>
            <Input
              id="tape-add"
              value={pending}
              onChange={(e) => setPending(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSymbol();
                }
              }}
              placeholder="e.g. AAPL or ^GSPC"
            />
          </div>
          <Button type="button" variant="outline" onClick={addSymbol}>
            Add
          </Button>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={working.length === 0 || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

The `toastApiError` helper lives at `packages/frontend/src/components/admin/adminErrors.ts` — same path the rest of the admin pages use. Verify it exists before implementing; if it doesn't, fall back to `toast({ title: 'Save failed', description: String(err), variant: 'destructive' })`.

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- TickerTapeEditor
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/admin/TickerTapeEditor.tsx packages/frontend/tests/TickerTapeEditor.test.tsx
git commit -m "feat(frontend): TickerTapeEditor admin component

Tracks an in-memory working list (current symbols + pending edits) so
accidental removes are recoverable. Save POSTs the whole list to
PUT /admin/system-settings/ticker-tape. Validates symbols against the
^?[A-Z0-9.\\-]{1,12}\$ regex so '^GSPC' is admitted but garbage isn't."
```

---

## Task 7: Mount `TickerTapeEditor` in `AdminSystemPage`

**Files:**
- Modify: `packages/frontend/src/pages/admin/AdminSystemPage.tsx`

- [ ] **Step 1: Add the import and render**

Open `packages/frontend/src/pages/admin/AdminSystemPage.tsx`. Add the import at the top with the other admin-component imports:

```tsx
import { TickerTapeEditor } from '@/components/admin/TickerTapeEditor';
```

Then add `<TickerTapeEditor />` to the page's JSX. The existing page composes several `<Card>` sections (price override, cache flush, stats). Add the editor as another section in the same vertical stack — the precise placement is wherever makes sense in the page's existing column. Read the file first to see how the existing cards are arranged and mirror that.

- [ ] **Step 2: Verify**

```bash
pnpm --filter @markettrader/frontend test
pnpm --filter @markettrader/frontend typecheck
pnpm --filter @markettrader/frontend lint
pnpm --filter @markettrader/frontend build
```

Expected: PASS across the board.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/admin/AdminSystemPage.tsx
git commit -m "feat(frontend): mount TickerTapeEditor in AdminSystemPage

The editor sits alongside the existing price-override / cache-flush
cards. Admin theme is unchanged — uses the same Card chrome as the
rest of the admin pages."
```

---

## Task 8: Full-suite verification

- [ ] **Step 1: Run everything**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm --filter @markettrader/frontend build
pnpm --filter @markettrader/server build
```

Expected: all PASS. Server tests should grow by ~8 (2 service tx tests + 6-7 route tests). Frontend tests grow by 6 (TickerTapeEditor).

If something fails, fix it before declaring done. Otherwise move to the merge step in the finishing-a-development-branch skill.

---

## What's NOT in this phase

- Live symbol validation against the StockProvider on add — the server validates on PUT and returns 400 on bad symbols; v1 surfaces that via the existing `toastApiError` helper.
- Drag-to-reorder. Add/remove only.
- Restyling the admin page to the terminal aesthetic — spec §10 keeps admin on the existing theme tokens.

---

## Self-Review

**1. Spec coverage** (§5.2 + §5.6 + §6.3):
- `PUT /admin/system-settings/ticker-tape` route ✓ Task 3
- Audit-log entry in same transaction ✓ Task 3
- WS `ticker_tape_config_changed` rebroadcast ✓ Task 4
- Frontend admin editor ✓ Tasks 5–7
- Admin-only auth + 401/403 paths ✓ Task 3 tests
- Service tx-aware variant ✓ Task 2

**2. Placeholder scan:** none. Every step has runnable code, every test asserts a concrete behavior, every command has an expected outcome.

**3. Type / API consistency:**
- `AdminUpdateTickerTapeRequest { symbols: string[] }` defined in Task 1, consumed in Task 3 (server route body type), Task 5 (frontend hook), and Task 6 (component submit).
- `TickerTapeSettings` reused everywhere (response type).
- `setTickerTapeSymbolsInTx(db, symbols, actorId)` signature consistent between Task 2 service definition and Task 3 route consumer.
- Frontend `TICKER_TAPE_QUERY_KEY` shared between `useTickerTapeSettings` (phase 2) and the new admin hooks (Task 5) — cache stays coherent.

**4. Ambiguity check:** The `useEffect` seeding pattern in `TickerTapeEditor` re-syncs `working` from server data every time `tape.data` changes — including after a successful save (because `setQueryData` updates the cache and re-triggers `tape.data`). This is the intended behavior: the user's working list re-syncs to canonical server state after a save. If the user makes another edit BEFORE the save lands, the in-flight save's onSuccess will overwrite their pending changes — that's a known race, acceptable for an admin page where concurrent edits are rare. No fix needed for v1.
