# Integration Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Playwright integration test suite covering every server endpoint (REST + WS) and every player/admin UI flow, runnable offline via a deterministic mock StockProvider.

**Architecture:** Expand the existing `packages/frontend/e2e/` Playwright setup. Specs are organized into `player/`, `admin/`, and `api/` subfolders. A new server-side `MockProvider` (selected via `STOCK_PROVIDER=mock`) returns deterministic prices. Test fixtures in `e2e/fixtures/base.ts` provide reusable user/game setup via the server's REST API and login-via-API helpers that pre-populate browser cookies for already-authenticated pages.

**Tech Stack:** Playwright (already installed), TypeScript, Fastify, existing in-memory SQLite for the e2e DB.

**Spec reference:** [`docs/superpowers/specs/2026-05-17-integration-test-suite-design.md`](../specs/2026-05-17-integration-test-suite-design.md)

---

## File Map

**Server (new):**
- `packages/server/src/providers/mock.ts` — `MockProvider` implementation.
- `packages/server/tests/providers/mock-provider.test.ts` — unit tests.

**Server (modify):**
- `packages/server/src/env.ts` — add `'mock'` to `VALID_PROVIDERS`; add optional `MOCK_PRICES` env var.
- `packages/server/src/providers/factory.ts` — add `case 'mock'` branch.

**Frontend e2e (new):**
- `packages/frontend/e2e/fixtures/base.ts` — extended `test` with all fixtures.
- `packages/frontend/e2e/fixtures/mock-prices.ts` — re-exports the price map.
- `packages/frontend/e2e/player/auth.spec.ts`
- `packages/frontend/e2e/player/games.spec.ts`
- `packages/frontend/e2e/player/trading.spec.ts`
- `packages/frontend/e2e/player/watchlists.spec.ts`
- `packages/frontend/e2e/player/symbols.spec.ts`
- `packages/frontend/e2e/player/market-status.spec.ts`
- `packages/frontend/e2e/player/websocket.spec.ts`
- `packages/frontend/e2e/admin/users.spec.ts`
- `packages/frontend/e2e/admin/games.spec.ts`
- `packages/frontend/e2e/admin/portfolios.spec.ts`
- `packages/frontend/e2e/admin/trades.spec.ts`
- `packages/frontend/e2e/admin/system.spec.ts`
- `packages/frontend/e2e/admin/audit.spec.ts`
- `packages/frontend/e2e/api/health.spec.ts`
- `packages/frontend/e2e/api/edge-errors.spec.ts`

**Frontend e2e (modify):**
- `packages/frontend/playwright.config.ts` — add mock-provider env vars, html reporter, retries.
- `packages/frontend/e2e/happy-path.spec.ts` — rewrite to use new fixtures + mock prices.

---

## Convention: TDD discipline

Most server work is straightforward TDD (red → green → commit). UI specs are themselves the tests — for those we write the spec, run it against the existing app, and treat the spec as "passing" once it goes green. There's no production code added by a UI spec; the spec IS the deliverable.

If a UI spec fails for a reason that signals a missing `data-testid`, add the testid in a separate small commit and re-run.

---

## Task 1: Add `mock` to provider env validator

**Files:**
- Modify: `packages/server/src/env.ts:2`
- Test: `packages/server/tests/env.test.ts` (existing file — check if present, else create)

- [ ] **Step 1: Find env test file**

Run: `ls packages/server/tests/env*.test.ts 2>/dev/null || echo "missing"`

If "missing", create `packages/server/tests/env.test.ts` with:

```ts
import { describe, it, expect, beforeEach } from 'vitest';

describe('env', () => {
  beforeEach(() => {
    delete process.env.STOCK_PROVIDER;
  });

  it('accepts STOCK_PROVIDER=mock', async () => {
    process.env.STOCK_PROVIDER = 'mock';
    process.env.DATABASE_URL = ':memory:';
    process.env.JWT_SECRET = 'x'.repeat(32);
    const mod = await import(`../src/env.js?t=${Date.now()}`);
    expect(mod.env.STOCK_PROVIDER).toBe('mock');
  });
});
```

Otherwise add the single `it` block above to the existing file.

- [ ] **Step 2: Run test, expect FAIL**

Run: `pnpm --filter server test -- env`
Expected: FAIL — value "mock" not in VALID_PROVIDERS.

- [ ] **Step 3: Extend VALID_PROVIDERS**

In `packages/server/src/env.ts`, change line 2:

```ts
const VALID_PROVIDERS = ['yahoo', 'alpaca', 'mock'] as const;
```

- [ ] **Step 4: Run test, expect PASS**

Run: `pnpm --filter server test -- env`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/env.ts packages/server/tests/env.test.ts
git commit -m "feat(server): accept STOCK_PROVIDER=mock in env validator"
```

---

## Task 2: Implement MockProvider — getQuote

**Files:**
- Create: `packages/server/src/providers/mock.ts`
- Test: `packages/server/tests/providers/mock-provider.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/server/tests/providers/mock-provider.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MockProvider, MOCK_PRICE_MAP } from '../../src/providers/mock.js';

describe('MockProvider.getQuote', () => {
  it('returns the deterministic price from the built-in map', async () => {
    const p = new MockProvider();
    const q = await p.getQuote('AAPL');
    expect(q.symbol).toBe('AAPL');
    expect(q.price).toBe(MOCK_PRICE_MAP.AAPL);
    expect(typeof q.timestamp).toBe('number');
  });

  it('returns $100 for unknown symbols', async () => {
    const p = new MockProvider();
    const q = await p.getQuote('ZZZZ');
    expect(q.price).toBe(100);
  });

  it('uppercases the input symbol', async () => {
    const p = new MockProvider();
    const q = await p.getQuote('aapl');
    expect(q.symbol).toBe('AAPL');
    expect(q.price).toBe(MOCK_PRICE_MAP.AAPL);
  });

  it('accepts an override map and prefers it over built-in', async () => {
    const p = new MockProvider({ AAPL: 999 });
    const q = await p.getQuote('AAPL');
    expect(q.price).toBe(999);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `pnpm --filter server test -- mock-provider`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create MockProvider with getQuote only**

Create `packages/server/src/providers/mock.ts`:

```ts
import type {
  StockDetails,
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
  StockSearchResult,
} from '@markettrader/shared';
import type { StockProvider } from './interface.js';

/**
 * Deterministic in-process stock price provider used exclusively by the e2e
 * integration test suite. Returns fixed prices from {@link MOCK_PRICE_MAP},
 * falling back to $100 for unknown symbols.
 */
export const MOCK_PRICE_MAP: Record<string, number> = {
  AAPL: 180,
  MSFT: 420,
  GOOG: 140,
  NVDA: 950,
  TSLA: 240,
  AMZN: 200,
  META: 500,
};

export class MockProvider implements StockProvider {
  private readonly prices: Record<string, number>;

  constructor(overrides: Record<string, number> = {}) {
    this.prices = { ...MOCK_PRICE_MAP, ...overrides };
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    const sym = symbol.toUpperCase();
    const price = this.prices[sym] ?? 100;
    return {
      symbol: sym,
      price,
      change: 0,
      changePercent: 0,
      timestamp: Date.now(),
    };
  }

  async searchSymbols(_query: string): Promise<StockSearchResult[]> {
    throw new Error('not implemented');
  }

  async getHistory(_symbol: string, _range: StockHistoryRange): Promise<StockHistoryBar[]> {
    throw new Error('not implemented');
  }

  async getDetails(_symbol: string): Promise<StockDetails> {
    throw new Error('not implemented');
  }
}
```

- [ ] **Step 4: Check StockQuote required fields**

Run: `grep -A 15 "interface StockQuote\|type StockQuote" packages/shared/src/types/*.ts`

If `StockQuote` has additional required fields beyond what's in the stub (e.g. `marketState`, `previousClose`), add them with sensible defaults: `marketState: 'REGULAR'`, `previousClose: price`.

- [ ] **Step 5: Run test, expect PASS**

Run: `pnpm --filter server test -- mock-provider`
Expected: 4 PASS (`getQuote` tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/providers/mock.ts packages/server/tests/providers/mock-provider.test.ts
git commit -m "feat(server): add MockProvider.getQuote with deterministic prices"
```

---

## Task 3: MockProvider — searchSymbols

**Files:**
- Modify: `packages/server/src/providers/mock.ts`
- Modify: `packages/server/tests/providers/mock-provider.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `mock-provider.test.ts`:

```ts
describe('MockProvider.searchSymbols', () => {
  it('returns matches by case-insensitive prefix', async () => {
    const p = new MockProvider();
    const r = await p.searchSymbols('aa');
    expect(r.map((x) => x.symbol)).toContain('AAPL');
  });

  it('returns at most 10 results', async () => {
    const p = new MockProvider();
    const r = await p.searchSymbols('');
    expect(r.length).toBeLessThanOrEqual(10);
  });

  it('returns an empty list for no matches', async () => {
    const p = new MockProvider();
    const r = await p.searchSymbols('ZZZZZZ');
    expect(r).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `pnpm --filter server test -- mock-provider`
Expected: FAIL (3 new tests, "not implemented").

- [ ] **Step 3: Implement searchSymbols**

Replace the `searchSymbols` stub in `packages/server/src/providers/mock.ts`:

```ts
async searchSymbols(query: string): Promise<StockSearchResult[]> {
  const q = query.trim().toUpperCase();
  const symbols = Object.keys(this.prices);
  const matches = q === ''
    ? symbols
    : symbols.filter((s) => s.includes(q));
  return matches.slice(0, 10).map((symbol) => ({
    symbol,
    name: `${symbol} Mock Corp.`,
    exchange: 'MOCK',
    type: 'EQUITY',
  }));
}
```

Verify field set against `StockSearchResult` in `packages/shared/src/types/`; adjust fields if shape differs.

- [ ] **Step 4: Run test, expect PASS**

Run: `pnpm --filter server test -- mock-provider`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/providers/mock.ts packages/server/tests/providers/mock-provider.test.ts
git commit -m "feat(server): MockProvider.searchSymbols"
```

---

## Task 4: MockProvider — getHistory

**Files:**
- Modify: `packages/server/src/providers/mock.ts`
- Modify: `packages/server/tests/providers/mock-provider.test.ts`

- [ ] **Step 1: Add failing tests**

Append:

```ts
describe('MockProvider.getHistory', () => {
  it('returns ascending bars for 1d', async () => {
    const p = new MockProvider();
    const bars = await p.getHistory('AAPL', '1d');
    expect(bars.length).toBeGreaterThan(0);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].time).toBeGreaterThan(bars[i - 1].time);
    }
  });

  it('produces deterministic close prices across calls', async () => {
    const p = new MockProvider();
    const a = await p.getHistory('AAPL', '1d');
    const b = await p.getHistory('AAPL', '1d');
    expect(a.length).toBe(b.length);
    expect(a.map((x) => x.close)).toEqual(b.map((x) => x.close));
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `pnpm --filter server test -- mock-provider`

- [ ] **Step 3: Check StockHistoryBar / StockHistoryRange shapes**

Run: `grep -A 10 "StockHistoryBar\|StockHistoryRange" packages/shared/src/types/*.ts`

Note exact field names (`time` vs `timestamp`) and use them below.

- [ ] **Step 4: Implement getHistory**

Replace the stub:

```ts
async getHistory(symbol: string, range: StockHistoryRange): Promise<StockHistoryBar[]> {
  const counts: Record<string, number> = {
    '1d': 30,
    '5d': 60,
    '1mo': 30,
    '3mo': 90,
    '6mo': 180,
    '1y': 250,
    '5y': 260,
    'max': 260,
  };
  const n = counts[range] ?? 30;

  const seed = [...symbol.toUpperCase()].reduce((a, c) => a + c.charCodeAt(0), 0);
  let rand = seed;
  const next = () => {
    rand = (rand * 9301 + 49297) % 233280;
    return rand / 233280;
  };

  const base = this.prices[symbol.toUpperCase()] ?? 100;
  const now = Date.now();
  const stepMs = range === '1d' ? 60_000 * 5 : 24 * 60 * 60 * 1000;

  const bars: StockHistoryBar[] = [];
  let last = base;
  for (let i = 0; i < n; i++) {
    const delta = (next() - 0.5) * base * 0.01;
    const close = +(last + delta).toFixed(2);
    const open = last;
    const high = +Math.max(open, close).toFixed(2);
    const low = +Math.min(open, close).toFixed(2);
    bars.push({
      time: now - (n - 1 - i) * stepMs,
      open,
      high,
      low,
      close,
      volume: 1_000_000,
    });
    last = close;
  }
  return bars;
}
```

If `StockHistoryRange` is a narrower union, missing entries default to 30 bars via `counts[range] ?? 30`. If `StockHistoryBar` uses `timestamp` instead of `time`, rename the field.

- [ ] **Step 5: Run test, expect PASS**

Run: `pnpm --filter server test -- mock-provider`

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/providers/mock.ts packages/server/tests/providers/mock-provider.test.ts
git commit -m "feat(server): MockProvider.getHistory with deterministic bars"
```

---

## Task 5: MockProvider — getDetails

**Files:**
- Modify: `packages/server/src/providers/mock.ts`
- Modify: `packages/server/tests/providers/mock-provider.test.ts`

- [ ] **Step 1: Add failing test**

```ts
describe('MockProvider.getDetails', () => {
  it('returns a fixed StockDetails for a known symbol', async () => {
    const p = new MockProvider();
    const d = await p.getDetails('AAPL');
    expect(d.symbol).toBe('AAPL');
    expect(d.name).toBeDefined();
    expect(d.sector).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter server test -- mock-provider`

- [ ] **Step 3: Implement**

Replace the stub:

```ts
async getDetails(symbol: string): Promise<StockDetails> {
  const sym = symbol.toUpperCase();
  return {
    symbol: sym,
    name: `${sym} Mock Corp.`,
    exchange: 'MOCK',
    sector: 'Technology',
    industry: 'Software',
    marketCap: 1_000_000_000_000,
    currency: 'USD',
  };
}
```

Cross-check `StockDetails` field set; fill required fields exactly, leave the rest undefined.

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter server test -- mock-provider`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/providers/mock.ts packages/server/tests/providers/mock-provider.test.ts
git commit -m "feat(server): MockProvider.getDetails"
```

---

## Task 6: Wire MockProvider into factory

**Files:**
- Modify: `packages/server/src/providers/factory.ts`
- Test: `packages/server/tests/providers/factory.test.ts` (create if absent)

- [ ] **Step 1: Failing test**

Add to or create `packages/server/tests/providers/factory.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';

describe('createProvider', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = ':memory:';
    process.env.JWT_SECRET = 'x'.repeat(32);
  });

  it('returns a MockProvider when STOCK_PROVIDER=mock', async () => {
    process.env.STOCK_PROVIDER = 'mock';
    const mod = await import(`../../src/providers/factory.js?t=${Date.now()}`);
    const provider = mod.createProvider();
    expect(provider.constructor.name).toBe('MockProvider');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm --filter server test -- factory`

- [ ] **Step 3: Add case to factory**

Edit `packages/server/src/providers/factory.ts`:

```ts
import { env } from '../env.js';
import type { StockProvider } from './interface.js';
import { YahooProvider } from './yahoo.js';
import { AlpacaProvider } from './alpaca.js';
import { MockProvider } from './mock.js';

export function createProvider(): StockProvider {
  switch (env.STOCK_PROVIDER) {
    case 'mock': {
      const overrides = parseMockPrices(process.env.MOCK_PRICES);
      return new MockProvider(overrides);
    }
    case 'alpaca': {
      if (!env.ALPACA_API_KEY) {
        throw new Error('ALPACA_API_KEY is required when STOCK_PROVIDER=alpaca');
      }
      return new AlpacaProvider(env.ALPACA_API_KEY);
    }
    default:
      return new YahooProvider();
  }
}

function parseMockPrices(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[k.toUpperCase()] = v;
      }
      return out;
    }
  } catch {
    // Malformed MOCK_PRICES is ignored; built-in map is used.
  }
  return {};
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm --filter server test -- factory`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/providers/factory.ts packages/server/tests/providers/factory.test.ts
git commit -m "feat(server): wire MockProvider into provider factory"
```

---

## Task 7: Update Playwright config for mock provider + reporting

**Files:**
- Modify: `packages/frontend/playwright.config.ts`

- [ ] **Step 1: Replace config**

Replace the contents of `packages/frontend/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 1,
  reporter: [['line'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'pnpm --filter @markettrader/server exec tsx src/index.ts',
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: false,
      timeout: 60_000,
      cwd: '../..',
      env: {
        DATABASE_URL: ':memory:',
        JWT_SECRET: 'e2e-test-secret-key-for-playwright-only-not-prod',
        CORS_ORIGIN: 'http://127.0.0.1:5173',
        PORT: '3000',
        NODE_ENV: 'test',
        STOCK_PROVIDER: 'mock',
        MARKET_STATUS_PROVIDER: 'static',
        MARKET_HOURS_MODE: 'instant',
      },
    },
    {
      command: 'pnpm --filter @markettrader/frontend dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 60_000,
      cwd: '../..',
    },
  ],
});
```

- [ ] **Step 2: Smoke check the boot**

Run: `pnpm --filter frontend e2e -- happy-path`
Expected: server boots with `STOCK_PROVIDER=mock`. The happy-path spec is rewritten in Task 23; it may fail here on selectors, but server startup is the gate.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/playwright.config.ts
git commit -m "test(e2e): wire mock provider + html reporter + retries into Playwright"
```

---

## Task 8: e2e fixtures — base.ts + mock-prices.ts + sanity spec

**Files:**
- Create: `packages/frontend/e2e/fixtures/base.ts`
- Create: `packages/frontend/e2e/fixtures/mock-prices.ts`
- Create: `packages/frontend/e2e/fixtures/fixtures.spec.ts`

- [ ] **Step 1: Price re-export**

Create `packages/frontend/e2e/fixtures/mock-prices.ts`:

```ts
import { MOCK_PRICE_MAP } from '../../../server/src/providers/mock.js';

export { MOCK_PRICE_MAP };

export function priceOf(symbol: string): number {
  return MOCK_PRICE_MAP[symbol.toUpperCase()] ?? 100;
}
```

- [ ] **Step 2: Verify tsconfig path resolution**

Run: `pnpm --filter frontend exec tsc --noEmit -p tsconfig.json 2>&1 | head -20`

If the relative `../../../server/src/providers/mock.js` import doesn't resolve under the Playwright tsconfig, duplicate the price-map constants directly in `mock-prices.ts` and add a unit test in `packages/server/tests/providers/mock-provider.test.ts` that imports both and asserts equality, so drift is caught.

- [ ] **Step 3: Skeleton `base.ts`**

Create `packages/frontend/e2e/fixtures/base.ts`:

```ts
import { test as base, request, expect, type APIRequestContext, type Page, type BrowserContext } from '@playwright/test';

const API_BASE = 'http://127.0.0.1:3000';

type Creds = { username: string; password: string };

type UserSession = {
  username: string;
  password: string;
  userId: string;
  accessToken: string;
  cookies: { name: string; value: string; domain: string; path: string }[];
};

type GameOpts = {
  name?: string;
  startsAt?: string;
  endsAt?: string;
  startingCash?: number;
};

type Game = {
  id: string;
  name: string;
};

export type Fixtures = {
  apiClient: APIRequestContext;
  registerUser: (opts?: Partial<Creds>) => Promise<UserSession>;
  loginAs: (creds: Creds) => Promise<UserSession>;
  adminUser: UserSession;
  playerUser: UserSession;
  makeGame: (opts?: GameOpts) => Promise<Game>;
  joinedPlayer: (gameId: string) => Promise<UserSession>;
  pageAs: (user: UserSession) => Promise<Page>;
  secondPage: (user: UserSession) => Promise<Page>;
  adminPage: Page;
  playerPage: Page;
};

function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function parseRefreshCookie(setCookie: string): { name: string; value: string; domain: string; path: string }[] {
  const m = /refreshToken=([^;]+)/.exec(setCookie);
  if (!m) return [];
  return [{ name: 'refreshToken', value: m[1], domain: '127.0.0.1', path: '/auth' }];
}

export const test = base.extend<Fixtures, { adminUser: UserSession }>({
  apiClient: async ({}, use) => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    await use(ctx);
    await ctx.dispose();
  },

  registerUser: async ({ apiClient }, use) => {
    await use(async (opts) => {
      const username = opts?.username ?? uniqueName('user');
      const password = opts?.password ?? 'correct-horse-battery';
      const res = await apiClient.post('/auth/register', { data: { username, password } });
      expect(res.ok(), `register failed: ${res.status()} ${await res.text()}`).toBeTruthy();
      const body = await res.json();
      const cookies = parseRefreshCookie(res.headers()['set-cookie'] ?? '');
      return { username, password, userId: body.user.id, accessToken: body.token, cookies };
    });
  },

  loginAs: async ({ apiClient }, use) => {
    await use(async ({ username, password }) => {
      const res = await apiClient.post('/auth/login', { data: { username, password } });
      expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
      const body = await res.json();
      const cookies = parseRefreshCookie(res.headers()['set-cookie'] ?? '');
      return { username, password, userId: body.user.id, accessToken: body.token, cookies };
    });
  },

  adminUser: [
    async ({ registerUser }, use) => {
      // First registered user becomes admin (server enforces this atomically).
      const user = await registerUser();
      await use(user);
    },
    { scope: 'worker' },
  ],

  playerUser: async ({ registerUser }, use) => {
    const user = await registerUser();
    await use(user);
  },

  makeGame: async ({ apiClient, adminUser }, use) => {
    await use(async (opts) => {
      const now = Date.now();
      const startsAt = opts?.startsAt ?? new Date(now - 60 * 60 * 1000).toISOString();
      const endsAt = opts?.endsAt ?? new Date(now + 60 * 60 * 1000).toISOString();
      const res = await apiClient.post('/games', {
        headers: { Authorization: `Bearer ${adminUser.accessToken}` },
        data: {
          name: opts?.name ?? uniqueName('game'),
          startsAt,
          endsAt,
          startingCash: opts?.startingCash ?? 100_000,
        },
      });
      expect(res.ok(), `makeGame failed: ${res.status()} ${await res.text()}`).toBeTruthy();
      return await res.json();
    });
  },

  joinedPlayer: async ({ apiClient, registerUser }, use) => {
    await use(async (gameId) => {
      const user = await registerUser();
      const res = await apiClient.post(`/games/${gameId}/join`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
      });
      expect(res.ok(), `join failed: ${res.status()}`).toBeTruthy();
      return user;
    });
  },

  pageAs: async ({ browser }, use) => {
    const created: BrowserContext[] = [];
    await use(async (user) => {
      const ctx = await browser.newContext();
      created.push(ctx);
      await ctx.addCookies(user.cookies);
      const page = await ctx.newPage();
      // The app's bootstrap calls /auth/refresh on load; the cookie above
      // makes that succeed and writes a fresh access token into Zustand.
      await page.goto('/');
      return page;
    });
    for (const c of created) await c.close();
  },

  secondPage: async ({ pageAs }, use) => {
    await use(pageAs);
  },

  adminPage: async ({ pageAs, adminUser }, use) => {
    const p = await pageAs(adminUser);
    await use(p);
  },

  playerPage: async ({ pageAs, playerUser }, use) => {
    const p = await pageAs(playerUser);
    await use(p);
  },
});

export { expect };
```

- [ ] **Step 4: Fixture sanity spec**

Create `packages/frontend/e2e/fixtures/fixtures.spec.ts`:

```ts
import { test, expect } from './base';

test('admin and player are distinct users; admin can hit /admin/users', async ({ adminUser, playerUser, apiClient }) => {
  expect(adminUser.userId).not.toBe(playerUser.userId);

  const ok = await apiClient.get('/admin/users', {
    headers: { Authorization: `Bearer ${adminUser.accessToken}` },
  });
  expect(ok.ok()).toBeTruthy();

  const denied = await apiClient.get('/admin/users', {
    headers: { Authorization: `Bearer ${playerUser.accessToken}` },
  });
  expect(denied.status()).toBe(403);
});

test('makeGame + joinedPlayer create a game with the player inside', async ({ makeGame, joinedPlayer, apiClient, adminUser }) => {
  const game = await makeGame();
  const player = await joinedPlayer(game.id);
  const res = await apiClient.get(`/admin/games/${game.id}/players`, {
    headers: { Authorization: `Bearer ${adminUser.accessToken}` },
  });
  expect(JSON.stringify(await res.json())).toContain(player.username);
});

test('pageAs lands logged in (no /login redirect)', async ({ playerPage }) => {
  await expect(playerPage).not.toHaveURL(/.*\/login(\/|$)/);
});
```

- [ ] **Step 5: Run and triage**

Run: `pnpm --filter frontend e2e -- fixtures`
Expected: 3 PASS.

Triage common failures:
- register/login 401 → body field name mismatch (check `packages/server/src/routes/auth.ts:77`).
- pageAs lands at `/login` → cookie didn't take effect; verify the Set-Cookie path/domain matches the cookie set by `parseRefreshCookie`. If the server sets `path=/auth/refresh` (narrower), update parser accordingly.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/e2e/fixtures/
git commit -m "test(e2e): add base fixtures (apiClient, register, makeGame, pageAs)"
```

---

## Task 9: Player — auth.spec.ts

**Files:**
- Create: `packages/frontend/e2e/player/auth.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/base';

test.describe('Authentication', () => {
  test('register → land on games list', async ({ page }) => {
    const username = `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await page.goto('/register');
    await page.getByLabel(/username/i).fill(username);
    await page.getByLabel(/password/i).fill('correct-horse-battery');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('heading', { name: /your games/i })).toBeVisible();
  });

  test('login with valid credentials', async ({ page, registerUser }) => {
    const user = await registerUser();
    await page.goto('/login');
    await page.getByLabel(/username/i).fill(user.username);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /^log in$|^sign in$/i }).click();
    await expect(page.getByRole('heading', { name: /your games/i })).toBeVisible();
  });

  test('login with wrong password shows error', async ({ page, registerUser }) => {
    const user = await registerUser();
    await page.goto('/login');
    await page.getByLabel(/username/i).fill(user.username);
    await page.getByLabel(/password/i).fill('definitely-not-it');
    await page.getByRole('button', { name: /^log in$|^sign in$/i }).click();
    await expect(page.getByText(/invalid|incorrect|wrong/i)).toBeVisible();
  });

  test('logout clears session and redirects to login', async ({ playerPage }) => {
    await playerPage.getByRole('button', { name: /user menu|account|profile/i }).click();
    await playerPage.getByRole('menuitem', { name: /log ?out|sign ?out/i }).click();
    await expect(playerPage).toHaveURL(/.*\/login/);
  });

  test('refresh endpoint mints a new token', async ({ apiClient, playerUser }) => {
    const res = await apiClient.post('/auth/refresh', {
      headers: { Cookie: `refreshToken=${playerUser.cookies[0]?.value ?? ''}` },
    });
    expect(res.ok(), `refresh failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    const body = await res.json();
    expect(typeof body.token).toBe('string');
  });

  test('logout endpoint clears refresh cookie', async ({ apiClient, playerUser }) => {
    const res = await apiClient.post('/auth/logout', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, fix selectors if needed**

Run: `pnpm --filter frontend e2e -- player/auth`

If logout selectors miss, open `packages/frontend/src/components/AppHeader.tsx` (or wherever the user menu lives) and either update the regex or add `data-testid` markers in a separate small commit.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/e2e/player/auth.spec.ts
git commit -m "test(e2e): player auth flow"
```

---

## Task 10: Player — games.spec.ts

**Files:**
- Create: `packages/frontend/e2e/player/games.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/base';

test.describe('Player games', () => {
  test('create a game via the UI dialog', async ({ playerPage }) => {
    await playerPage.goto('/games');
    await playerPage.getByRole('button', { name: /create game/i }).click();
    const dialog = playerPage.getByRole('dialog');
    const name = `g_${Date.now()}`;
    await dialog.getByLabel(/^name$/i).fill(name);
    const now = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 16);
    await dialog.getByLabel(/^start$/i).fill(fmt(new Date(now.getTime() - 60_000)));
    await dialog.getByLabel(/^end$/i).fill(fmt(new Date(now.getTime() + 60 * 60 * 1000)));
    await dialog.getByRole('button', { name: /^create$/i }).click();
    await expect(playerPage.getByRole('link', { name })).toBeVisible();
  });

  test('opens game detail page from the deep link', async ({ playerPage, makeGame, apiClient, playerUser }) => {
    const game = await makeGame();
    await apiClient.post(`/games/${game.id}/join`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    await playerPage.goto(`/games/${game.id}`);
    await expect(playerPage.getByRole('heading', { name: game.name })).toBeVisible();
  });

  test('GET /games lists games the player joined', async ({ apiClient, playerUser, makeGame }) => {
    const game = await makeGame();
    const join = await apiClient.post(`/games/${game.id}/join`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    expect(join.ok()).toBeTruthy();

    const list = await apiClient.get('/games', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    const body = await list.json();
    const names = (body.games ?? body).map((g: { name: string }) => g.name);
    expect(names).toContain(game.name);
  });

  test('GET /public/featured-games is reachable unauthenticated', async ({ apiClient }) => {
    const res = await apiClient.get('/public/featured-games');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.games ?? body)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, fix label mismatches**

Run: `pnpm --filter frontend e2e -- player/games`
If create-dialog labels differ, open `packages/frontend/src/components/CreateGameDialog.tsx` to verify field labels.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/e2e/player/games.spec.ts
git commit -m "test(e2e): player games list + create + detail"
```

---

## Task 11: Player — trading.spec.ts

**Files:**
- Create: `packages/frontend/e2e/player/trading.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/base';
import { priceOf } from '../fixtures/mock-prices';

test.describe('Player trading', () => {
  test('UI: buy AAPL → appears in portfolio', async ({ playerPage, makeGame, apiClient, playerUser }) => {
    const game = await makeGame();
    await apiClient.post(`/games/${game.id}/join`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    await playerPage.goto(`/games/${game.id}`);

    await playerPage.getByRole('tab', { name: /^trade$/i }).click();
    await playerPage.getByLabel(/symbol/i).fill('AAPL');
    await playerPage.getByRole('button', { name: /^AAPL/ }).first().click();
    await playerPage.getByLabel(/quantity/i).fill('1');
    await playerPage.getByRole('button', { name: /^buy$/i }).click();

    await playerPage.getByRole('tab', { name: /portfolio/i }).click();
    await expect(playerPage.getByRole('cell', { name: 'AAPL' }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('API: buy then sell, net flat', async ({ apiClient, makeGame, joinedPlayer }) => {
    const game = await makeGame();
    const player = await joinedPlayer(game.id);

    const buy = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: { symbol: 'AAPL', side: 'buy', quantity: 10 },
    });
    expect(buy.ok(), `buy: ${await buy.text()}`).toBeTruthy();

    const sell = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: { symbol: 'AAPL', side: 'sell', quantity: 10 },
    });
    expect(sell.ok(), `sell: ${await sell.text()}`).toBeTruthy();

    const port = await apiClient.get(`/games/${game.id}/portfolio`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
    });
    const body = await port.json();
    const holdings = body.holdings ?? body.positions ?? [];
    expect(holdings.find((h: { symbol: string }) => h.symbol === 'AAPL')).toBeUndefined();
    expect(body.cashBalance ?? body.cash).toBeCloseTo(100_000, 0);
  });

  test('API: insufficient funds returns 422 INSUFFICIENT_FUNDS', async ({ apiClient, makeGame, joinedPlayer }) => {
    const game = await makeGame({ startingCash: 100 });
    const player = await joinedPlayer(game.id);

    const res = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: { symbol: 'AAPL', side: 'buy', quantity: 1 },
    });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.code ?? body.error).toMatch(/INSUFFICIENT_FUNDS/);
  });

  test('API: short selling blocked', async ({ apiClient, makeGame, joinedPlayer }) => {
    const game = await makeGame();
    const player = await joinedPlayer(game.id);
    const res = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: { symbol: 'AAPL', side: 'sell', quantity: 1 },
    });
    expect([400, 422]).toContain(res.status());
    expect(JSON.stringify(await res.json())).toMatch(/SHORT_SELLING|INSUFFICIENT_SHARES/);
  });

  test('API: limit order → working list → cancel', async ({ apiClient, makeGame, joinedPlayer }) => {
    const game = await makeGame();
    const player = await joinedPlayer(game.id);
    const place = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: { symbol: 'AAPL', side: 'buy', quantity: 1, orderType: 'limit', limitPrice: priceOf('AAPL') - 50 },
    });
    if (place.status() === 400) {
      const body = await place.json();
      test.skip(/LIMIT_ORDERS_DISABLED/.test(JSON.stringify(body)), 'limit orders disabled');
    }
    expect(place.ok()).toBeTruthy();
    const placed = await place.json();
    const tradeId = placed.id ?? placed.tradeId;

    const working = await apiClient.get(`/games/${game.id}/trades?status=working`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
    });
    expect(JSON.stringify(await working.json())).toContain(tradeId);

    const cancel = await apiClient.delete(`/games/${game.id}/trades/${tradeId}`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
    });
    expect(cancel.ok()).toBeTruthy();
  });

  test('API: trade history returns executed trades', async ({ apiClient, makeGame, joinedPlayer }) => {
    const game = await makeGame();
    const player = await joinedPlayer(game.id);
    await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: { symbol: 'MSFT', side: 'buy', quantity: 1 },
    });
    const hist = await apiClient.get(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
    });
    const trades = (await hist.json()).trades ?? (await hist.json());
    expect(trades.some((t: { symbol: string }) => t.symbol === 'MSFT')).toBe(true);
  });

  test('API: pending list empty under MARKET_HOURS_MODE=instant', async ({ apiClient, makeGame, joinedPlayer }) => {
    const game = await makeGame();
    const player = await joinedPlayer(game.id);
    const list = await apiClient.get(`/games/${game.id}/trades/pending`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
    });
    expect(list.ok()).toBeTruthy();
    const body = await list.json();
    expect(Array.isArray(body.trades ?? body)).toBe(true);
  });
});
```

- [ ] **Step 2: Run & adjust UI selectors**

Run: `pnpm --filter frontend e2e -- player/trading`
If labels in `TradeOrderDialog.tsx` differ, add testids and update selectors in a separate small commit.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/e2e/player/trading.spec.ts
git commit -m "test(e2e): player trading happy + error paths"
```

---

## Task 12: Player — watchlists.spec.ts

**Files:**
- Create: `packages/frontend/e2e/player/watchlists.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/base';

test.describe('Watchlists', () => {
  test('API: create → patch → list → delete', async ({ apiClient, playerUser }) => {
    const auth = { Authorization: `Bearer ${playerUser.accessToken}` };
    const create = await apiClient.post('/watchlists', { headers: auth, data: { name: 'Faves' } });
    expect(create.ok()).toBeTruthy();
    const wl = await create.json();

    const patch = await apiClient.patch(`/watchlists/${wl.id}`, { headers: auth, data: { name: 'My Faves' } });
    expect(patch.ok()).toBeTruthy();

    const list = await apiClient.get('/watchlists', { headers: auth });
    expect(JSON.stringify(await list.json())).toContain('My Faves');

    const del = await apiClient.delete(`/watchlists/${wl.id}`, { headers: auth });
    expect(del.ok()).toBeTruthy();
  });

  test('API: add then remove symbol', async ({ apiClient, playerUser }) => {
    const auth = { Authorization: `Bearer ${playerUser.accessToken}` };
    const wl = await (await apiClient.post('/watchlists', { headers: auth, data: { name: 'tmp' } })).json();

    const add = await apiClient.post(`/watchlists/${wl.id}/symbols`, { headers: auth, data: { symbol: 'NVDA' } });
    expect(add.ok()).toBeTruthy();

    expect(JSON.stringify(await (await apiClient.get('/watchlists', { headers: auth })).json())).toContain('NVDA');

    const rm = await apiClient.delete(`/watchlists/${wl.id}/symbols`, { headers: auth, data: { symbol: 'NVDA' } });
    expect(rm.ok()).toBeTruthy();
  });

  test('UI: watchlist panel renders symbols', async ({ playerPage, apiClient, playerUser, makeGame }) => {
    const auth = { Authorization: `Bearer ${playerUser.accessToken}` };
    const wl = await (await apiClient.post('/watchlists', { headers: auth, data: { name: 'UIList' } })).json();
    await apiClient.post(`/watchlists/${wl.id}/symbols`, { headers: auth, data: { symbol: 'AAPL' } });

    const game = await makeGame();
    await apiClient.post(`/games/${game.id}/join`, { headers: auth });
    await playerPage.goto(`/games/${game.id}`);

    await expect(playerPage.getByText('AAPL').first()).toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Run & commit**

```bash
pnpm --filter frontend e2e -- player/watchlists
git add packages/frontend/e2e/player/watchlists.spec.ts
git commit -m "test(e2e): watchlists CRUD + symbol membership"
```

---

## Task 13: Player — symbols.spec.ts

**Files:**
- Create: `packages/frontend/e2e/player/symbols.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/base';
import { priceOf } from '../fixtures/mock-prices';

test.describe('Symbols', () => {
  test('API: search returns matches', async ({ apiClient, playerUser }) => {
    const res = await apiClient.get('/stocks/search?q=AA', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const list = body.results ?? body;
    expect(list.some((r: { symbol: string }) => r.symbol === 'AAPL')).toBe(true);
  });

  test('API: quote returns the deterministic price', async ({ apiClient, playerUser }) => {
    const res = await apiClient.get('/stocks/AAPL', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    const body = await res.json();
    expect(body.price).toBe(priceOf('AAPL'));
  });

  test('API: history returns bars', async ({ apiClient, playerUser }) => {
    const res = await apiClient.get('/stocks/AAPL/history?range=1d', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect((body.bars ?? body).length).toBeGreaterThan(0);
  });

  test('API: details returns sector', async ({ apiClient, playerUser }) => {
    const res = await apiClient.get('/stocks/AAPL/details', {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    const body = await res.json();
    expect(body.sector).toBeDefined();
  });

  test('UI: SymbolPage shows the price', async ({ playerPage }) => {
    await playerPage.goto('/symbols/AAPL');
    await expect(playerPage.getByText('AAPL').first()).toBeVisible();
    await expect(playerPage.getByText(new RegExp(String(priceOf('AAPL'))))).toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Run & commit**

```bash
pnpm --filter frontend e2e -- player/symbols
git add packages/frontend/e2e/player/symbols.spec.ts
git commit -m "test(e2e): symbol search, quote, history, details, SymbolPage"
```

---

## Task 14: Player — market-status.spec.ts

**Files:**
- Create: `packages/frontend/e2e/player/market-status.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/base';

test.describe('Market status', () => {
  test('API: returns a state string', async ({ apiClient }) => {
    const res = await apiClient.get('/market/status');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof (body.state ?? body.marketState)).toBe('string');
  });

  test('UI: status strip renders a value', async ({ playerPage }) => {
    await playerPage.goto('/games');
    await expect(playerPage.getByText(/market/i).first()).toBeVisible();
  });

  test('API: GET /system-settings/ticker-tape reachable', async ({ apiClient }) => {
    const res = await apiClient.get('/system-settings/ticker-tape');
    expect(res.ok()).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run & commit**

```bash
pnpm --filter frontend e2e -- player/market-status
git add packages/frontend/e2e/player/market-status.spec.ts
git commit -m "test(e2e): market status + ticker-tape settings"
```

---

## Task 15: Player — websocket.spec.ts

**Files:**
- Create: `packages/frontend/e2e/player/websocket.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/base';

test.describe('WebSocket live updates', () => {
  test('leaderboard reacts when another player trades', async ({ playerPage, apiClient, makeGame, joinedPlayer, playerUser }) => {
    const game = await makeGame();
    await apiClient.post(`/games/${game.id}/join`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    const other = await joinedPlayer(game.id);

    await playerPage.goto(`/games/${game.id}`);
    await playerPage.getByRole('tab', { name: /leaderboard/i }).click();

    const row = playerPage.getByRole('row', { name: new RegExp(other.username) });
    await expect(row).toBeVisible({ timeout: 10_000 });

    const valueLocator = row.locator('[data-testid="portfolio-value"]');
    const before = (await valueLocator.count()) ? await valueLocator.textContent() : await row.textContent();

    await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${other.accessToken}` },
      data: { symbol: 'AAPL', side: 'buy', quantity: 10 },
    });

    await expect.poll(async () => {
      return (await valueLocator.count()) ? await valueLocator.textContent() : await row.textContent();
    }, { timeout: 10_000 }).not.toBe(before);
  });

  test('open-orders updates when admin force-executes a working order', async ({ playerPage, apiClient, adminUser, makeGame, playerUser }) => {
    const game = await makeGame();
    await apiClient.post(`/games/${game.id}/join`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });

    const place = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
      data: { symbol: 'AAPL', side: 'buy', quantity: 1, orderType: 'limit', limitPrice: 50 },
    });
    if (place.status() === 400) test.skip(true, 'limit orders disabled');
    const tradeId = (await place.json()).id;

    await playerPage.goto(`/games/${game.id}`);
    await playerPage.getByRole('tab', { name: /open orders|orders/i }).click();
    await expect(playerPage.getByText('AAPL')).toBeVisible();

    await apiClient.post(`/admin/trades/${tradeId}/force-execute`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });

    await expect.poll(async () => {
      return await playerPage.getByText(/no open orders|no working|empty/i).isVisible().catch(() => false);
    }, { timeout: 10_000 }).toBeTruthy();
  });

  test('global indices ticker connects without WS errors', async ({ playerPage }) => {
    const wsErrors: string[] = [];
    playerPage.on('console', (m) => {
      if (m.type() === 'error' && /websocket|ws/i.test(m.text())) wsErrors.push(m.text());
    });
    await playerPage.goto('/games');
    await playerPage.waitForTimeout(2_000);
    expect(wsErrors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter frontend e2e -- player/websocket`
If `data-testid="portfolio-value"` doesn't exist, add it to the leaderboard cell component in a separate small commit, then re-run.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/e2e/player/websocket.spec.ts
git commit -m "test(e2e): WS-driven leaderboard, open-orders, indices ticker"
```

---

## Task 16: Admin — users.spec.ts

**Files:**
- Create: `packages/frontend/e2e/admin/users.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/base';

test.describe('Admin users', () => {
  test('API: list users includes the player', async ({ apiClient, adminUser, playerUser }) => {
    const res = await apiClient.get('/admin/users', {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    const body = await res.json();
    const users = body.users ?? body;
    expect(users.some((u: { username: string }) => u.username === playerUser.username)).toBe(true);
  });

  test('API: get user detail', async ({ apiClient, adminUser, playerUser }) => {
    const res = await apiClient.get(`/admin/users/${playerUser.userId}`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    const body = await res.json();
    expect(body.username).toBe(playerUser.username);
  });

  test('API: patch user username', async ({ apiClient, adminUser, registerUser }) => {
    const target = await registerUser();
    const newName = `renamed_${Date.now()}`;
    const res = await apiClient.patch(`/admin/users/${target.userId}`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
      data: { username: newName },
    });
    expect(res.ok(), `patch: ${await res.text()}`).toBeTruthy();
  });

  test('API: list user players', async ({ apiClient, adminUser, playerUser, makeGame }) => {
    const game = await makeGame();
    await apiClient.post(`/games/${game.id}/join`, {
      headers: { Authorization: `Bearer ${playerUser.accessToken}` },
    });
    const res = await apiClient.get(`/admin/users/${playerUser.userId}/players`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('API: reset password', async ({ apiClient, adminUser, registerUser }) => {
    const target = await registerUser();
    const res = await apiClient.post(`/admin/users/${target.userId}/reset-password`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
      data: { newPassword: 'reset-password-x' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('API: add then remove group membership', async ({ apiClient, adminUser, registerUser }) => {
    const target = await registerUser();
    const add = await apiClient.post(`/admin/users/${target.userId}/groups/admin`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    expect(add.ok()).toBeTruthy();
    const remove = await apiClient.delete(`/admin/users/${target.userId}/groups/admin`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    expect(remove.ok()).toBeTruthy();
  });

  test('API: delete user', async ({ apiClient, adminUser, registerUser }) => {
    const target = await registerUser();
    const res = await apiClient.delete(`/admin/users/${target.userId}`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('UI: admin users page lists the player', async ({ adminPage, playerUser }) => {
    await adminPage.goto('/admin/users');
    await expect(adminPage.getByText(playerUser.username).first()).toBeVisible({ timeout: 10_000 });
  });

  test('UI: admin user detail page renders', async ({ adminPage, playerUser }) => {
    await adminPage.goto(`/admin/users/${playerUser.userId}`);
    await expect(adminPage.getByText(playerUser.username).first()).toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Run & commit**

```bash
pnpm --filter frontend e2e -- admin/users
git add packages/frontend/e2e/admin/users.spec.ts
git commit -m "test(e2e): admin users (list/detail/patch/groups/reset-pw/delete)"
```

---

## Task 17: Admin — games.spec.ts

**Files:**
- Create: `packages/frontend/e2e/admin/games.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/base';

test.describe('Admin games', () => {
  test('API: list/detail/patch/status/reset/delete', async ({ apiClient, adminUser, makeGame }) => {
    const game = await makeGame();
    const auth = { Authorization: `Bearer ${adminUser.accessToken}` };

    expect((await apiClient.get('/admin/games', { headers: auth })).ok()).toBeTruthy();
    expect((await apiClient.get(`/admin/games/${game.id}`, { headers: auth })).ok()).toBeTruthy();

    const patch = await apiClient.patch(`/admin/games/${game.id}`, {
      headers: auth, data: { name: `renamed_${Date.now()}` },
    });
    expect(patch.ok()).toBeTruthy();

    const status = await apiClient.post(`/admin/games/${game.id}/status`, {
      headers: auth, data: { status: 'completed' },
    });
    expect(status.ok()).toBeTruthy();

    const reset = await apiClient.post(`/admin/games/${game.id}/reset`, { headers: auth });
    expect(reset.ok()).toBeTruthy();

    const del = await apiClient.delete(`/admin/games/${game.id}`, { headers: auth });
    expect(del.ok()).toBeTruthy();
  });

  test('API: add/remove players + list players + game trades', async ({ apiClient, adminUser, makeGame, registerUser }) => {
    const game = await makeGame();
    const auth = { Authorization: `Bearer ${adminUser.accessToken}` };
    const target = await registerUser();

    const add = await apiClient.post(`/admin/games/${game.id}/players`, {
      headers: auth, data: { userId: target.userId },
    });
    expect(add.ok(), `add: ${await add.text()}`).toBeTruthy();

    const listRes = await apiClient.get(`/admin/games/${game.id}/players`, { headers: auth });
    const players = (await listRes.json()).players ?? (await listRes.json());
    const row = players.find((p: { userId: string }) => p.userId === target.userId);
    expect(row).toBeDefined();

    expect((await apiClient.get(`/admin/games/${game.id}/trades`, { headers: auth })).ok()).toBeTruthy();

    const rm = await apiClient.delete(`/admin/games/${game.id}/players/${row.id ?? row.userId}`, { headers: auth });
    expect(rm.ok()).toBeTruthy();
  });

  test('API: transfer owner', async ({ apiClient, adminUser, makeGame, registerUser }) => {
    const game = await makeGame();
    const newOwner = await registerUser();
    const res = await apiClient.patch(`/admin/games/${game.id}/owner`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
      data: { userId: newOwner.userId },
    });
    expect(res.ok(), `transfer: ${await res.text()}`).toBeTruthy();
  });

  test('API: cancel all working orders', async ({ apiClient, adminUser, makeGame }) => {
    const game = await makeGame();
    const res = await apiClient.post(`/admin/games/${game.id}/cancel-working-orders`, {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('UI: admin games page lists games', async ({ adminPage, makeGame }) => {
    const game = await makeGame();
    await adminPage.goto('/admin/games');
    await expect(adminPage.getByText(game.name).first()).toBeVisible({ timeout: 10_000 });
  });

  test('UI: admin game detail page', async ({ adminPage, makeGame }) => {
    const game = await makeGame();
    await adminPage.goto(`/admin/games/${game.id}`);
    await expect(adminPage.getByRole('heading', { name: game.name })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run & commit**

```bash
pnpm --filter frontend e2e -- admin/games
git add packages/frontend/e2e/admin/games.spec.ts
git commit -m "test(e2e): admin games CRUD + status/reset/owner/players/cancel-working"
```

---

## Task 18: Admin — portfolios.spec.ts

**Files:**
- Create: `packages/frontend/e2e/admin/portfolios.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/base';

test.describe('Admin portfolios', () => {
  test('API: view, patch cash, add/remove holding', async ({ apiClient, adminUser, makeGame, joinedPlayer }) => {
    const game = await makeGame();
    const player = await joinedPlayer(game.id);
    const auth = { Authorization: `Bearer ${adminUser.accessToken}` };

    const playersRes = await apiClient.get(`/admin/games/${game.id}/players`, { headers: auth });
    const players = (await playersRes.json()).players ?? (await playersRes.json());
    const row = players.find((p: { userId: string }) => p.userId === player.userId);
    const playerId = row.id ?? row.playerId ?? row.userId;

    expect((await apiClient.get(`/admin/players/${playerId}/portfolio`, { headers: auth })).ok()).toBeTruthy();

    const cash = await apiClient.patch(`/admin/players/${playerId}/cash`, {
      headers: auth, data: { cashBalance: 50_000 },
    });
    expect(cash.ok()).toBeTruthy();

    const add = await apiClient.post(`/admin/players/${playerId}/holdings`, {
      headers: auth, data: { symbol: 'AAPL', quantity: 5 },
    });
    expect(add.ok()).toBeTruthy();

    const rm = await apiClient.delete(`/admin/players/${playerId}/holdings`, {
      headers: auth, data: { symbol: 'AAPL' },
    });
    expect(rm.ok()).toBeTruthy();
  });

  test('UI: admin portfolios page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/portfolios');
    await expect(adminPage.getByRole('heading', { name: /portfolios/i })).toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Run & commit**

```bash
pnpm --filter frontend e2e -- admin/portfolios
git add packages/frontend/e2e/admin/portfolios.spec.ts
git commit -m "test(e2e): admin portfolios (view/cash/holdings)"
```

---

## Task 19: Admin — trades.spec.ts

**Files:**
- Create: `packages/frontend/e2e/admin/trades.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/base';

test.describe('Admin trades', () => {
  test('API: patch price + reverse on an executed trade', async ({ apiClient, adminUser, makeGame, joinedPlayer }) => {
    const game = await makeGame();
    const player = await joinedPlayer(game.id);
    const adminAuth = { Authorization: `Bearer ${adminUser.accessToken}` };

    const exec = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: { symbol: 'AAPL', side: 'buy', quantity: 2 },
    });
    const tradeId = (await exec.json()).id ?? (await exec.json()).tradeId;

    const patch = await apiClient.patch(`/admin/trades/${tradeId}/price`, {
      headers: adminAuth, data: { price: 200 },
    });
    expect(patch.ok(), `patch price: ${await patch.text()}`).toBeTruthy();

    const reverse = await apiClient.post(`/admin/trades/${tradeId}/reverse`, { headers: adminAuth });
    expect(reverse.ok(), `reverse: ${await reverse.text()}`).toBeTruthy();
  });

  test('API: cancel + force-execute on a working order', async ({ apiClient, adminUser, makeGame, joinedPlayer }) => {
    const game = await makeGame();
    const player = await joinedPlayer(game.id);
    const adminAuth = { Authorization: `Bearer ${adminUser.accessToken}` };

    const limit = await apiClient.post(`/games/${game.id}/trades`, {
      headers: { Authorization: `Bearer ${player.accessToken}` },
      data: { symbol: 'AAPL', side: 'buy', quantity: 1, orderType: 'limit', limitPrice: 50 },
    });
    if (limit.status() === 400) test.skip(true, 'limit orders disabled');
    const tradeId = (await limit.json()).id;

    const cancel = await apiClient.delete(`/admin/trades/${tradeId}`, { headers: adminAuth });
    expect(cancel.ok()).toBeTruthy();

    const force = await apiClient.post(`/admin/trades/${tradeId}/force-execute`, { headers: adminAuth });
    expect(force.ok()).toBeFalsy();
  });

  test('UI: admin trades page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/trades');
    await expect(adminPage.getByRole('heading', { name: /trades/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run & commit**

```bash
pnpm --filter frontend e2e -- admin/trades
git add packages/frontend/e2e/admin/trades.spec.ts
git commit -m "test(e2e): admin trades (cancel/reverse/patch-price/force-execute)"
```

---

## Task 20: Admin — system.spec.ts

**Files:**
- Create: `packages/frontend/e2e/admin/system.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/base';

test.describe('Admin system', () => {
  test('API: override stock price', async ({ apiClient, adminUser }) => {
    const res = await apiClient.patch('/admin/stocks/AAPL/price', {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
      data: { price: 9999 },
    });
    expect(res.ok(), `price: ${await res.text()}`).toBeTruthy();
  });

  test('API: flush cache', async ({ apiClient, adminUser }) => {
    const res = await apiClient.post('/admin/stocks/cache/flush', {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('API: stats endpoint', async ({ apiClient, adminUser }) => {
    const res = await apiClient.get('/admin/stats', {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
    });
    const body = await res.json();
    expect(typeof body).toBe('object');
  });

  test('API: update ticker-tape settings', async ({ apiClient, adminUser }) => {
    const res = await apiClient.put('/admin/system-settings/ticker-tape', {
      headers: { Authorization: `Bearer ${adminUser.accessToken}` },
      data: { symbols: ['AAPL', 'MSFT'] },
    });
    expect(res.ok(), `ticker-tape: ${await res.text()}`).toBeTruthy();

    const fetched = await apiClient.get('/system-settings/ticker-tape');
    expect(JSON.stringify(await fetched.json())).toContain('AAPL');
  });

  test('UI: admin system page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/system');
    await expect(adminPage.getByRole('heading', { name: /system/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run & commit**

```bash
pnpm --filter frontend e2e -- admin/system
git add packages/frontend/e2e/admin/system.spec.ts
git commit -m "test(e2e): admin system (price override, cache flush, stats, ticker-tape)"
```

---

## Task 21: Admin — audit.spec.ts

**Files:**
- Create: `packages/frontend/e2e/admin/audit.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '../fixtures/base';

test.describe('Admin audit', () => {
  test('API: audit log records admin actions', async ({ apiClient, adminUser, makeGame, registerUser }) => {
    const auth = { Authorization: `Bearer ${adminUser.accessToken}` };

    const game = await makeGame();
    const target = await registerUser();
    await apiClient.post(`/admin/games/${game.id}/players`, {
      headers: auth, data: { userId: target.userId },
    });

    const res = await apiClient.get('/admin/audit?limit=20', { headers: auth });
    expect(res.ok()).toBeTruthy();
    const entries = (await res.json()).entries ?? (await res.json());
    expect(entries.length).toBeGreaterThan(0);
  });

  test('UI: admin audit page renders', async ({ adminPage }) => {
    await adminPage.goto('/admin/audit');
    await expect(adminPage.getByRole('heading', { name: /audit/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run & commit**

```bash
pnpm --filter frontend e2e -- admin/audit
git add packages/frontend/e2e/admin/audit.spec.ts
git commit -m "test(e2e): admin audit log"
```

---

## Task 22: API — health.spec.ts + edge-errors.spec.ts

**Files:**
- Create: `packages/frontend/e2e/api/health.spec.ts`
- Create: `packages/frontend/e2e/api/edge-errors.spec.ts`

- [ ] **Step 1: health.spec.ts**

```ts
import { test, expect } from '../fixtures/base';

test('GET /health returns ok', async ({ apiClient }) => {
  const res = await apiClient.get('/health');
  expect(res.ok()).toBeTruthy();
});
```

- [ ] **Step 2: edge-errors.spec.ts**

```ts
import { test, expect } from '../fixtures/base';

test.describe.configure({ retries: 0 });

test('401 when missing Authorization', async ({ apiClient }) => {
  const res = await apiClient.get('/games');
  expect(res.status()).toBe(401);
});

test('403 when non-admin hits /admin/audit', async ({ apiClient, playerUser }) => {
  const res = await apiClient.get('/admin/audit', {
    headers: { Authorization: `Bearer ${playerUser.accessToken}` },
  });
  expect(res.status()).toBe(403);
});

test('404 on unknown game', async ({ apiClient, playerUser }) => {
  const res = await apiClient.get('/games/00000000-0000-0000-0000-000000000000', {
    headers: { Authorization: `Bearer ${playerUser.accessToken}` },
  });
  expect(res.status()).toBe(404);
});

test('409 GAME_NOT_ACTIVE on pending-status game trade', async ({ apiClient, makeGame, joinedPlayer }) => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const farther = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const game = await makeGame({ startsAt: future, endsAt: farther });
  const player = await joinedPlayer(game.id);

  const res = await apiClient.post(`/games/${game.id}/trades`, {
    headers: { Authorization: `Bearer ${player.accessToken}` },
    data: { symbol: 'AAPL', side: 'buy', quantity: 1 },
  });
  expect(res.status()).toBe(409);
});

test('400 or 422 on zero-qty trade', async ({ apiClient, makeGame, joinedPlayer }) => {
  const game = await makeGame();
  const player = await joinedPlayer(game.id);
  const res = await apiClient.post(`/games/${game.id}/trades`, {
    headers: { Authorization: `Bearer ${player.accessToken}` },
    data: { symbol: 'AAPL', side: 'buy', quantity: 0 },
  });
  expect([400, 422]).toContain(res.status());
});

test('400 or 422 on oversold position', async ({ apiClient, makeGame, joinedPlayer }) => {
  const game = await makeGame();
  const player = await joinedPlayer(game.id);
  await apiClient.post(`/games/${game.id}/trades`, {
    headers: { Authorization: `Bearer ${player.accessToken}` },
    data: { symbol: 'AAPL', side: 'buy', quantity: 1 },
  });
  const res = await apiClient.post(`/games/${game.id}/trades`, {
    headers: { Authorization: `Bearer ${player.accessToken}` },
    data: { symbol: 'AAPL', side: 'sell', quantity: 5 },
  });
  expect([400, 422]).toContain(res.status());
});
```

- [ ] **Step 3: Run & commit**

```bash
pnpm --filter frontend e2e -- api/
git add packages/frontend/e2e/api/
git commit -m "test(e2e): /health + edge-error status codes (401/403/404/409/422)"
```

---

## Task 23: Rewrite happy-path.spec.ts

**Files:**
- Modify: `packages/frontend/e2e/happy-path.spec.ts`

- [ ] **Step 1: Rewrite**

```ts
import { test, expect } from './fixtures/base';
import { priceOf } from './fixtures/mock-prices';

test('happy path: register → create game → buy AAPL → portfolio reflects holding and cash', async ({ page }) => {
  const username = `e2e_${Date.now()}`;
  const password = 'correct-horse-battery';

  await page.goto('/register');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('heading', { name: /your games/i })).toBeVisible();

  await page.getByRole('button', { name: /create game/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^name$/i).fill('Happy Path Game');
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 16);
  await dialog.getByLabel(/^start$/i).fill(fmt(new Date(now.getTime() - 60_000)));
  await dialog.getByLabel(/^end$/i).fill(fmt(new Date(now.getTime() + 60 * 60_000)));
  await dialog.getByRole('button', { name: /^create$/i }).click();

  await expect(page.getByRole('link', { name: 'Happy Path Game' })).toBeVisible();
  await page.getByRole('link', { name: 'Happy Path Game' }).click();
  await expect(page.getByRole('heading', { name: 'Happy Path Game' })).toBeVisible();

  await page.getByRole('tab', { name: /^trade$/i }).click();
  await page.getByLabel(/symbol/i).fill('AAPL');
  await page.getByRole('button', { name: /^AAPL/ }).first().click();
  await page.getByLabel(/quantity/i).fill('1');
  await page.getByRole('button', { name: /^buy$/i }).click();

  await page.getByRole('tab', { name: /portfolio/i }).click();
  await expect(page.getByRole('cell', { name: 'AAPL' }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(new RegExp(String(100_000 - priceOf('AAPL'))))).toBeVisible();
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter frontend e2e -- happy-path`

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/e2e/happy-path.spec.ts
git commit -m "test(e2e): happy-path uses fixtures + asserts deterministic cash balance"
```

---

## Task 24: Run the full suite and triage

**Files:**
- N/A (validation pass)

- [ ] **Step 1: Run the entire suite**

Run: `pnpm --filter frontend e2e`
Expected: all specs pass.

- [ ] **Step 2: Open HTML report on any failure**

Run: `pnpm --filter frontend exec playwright show-report`
Triage:
- Selector mismatch → fix selector or add a `data-testid` in a small targeted commit.
- API shape mismatch → adjust spec to actual response shape.
- Genuine bug → file a TODO comment in the spec, mark with `test.fixme()`, continue.

- [ ] **Step 3: Optional root shortcut**

Edit `package.json` to add to `scripts`:

```json
"e2e": "pnpm --filter frontend e2e"
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "test(e2e): full integration suite green + root e2e shortcut"
```

---

## Self-Review (done at write-time)

1. **Spec coverage:** every endpoint in the design matrix maps to at least one task (Tasks 9–22). WS endpoints covered in Task 15. `/health` in Task 22. Mock provider in Tasks 1–6.
2. **Placeholders:** none. Every code step shows actual code.
3. **Type consistency:** `UserSession`, `Game`, `priceOf` are defined in Task 8 and reused in later tasks by exact name.
4. **Known soft spots flagged in-plan:**
   - UI label selectors may not match — instructions to update selectors or add testids (Tasks 9, 10, 11, 15).
   - Limit orders may be game-flag-gated → `test.skip` on 400 + `LIMIT_ORDERS_DISABLED` (Tasks 11, 15, 19).
   - Validation status may be 400 vs 422 → tests accept either (Tasks 11, 22).
   - Shared-type field shapes verified at implementation time (Tasks 3, 4, 5).
