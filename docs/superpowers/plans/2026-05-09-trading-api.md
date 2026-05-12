# Trading & Stock Price API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 4 — stock quote fetching via a pluggable provider, a write-through price cache, and full buy/sell trade execution with portfolio tracking.

**Architecture:** A `StockProvider` interface abstracts Yahoo Finance and Alpaca behind a `CachedProvider` decorator that enforces a 30s TTL against the existing `stockPriceCache` table. Trade execution is atomic (Drizzle transaction), validates all business rules, and updates `cashBalance`, `portfolios`, and `trades` in a single commit. Routes receive `provider: StockProvider` as a factory argument, parallel to how `db` is already threaded through today.

**Tech Stack:** Fastify v5, Drizzle ORM, Zod, Vitest, `yahoo-finance2` (new), `better-sqlite3` (SQLite for tests), TypeScript strict mode.

---

## Branch Setup

- [ ] Create and check out a new branch before any code changes:

```bash
git checkout -b feat/phase-4-trading-api
```

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `packages/server/src/providers/interface.ts` | `StockProvider` interface, `StockProviderError`, `TradeError` |
| Create | `packages/server/src/providers/yahoo.ts` | Yahoo Finance implementation via `yahoo-finance2` |
| Create | `packages/server/src/providers/alpaca.ts` | Alpaca Markets implementation via `fetch` |
| Create | `packages/server/src/providers/cached-provider.ts` | 30s TTL write-through cache wrapping any `StockProvider` |
| Create | `packages/server/src/providers/factory.ts` | `createProvider(env)` factory |
| Create | `packages/server/src/providers/index.ts` | Barrel export |
| Create | `packages/server/src/services/trade.ts` | Pure validation helpers + `executeTrade` |
| Create | `packages/server/src/routes/stocks.ts` | `GET /stocks/:symbol`, `GET /stocks/search` |
| Create | `packages/server/src/routes/trading.ts` | `POST /games/:id/trades`, `GET /games/:id/trades`, `GET /games/:id/portfolio` |
| Create | `packages/server/tests/helpers/mock-provider.ts` | Controllable mock implementing `StockProvider` |
| Create | `packages/server/tests/services/trade.test.ts` | Unit tests for pure trade functions |
| Create | `packages/server/tests/routes/stocks.test.ts` | Integration tests for stock routes |
| Create | `packages/server/tests/routes/trading.test.ts` | Integration tests for trading routes |
| Modify | `packages/server/src/env.ts` | Add `ALPACA_API_KEY` optional env var |
| Modify | `packages/server/src/app.ts` | Accept `provider` in opts, wire up new routes |
| Modify | `packages/server/tests/helpers/app.ts` | Accept and forward `provider`, default to `MockStockProvider` |
| Modify | `packages/server/src/services/leaderboard.ts` | Remove `TODO(phase-4)` avgCostBasis fallback |
| Modify | `packages/server/package.json` | Add `yahoo-finance2` dependency |

---

## Task 1: Install `yahoo-finance2` and define the `StockProvider` interface

**Files:**
- Modify: `packages/server/package.json`
- Create: `packages/server/src/providers/interface.ts`

- [ ] **Step 1: Install the package**

```bash
pnpm --filter server add yahoo-finance2
```

- [ ] **Step 2: Create `packages/server/src/providers/interface.ts`**

```typescript
import type { StockQuote, StockSearchResult } from '@markettrader/shared';

export interface StockProvider {
  getQuote(symbol: string): Promise<StockQuote>;
  searchSymbols(query: string): Promise<StockSearchResult[]>;
}

export class StockProviderError extends Error {
  constructor(
    public readonly code: 'SYMBOL_NOT_FOUND' | 'PROVIDER_ERROR' | 'RATE_LIMITED',
    message: string,
  ) {
    super(message);
    this.name = 'StockProviderError';
  }
}

export class TradeError extends Error {
  constructor(
    public readonly code: 'INSUFFICIENT_FUNDS' | 'INSUFFICIENT_SHARES' | 'INVALID_QUANTITY',
    message: string,
  ) {
    super(message);
    this.name = 'TradeError';
  }
}
```

- [ ] **Step 3: Verify typecheck passes**

```bash
pnpm --filter server typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/package.json packages/server/src/providers/interface.ts pnpm-lock.yaml
git commit -m "feat: add StockProvider interface and yahoo-finance2 dependency"
```

---

## Task 2: Implement Yahoo Finance provider

**Files:**
- Create: `packages/server/src/providers/yahoo.ts`

- [ ] **Step 1: Create `packages/server/src/providers/yahoo.ts`**

```typescript
import yahooFinance from 'yahoo-finance2';
import type { StockQuote, StockSearchResult } from '@markettrader/shared';
import { StockProvider, StockProviderError } from './interface.js';

yahooFinance.setGlobalConfig({ validation: { logErrors: false } });

export class YahooProvider implements StockProvider {
  async getQuote(symbol: string): Promise<StockQuote> {
    let result;
    try {
      result = await yahooFinance.quote(symbol);
    } catch {
      throw new StockProviderError('PROVIDER_ERROR', `Yahoo Finance error for ${symbol}`);
    }

    if (!result || result.regularMarketPrice == null) {
      throw new StockProviderError('SYMBOL_NOT_FOUND', `Symbol not found: ${symbol}`);
    }

    return {
      symbol: result.symbol,
      price: result.regularMarketPrice,
      change: result.regularMarketChange ?? 0,
      changePercent: result.regularMarketChangePercent ?? 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    let result;
    try {
      result = await yahooFinance.search(query);
    } catch {
      return [];
    }

    return (result.quotes ?? [])
      .filter((q) => q.quoteType === 'EQUITY' && 'symbol' in q && q.symbol)
      .map((q) => ({
        symbol: (q as { symbol: string }).symbol,
        name:
          ('shortname' in q ? (q as { shortname?: string }).shortname : undefined) ??
          ('longname' in q ? (q as { longname?: string }).longname : undefined) ??
          (q as { symbol: string }).symbol,
      }));
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm --filter server typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/providers/yahoo.ts
git commit -m "feat: implement Yahoo Finance stock provider"
```

---

## Task 3: Implement Alpaca provider

**Files:**
- Create: `packages/server/src/providers/alpaca.ts`

- [ ] **Step 1: Create `packages/server/src/providers/alpaca.ts`**

```typescript
import type { StockQuote, StockSearchResult } from '@markettrader/shared';
import { StockProvider, StockProviderError } from './interface.js';

export class AlpacaProvider implements StockProvider {
  private readonly baseUrl = 'https://data.alpaca.markets/v2';

  constructor(private readonly apiKey: string) {}

  async getQuote(symbol: string): Promise<StockQuote> {
    const url = `${this.baseUrl}/stocks/${encodeURIComponent(symbol)}/quotes/latest`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': this.apiKey,
        Accept: 'application/json',
      },
    });

    if (res.status === 404) {
      throw new StockProviderError('SYMBOL_NOT_FOUND', `Symbol not found: ${symbol}`);
    }
    if (res.status === 429) {
      throw new StockProviderError('RATE_LIMITED', 'Alpaca rate limit exceeded');
    }
    if (!res.ok) {
      throw new StockProviderError('PROVIDER_ERROR', `Alpaca error ${res.status} for ${symbol}`);
    }

    const data = (await res.json()) as { quote?: { ap?: number } };
    const price = data.quote?.ap;
    if (price == null) {
      throw new StockProviderError('SYMBOL_NOT_FOUND', `No quote data for ${symbol}`);
    }

    return {
      symbol,
      price,
      change: 0,
      changePercent: 0,
      fetchedAt: new Date().toISOString(),
    };
  }

  async searchSymbols(_query: string): Promise<StockSearchResult[]> {
    return [];
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
pnpm --filter server typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/providers/alpaca.ts
git commit -m "feat: implement Alpaca Markets stock provider"
```

---

## Task 4: Implement CachedProvider and provider factory

**Files:**
- Create: `packages/server/src/providers/cached-provider.ts`
- Create: `packages/server/src/providers/factory.ts`
- Create: `packages/server/src/providers/index.ts`
- Modify: `packages/server/src/env.ts`

- [ ] **Step 1: Create `packages/server/src/providers/cached-provider.ts`**

```typescript
import { eq } from 'drizzle-orm';
import type { StockQuote, StockSearchResult } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { StockProvider } from './interface.js';

const CACHE_TTL_MS = 30_000;

export class CachedProvider implements StockProvider {
  constructor(
    private readonly db: Db,
    private readonly inner: StockProvider,
  ) {}

  async getQuote(symbol: string): Promise<StockQuote> {
    const [cached] = await this.db
      .select()
      .from(schema.stockPriceCache)
      .where(eq(schema.stockPriceCache.symbol, symbol))
      .limit(1);

    if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS) {
      return {
        symbol,
        price: Number(cached.price),
        change: Number(cached.change),
        changePercent: Number(cached.changePercent),
        fetchedAt: cached.fetchedAt,
      };
    }

    const quote = await this.inner.getQuote(symbol);

    await this.db
      .insert(schema.stockPriceCache)
      .values({
        symbol: quote.symbol,
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
        fetchedAt: quote.fetchedAt,
      })
      .onConflictDoUpdate({
        target: schema.stockPriceCache.symbol,
        set: {
          price: quote.price,
          change: quote.change,
          changePercent: quote.changePercent,
          fetchedAt: quote.fetchedAt,
        },
      });

    return quote;
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    return this.inner.searchSymbols(query);
  }
}
```

- [ ] **Step 2: Create `packages/server/src/providers/factory.ts`**

```typescript
import { env } from '../env.js';
import type { StockProvider } from './interface.js';
import { YahooProvider } from './yahoo.js';
import { AlpacaProvider } from './alpaca.js';

export function createProvider(): StockProvider {
  switch (env.STOCK_PROVIDER) {
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
```

- [ ] **Step 3: Create `packages/server/src/providers/index.ts`**

```typescript
export type { StockProvider } from './interface.js';
export { StockProviderError, TradeError } from './interface.js';
export { CachedProvider } from './cached-provider.js';
export { createProvider } from './factory.js';
```

- [ ] **Step 4: Add `ALPACA_API_KEY` to `packages/server/src/env.ts`**

Open the file and add `ALPACA_API_KEY` to the exported `env` object alongside the other optional vars. Add:

```typescript
ALPACA_API_KEY: optional('ALPACA_API_KEY', ''),
```

- [ ] **Step 5: Verify typecheck passes**

```bash
pnpm --filter server typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/providers/cached-provider.ts packages/server/src/providers/factory.ts packages/server/src/providers/index.ts packages/server/src/env.ts
git commit -m "feat: add CachedProvider, provider factory, and ALPACA_API_KEY env var"
```

---

## Task 5: Implement trade service (pure functions + executeTrade)

**Files:**
- Create: `packages/server/src/services/trade.ts`

- [ ] **Step 1: Write the failing tests first**

Create `packages/server/tests/services/trade.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  validateBuy,
  validateSell,
  computeNewAvgCostBasis,
  computeUnrealizedPnL,
} from '../../src/services/trade.js';
import { TradeError } from '../../src/providers/index.js';

describe('validateBuy', () => {
  it('passes when funds are sufficient', () => {
    expect(() => validateBuy(1000, 50, 5)).not.toThrow();
  });

  it('throws INSUFFICIENT_FUNDS when cost exceeds cash', () => {
    expect(() => validateBuy(100, 50, 5)).toThrow(TradeError);
    expect(() => validateBuy(100, 50, 5)).toThrow('INSUFFICIENT_FUNDS');
  });

  it('throws INSUFFICIENT_FUNDS when cost equals cash exactly (allowed)', () => {
    expect(() => validateBuy(250, 50, 5)).not.toThrow();
  });

  it('throws INVALID_QUANTITY for zero quantity', () => {
    expect(() => validateBuy(1000, 50, 0)).toThrow(TradeError);
    expect(() => validateBuy(1000, 50, 0)).toThrow('INVALID_QUANTITY');
  });

  it('throws INVALID_QUANTITY for fractional quantity', () => {
    expect(() => validateBuy(1000, 50, 1.5)).toThrow(TradeError);
    expect(() => validateBuy(1000, 50, 1.5)).toThrow('INVALID_QUANTITY');
  });
});

describe('validateSell', () => {
  it('passes when shares are sufficient', () => {
    expect(() => validateSell(10, 5)).not.toThrow();
  });

  it('passes when selling all shares', () => {
    expect(() => validateSell(5, 5)).not.toThrow();
  });

  it('throws INSUFFICIENT_SHARES when selling more than owned', () => {
    expect(() => validateSell(3, 5)).toThrow(TradeError);
    expect(() => validateSell(3, 5)).toThrow('INSUFFICIENT_SHARES');
  });

  it('throws INSUFFICIENT_SHARES when no shares owned', () => {
    expect(() => validateSell(0, 1)).toThrow(TradeError);
  });

  it('throws INVALID_QUANTITY for zero quantity', () => {
    expect(() => validateSell(10, 0)).toThrow(TradeError);
    expect(() => validateSell(10, 0)).toThrow('INVALID_QUANTITY');
  });
});

describe('computeNewAvgCostBasis', () => {
  it('returns new price when no existing position', () => {
    expect(computeNewAvgCostBasis(0, 0, 10, 50)).toBe(50);
  });

  it('computes weighted average for adding to position', () => {
    // 10 shares at $50 + 10 shares at $70 = avg $60
    expect(computeNewAvgCostBasis(10, 50, 10, 70)).toBe(60);
  });

  it('weighted average skews toward larger purchase', () => {
    // 5 shares at $100 + 15 shares at $60 = avg $70
    expect(computeNewAvgCostBasis(5, 100, 15, 60)).toBe(70);
  });
});

describe('computeUnrealizedPnL', () => {
  it('returns positive PnL when price is above cost basis', () => {
    expect(computeUnrealizedPnL(10, 50, 70)).toBe(200);
  });

  it('returns negative PnL when price is below cost basis', () => {
    expect(computeUnrealizedPnL(10, 70, 50)).toBe(-200);
  });

  it('returns zero when price equals cost basis', () => {
    expect(computeUnrealizedPnL(10, 50, 50)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
pnpm --filter server test tests/services/trade.test.ts
```

Expected: FAIL — module not found or functions not exported.

- [ ] **Step 3: Create `packages/server/src/services/trade.ts`**

```typescript
import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { TradeDirection, Trade } from '@markettrader/shared';
import { TradeError } from '../providers/index.js';

export function validateBuy(cashBalance: number, price: number, quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new TradeError('INVALID_QUANTITY', 'Quantity must be a positive integer');
  }
  if (quantity * price > cashBalance) {
    throw new TradeError('INSUFFICIENT_FUNDS', 'Insufficient cash balance for this purchase');
  }
}

export function validateSell(currentQuantity: number, quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new TradeError('INVALID_QUANTITY', 'Quantity must be a positive integer');
  }
  if (quantity > currentQuantity) {
    throw new TradeError('INSUFFICIENT_SHARES', 'Insufficient shares for this sale');
  }
}

export function computeNewAvgCostBasis(
  existingQty: number,
  existingAvg: number,
  newQty: number,
  newPrice: number,
): number {
  const total = existingQty + newQty;
  if (total === 0) return newPrice;
  return (existingQty * existingAvg + newQty * newPrice) / total;
}

export function computeUnrealizedPnL(
  quantity: number,
  avgCostBasis: number,
  currentPrice: number,
): number {
  return (currentPrice - avgCostBasis) * quantity;
}

export interface ExecuteTradeParams {
  gamePlayerId: string;
  symbol: string;
  direction: TradeDirection;
  quantity: number;
  price: number;
}

export async function executeTrade(db: Db, params: ExecuteTradeParams): Promise<Trade> {
  const { gamePlayerId, symbol, direction, quantity, price } = params;
  const { gamePlayers, portfolios, trades } = schema;

  const [player] = await db
    .select({ cashBalance: gamePlayers.cashBalance })
    .from(gamePlayers)
    .where(eq(gamePlayers.id, gamePlayerId))
    .limit(1);

  if (!player) throw new Error(`GamePlayer not found: ${gamePlayerId}`);

  const cashBalance = Number(player.cashBalance);

  const [holding] = await db
    .select({ id: portfolios.id, quantity: portfolios.quantity, avgCostBasis: portfolios.avgCostBasis })
    .from(portfolios)
    .where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)))
    .limit(1);

  if (direction === 'buy') {
    validateBuy(cashBalance, price, quantity);
  } else {
    validateSell(holding?.quantity ?? 0, quantity);
  }

  let newCash: number;
  let newQty: number;
  let newAvg: number;

  if (direction === 'buy') {
    newCash = cashBalance - quantity * price;
    newQty = (holding?.quantity ?? 0) + quantity;
    newAvg = computeNewAvgCostBasis(holding?.quantity ?? 0, Number(holding?.avgCostBasis ?? price), quantity, price);
  } else {
    newCash = cashBalance + quantity * price;
    newQty = (holding?.quantity ?? 0) - quantity;
    newAvg = Number(holding?.avgCostBasis ?? 0);
  }

  return db.transaction(async (tx) => {
    await tx
      .update(gamePlayers)
      .set({ cashBalance: newCash })
      .where(eq(gamePlayers.id, gamePlayerId));

    if (direction === 'buy') {
      if (holding) {
        await tx
          .update(portfolios)
          .set({ quantity: newQty, avgCostBasis: newAvg })
          .where(eq(portfolios.id, holding.id));
      } else {
        await tx.insert(portfolios).values({
          gamePlayerId,
          symbol,
          quantity: newQty,
          avgCostBasis: newAvg,
        });
      }
    } else {
      if (newQty === 0) {
        await tx
          .delete(portfolios)
          .where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)));
      } else {
        await tx
          .update(portfolios)
          .set({ quantity: newQty })
          .where(and(eq(portfolios.gamePlayerId, gamePlayerId), eq(portfolios.symbol, symbol)));
      }
    }

    const [trade] = await tx
      .insert(trades)
      .values({ gamePlayerId, symbol, direction, quantity, price })
      .returning();

    if (!trade) throw new Error('Failed to insert trade');

    return {
      id: trade.id,
      gamePlayerId: trade.gamePlayerId,
      symbol: trade.symbol,
      direction: trade.direction as TradeDirection,
      quantity: trade.quantity,
      price: Number(trade.price),
      executedAt: trade.executedAt,
    };
  });
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
pnpm --filter server test tests/services/trade.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/trade.ts packages/server/tests/services/trade.test.ts
git commit -m "feat: implement trade service with validation and executeTrade"
```

---

## Task 6: Add MockStockProvider and update test helpers

**Files:**
- Create: `packages/server/tests/helpers/mock-provider.ts`
- Modify: `packages/server/tests/helpers/app.ts`

- [ ] **Step 1: Create `packages/server/tests/helpers/mock-provider.ts`**

```typescript
import type { StockQuote, StockSearchResult } from '@markettrader/shared';
import type { StockProvider } from '../../src/providers/index.js';

export class MockStockProvider implements StockProvider {
  private quotes = new Map<string, StockQuote>();

  setQuote(symbol: string, quote: Partial<StockQuote> = {}): void {
    this.quotes.set(symbol, {
      symbol,
      price: 100,
      change: 0,
      changePercent: 0,
      fetchedAt: new Date().toISOString(),
      ...quote,
    });
  }

  async getQuote(symbol: string): Promise<StockQuote> {
    return (
      this.quotes.get(symbol) ?? {
        symbol,
        price: 100,
        change: 0,
        changePercent: 0,
        fetchedAt: new Date().toISOString(),
      }
    );
  }

  async searchSymbols(query: string): Promise<StockSearchResult[]> {
    return [{ symbol: query.toUpperCase(), name: `Mock ${query}` }];
  }
}
```

- [ ] **Step 2: Update `packages/server/tests/helpers/app.ts`**

Read the current file then add a `provider` parameter:

```typescript
// Add import at top:
import type { StockProvider } from '../../src/providers/index.js';
import { MockStockProvider } from './mock-provider.js';

// Change the createTestApp signature to:
export async function createTestApp(provider?: StockProvider): Promise<FastifyInstance> {
  const db = createTestDb();
  return buildApp({ logger: false, db, provider: provider ?? new MockStockProvider() });
}
```

- [ ] **Step 3: Update `packages/server/src/app.ts`** to accept `provider` in opts

Read the current file, then add `provider?: StockProvider` to the opts type and wire it up:

```typescript
// Add import:
import type { StockProvider } from './providers/index.js';
import { CachedProvider, createProvider } from './providers/index.js';

// Change buildApp opts type to:
opts: FastifyServerOptions & { db?: Db; provider?: StockProvider } = {}

// Inside buildApp, destructure provider and create default:
const { db = globalDb, provider: injectedProvider, ...fastifyOpts } = opts;
const provider = injectedProvider ?? new CachedProvider(db, createProvider());

// After existing route registrations add:
// (routes to be added in Tasks 7 & 8)
```

- [ ] **Step 4: Verify typecheck and existing tests pass**

```bash
pnpm --filter server typecheck
pnpm --filter server test
```

Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/tests/helpers/mock-provider.ts packages/server/tests/helpers/app.ts packages/server/src/app.ts
git commit -m "feat: wire StockProvider into buildApp and test helpers"
```

---

## Task 7: Implement stock routes

**Files:**
- Create: `packages/server/src/routes/stocks.ts`
- Create: `packages/server/tests/routes/stocks.test.ts`
- Modify: `packages/server/src/app.ts` (register route)

- [ ] **Step 1: Write the failing integration tests**

Create `packages/server/tests/routes/stocks.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';

describe('GET /stocks/:symbol', () => {
  let app: FastifyInstance;
  let provider: MockStockProvider;

  beforeAll(async () => {
    provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 175.5, change: 2.1, changePercent: 1.2 });
    app = await createTestApp(provider);
  });

  afterAll(async () => { await app.close(); });

  it('returns 200 with a stock quote', async () => {
    const res = await app.inject({ method: 'GET', url: '/stocks/AAPL' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ symbol: string; price: number }>();
    expect(body.symbol).toBe('AAPL');
    expect(body.price).toBe(175.5);
  });

  it('normalizes symbol to uppercase', async () => {
    const res = await app.inject({ method: 'GET', url: '/stocks/aapl' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ symbol: string }>().symbol).toBe('AAPL');
  });

  it('returns 404 for unknown symbol when provider throws SYMBOL_NOT_FOUND', async () => {
    const { StockProviderError } = await import('../../src/providers/index.js');
    const errorProvider = new MockStockProvider();
    const errorApp = await createTestApp(errorProvider);
    // Override getQuote to throw
    errorProvider.getQuote = async () => { throw new StockProviderError('SYMBOL_NOT_FOUND', 'Not found'); };
    const res = await errorApp.inject({ method: 'GET', url: '/stocks/FAKE' });
    expect(res.statusCode).toBe(404);
    await errorApp.close();
  });
});

describe('GET /stocks/search', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  it('returns 200 with search results', async () => {
    const res = await app.inject({ method: 'GET', url: '/stocks/search?q=apple' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('returns 400 when query is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/stocks/search' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when query is empty string', async () => {
    const res = await app.inject({ method: 'GET', url: '/stocks/search?q=' });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter server test tests/routes/stocks.test.ts
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Create `packages/server/src/routes/stocks.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import { StockProviderError } from '../providers/index.js';

const symbolSchema = z.string().min(1).max(10).transform((s) => s.toUpperCase());
const searchSchema = z.object({ q: z.string().min(1).max(50) });

export function stockRoutes(db: Db, provider: StockProvider) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get('/stocks/search', async (request, reply) => {
      const parsed = searchSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues });
      }
      const results = await provider.searchSymbols(parsed.data.q);
      return reply.status(200).send(results);
    });

    app.get<{ Params: { symbol: string } }>('/stocks/:symbol', async (request, reply) => {
      const parsed = symbolSchema.safeParse(request.params.symbol);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid symbol' });
      }
      try {
        const quote = await provider.getQuote(parsed.data);
        return reply.status(200).send(quote);
      } catch (err) {
        if (err instanceof StockProviderError) {
          if (err.code === 'SYMBOL_NOT_FOUND') return reply.status(404).send({ error: err.message });
          if (err.code === 'RATE_LIMITED') return reply.status(429).send({ error: err.message });
          return reply.status(502).send({ error: err.message });
        }
        throw err;
      }
    });
  };
}
```

> **Note:** `GET /stocks/search` is registered before `GET /stocks/:symbol` so that `/stocks/search` does not get captured by the param route.

- [ ] **Step 4: Register the route in `packages/server/src/app.ts`**

Add after the existing game route registration:

```typescript
import { stockRoutes } from './routes/stocks.js';

// Inside buildApp, after gameRoutes:
await app.register(stockRoutes(db, provider));
```

- [ ] **Step 5: Run tests and confirm they pass**

```bash
pnpm --filter server test tests/routes/stocks.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/stocks.ts packages/server/tests/routes/stocks.test.ts packages/server/src/app.ts
git commit -m "feat: add GET /stocks/:symbol and GET /stocks/search routes"
```

---

## Task 8: Implement trading routes

**Files:**
- Create: `packages/server/src/routes/trading.ts`
- Create: `packages/server/tests/routes/trading.test.ts`
- Modify: `packages/server/src/app.ts` (register route)

- [ ] **Step 1: Write the failing integration tests**

Create `packages/server/tests/routes/trading.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';

async function registerUser(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST', url: '/auth/register',
    payload: { username, password: 'password123' },
  });
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id };
}

async function createActiveGame(app: FastifyInstance, token: string) {
  const res = await app.inject({
    method: 'POST', url: '/games',
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: 'Active Game',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
    },
  });
  return res.json<{ id: string }>();
}

describe('POST /games/:id/trades', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    app = await createTestApp(provider);
    ({ token } = await registerUser(app, 'trader1'));
    ({ id: gameId } = await createActiveGame(app, token));
  });

  afterAll(async () => { await app.close(); });

  it('returns 201 and trade when buying a valid stock', async () => {
    const res = await app.inject({
      method: 'POST', url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 5 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ trade: { symbol: string; direction: string; quantity: number }; cashBalance: number }>();
    expect(body.trade.symbol).toBe('AAPL');
    expect(body.trade.direction).toBe('buy');
    expect(body.trade.quantity).toBe(5);
    expect(body.cashBalance).toBe(9500); // 10000 - 5*100
  });

  it('returns 422 when insufficient funds', async () => {
    const res = await app.inject({
      method: 'POST', url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 200 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('INSUFFICIENT_FUNDS');
  });

  it('returns 422 when selling shares not owned', async () => {
    const res = await app.inject({
      method: 'POST', url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'MSFT', direction: 'sell', quantity: 1 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string }>().code).toBe('INSUFFICIENT_SHARES');
  });

  it('returns 400 for fractional quantity', async () => {
    const res = await app.inject({
      method: 'POST', url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1.5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method: 'POST', url: `/games/${gameId}/trades`,
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when game does not exist', async () => {
    const res = await app.inject({
      method: 'POST', url: '/games/nonexistent-id/trades',
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when game is not active (pending)', async () => {
    const { token: t2 } = await registerUser(app, 'trader2');
    const pendingRes = await app.inject({
      method: 'POST', url: '/games',
      headers: { Authorization: `Bearer ${t2}` },
      payload: {
        name: 'Pending Game',
        startDate: '2099-01-01T00:00:00.000Z',
        endDate: '2099-06-01T00:00:00.000Z',
        startingBalance: 10000,
      },
    });
    const pendingGameId = pendingRes.json<{ id: string }>().id;
    const res = await app.inject({
      method: 'POST', url: `/games/${pendingGameId}/trades`,
      headers: { Authorization: `Bearer ${t2}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 1 },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('GET /games/:id/trades', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    app = await createTestApp(provider);
    ({ token } = await registerUser(app, 'trader3'));
    ({ id: gameId } = await createActiveGame(app, token));
    // Place a trade to seed history
    await app.inject({
      method: 'POST', url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 3 },
    });
  });

  afterAll(async () => { await app.close(); });

  it('returns 200 with trade history', async () => {
    const res = await app.inject({
      method: 'GET', url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const trades = res.json<Array<{ symbol: string; direction: string }>>() ;
    expect(trades.length).toBeGreaterThan(0);
    expect(trades[0]?.symbol).toBe('AAPL');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: `/games/${gameId}/trades` });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /games/:id/portfolio', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 120 });
    app = await createTestApp(provider);
    ({ token } = await registerUser(app, 'trader4'));
    ({ id: gameId } = await createActiveGame(app, token));
    // Buy some shares first
    await app.inject({
      method: 'POST', url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { symbol: 'AAPL', direction: 'buy', quantity: 10 },
    });
  });

  afterAll(async () => { await app.close(); });

  it('returns 200 with portfolio including unrealized P&L', async () => {
    const res = await app.inject({
      method: 'GET', url: `/games/${gameId}/portfolio`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      cashBalance: number;
      holdings: Array<{
        symbol: string;
        quantity: number;
        avgCostBasis: number;
        currentPrice: number;
        marketValue: number;
        unrealizedPnL: number;
        unrealizedPnLPercent: number;
      }>;
      totalValue: number;
    }>();
    expect(body.cashBalance).toBe(8800); // 10000 - 10*120
    expect(body.holdings).toHaveLength(1);
    expect(body.holdings[0]?.symbol).toBe('AAPL');
    expect(body.holdings[0]?.quantity).toBe(10);
    expect(body.holdings[0]?.avgCostBasis).toBe(120);
    expect(body.holdings[0]?.currentPrice).toBe(120);
    expect(body.holdings[0]?.unrealizedPnL).toBe(0); // bought at 120, now 120
    expect(body.totalValue).toBeCloseTo(10000); // cashBalance + holdings
  });

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({ method: 'GET', url: `/games/${gameId}/portfolio` });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
pnpm --filter server test tests/routes/trading.test.ts
```

Expected: FAIL — routes not registered.

- [ ] **Step 3: Create `packages/server/src/routes/trading.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import { StockProviderError, TradeError } from '../providers/index.js';
import { recomputeGameStatus } from '../services/game-status.js';
import { executeTrade, computeUnrealizedPnL } from '../services/trade.js';
import type { TradeDirection } from '@markettrader/shared';

const placeTradeSchema = z.object({
  symbol: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
  direction: z.enum(['buy', 'sell']),
  quantity: z.number().int().min(1),
});

export function tradingRoutes(db: Db, provider: StockProvider) {
  return async function (app: FastifyInstance): Promise<void> {
    const { games, gamePlayers, portfolios, trades } = schema;

    app.post<{ Params: { id: string } }>(
      '/games/:id/trades',
      { preHandler: app.authenticate },
      async (request, reply) => {
        const parsed = placeTradeSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: parsed.error.issues });
        }
        const { symbol, direction, quantity } = parsed.data;
        const userId = request.user.id;
        const gameId = request.params.id;

        const [game] = await db
          .select()
          .from(games)
          .where(eq(games.id, gameId))
          .limit(1);
        if (!game) return reply.status(404).send({ error: 'Game not found' });

        const status = await recomputeGameStatus(db, game);
        if (status !== 'active') {
          return reply.status(409).send({ error: 'GAME_NOT_ACTIVE', message: `Game is ${status}` });
        }

        const [gamePlayer] = await db
          .select()
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
          .limit(1);
        if (!gamePlayer) return reply.status(404).send({ error: 'You are not a member of this game' });

        let quote;
        try {
          quote = await provider.getQuote(symbol);
        } catch (err) {
          if (err instanceof StockProviderError) {
            if (err.code === 'SYMBOL_NOT_FOUND') return reply.status(404).send({ error: err.message });
            if (err.code === 'RATE_LIMITED') return reply.status(429).send({ error: err.message });
            return reply.status(502).send({ error: err.message });
          }
          throw err;
        }

        let trade;
        try {
          trade = await executeTrade(db, {
            gamePlayerId: gamePlayer.id,
            symbol,
            direction: direction as TradeDirection,
            quantity,
            price: quote.price,
          });
        } catch (err) {
          if (err instanceof TradeError) {
            return reply.status(422).send({ code: err.code, message: err.message });
          }
          throw err;
        }

        const [updatedPlayer] = await db
          .select({ cashBalance: gamePlayers.cashBalance })
          .from(gamePlayers)
          .where(eq(gamePlayers.id, gamePlayer.id))
          .limit(1);

        return reply.status(201).send({
          trade,
          cashBalance: Number(updatedPlayer?.cashBalance ?? 0),
        });
      },
    );

    app.get<{ Params: { id: string } }>(
      '/games/:id/trades',
      { preHandler: app.authenticate },
      async (request, reply) => {
        const userId = request.user.id;
        const gameId = request.params.id;

        const [gamePlayer] = await db
          .select({ id: gamePlayers.id })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
          .limit(1);
        if (!gamePlayer) return reply.status(404).send({ error: 'You are not a member of this game' });

        const history = await db
          .select()
          .from(trades)
          .where(eq(trades.gamePlayerId, gamePlayer.id))
          .orderBy(desc(trades.executedAt));

        return reply.status(200).send(
          history.map((t) => ({
            id: t.id,
            gamePlayerId: t.gamePlayerId,
            symbol: t.symbol,
            direction: t.direction,
            quantity: t.quantity,
            price: Number(t.price),
            executedAt: t.executedAt,
          })),
        );
      },
    );

    app.get<{ Params: { id: string } }>(
      '/games/:id/portfolio',
      { preHandler: app.authenticate },
      async (request, reply) => {
        const userId = request.user.id;
        const gameId = request.params.id;

        const [gamePlayer] = await db
          .select({ id: gamePlayers.id, cashBalance: gamePlayers.cashBalance })
          .from(gamePlayers)
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)))
          .limit(1);
        if (!gamePlayer) return reply.status(404).send({ error: 'You are not a member of this game' });

        const cashBalance = Number(gamePlayer.cashBalance);

        const holdings = await db
          .select()
          .from(portfolios)
          .where(eq(portfolios.gamePlayerId, gamePlayer.id));

        const enrichedHoldings = await Promise.all(
          holdings.map(async (h) => {
            let currentPrice = Number(h.avgCostBasis);
            try {
              const quote = await provider.getQuote(h.symbol);
              currentPrice = quote.price;
            } catch {
              // Use cost basis as fallback if quote fails
            }
            const avgCostBasis = Number(h.avgCostBasis);
            const marketValue = h.quantity * currentPrice;
            const unrealizedPnL = computeUnrealizedPnL(h.quantity, avgCostBasis, currentPrice);
            const unrealizedPnLPercent =
              avgCostBasis !== 0 ? ((currentPrice - avgCostBasis) / avgCostBasis) * 100 : 0;
            return {
              symbol: h.symbol,
              quantity: h.quantity,
              avgCostBasis,
              currentPrice,
              marketValue,
              unrealizedPnL,
              unrealizedPnLPercent,
            };
          }),
        );

        const totalValue = cashBalance + enrichedHoldings.reduce((sum, h) => sum + h.marketValue, 0);

        return reply.status(200).send({ cashBalance, holdings: enrichedHoldings, totalValue });
      },
    );
  };
}
```

- [ ] **Step 4: Register the route in `packages/server/src/app.ts`**

```typescript
import { tradingRoutes } from './routes/trading.js';

// Inside buildApp, after stockRoutes:
await app.register(tradingRoutes(db, provider));
```

- [ ] **Step 5: Run tests and confirm they pass**

```bash
pnpm --filter server test tests/routes/trading.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/trading.ts packages/server/tests/routes/trading.test.ts packages/server/src/app.ts
git commit -m "feat: add POST /games/:id/trades, GET /games/:id/trades, GET /games/:id/portfolio"
```

---

## Task 9: Remove leaderboard TODO and run full test suite

**Files:**
- Modify: `packages/server/src/services/leaderboard.ts`

- [ ] **Step 1: Update `packages/server/src/services/leaderboard.ts`**

Find the line with `TODO(phase-4)` (around line 55):

```typescript
// TODO(phase-4): remove avgCostBasis fallback once StockProvider cache is populated
const price = row.cachedPrice != null ? Number(row.cachedPrice) : Number(row.avgCostBasis);
```

Replace with:

```typescript
const price = row.cachedPrice != null ? Number(row.cachedPrice) : 0;
```

- [ ] **Step 2: Run the full test suite**

```bash
pnpm --filter server test
```

Expected: all tests pass with no failures.

- [ ] **Step 3: Run typecheck across the entire monorepo**

```bash
pnpm typecheck
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/leaderboard.ts
git commit -m "feat: remove avgCostBasis fallback from leaderboard (Phase 4 complete)"
```

---

## Verification

Run the full test suite and type check to confirm everything is green:

```bash
pnpm typecheck
pnpm test
```

Then do a manual smoke test with a real SQLite dev DB:

```bash
DATABASE_URL=./dev.db JWT_SECRET=testsecretfortesting pnpm --filter server dev
```

```bash
# Register a user
curl -s -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"pass1234"}' | jq .

# Copy the token from above and set it:
TOKEN=<paste_token_here>

# Get a stock quote (hits Yahoo Finance)
curl -s http://localhost:3000/stocks/AAPL | jq .

# Create an active game
curl -s -X POST http://localhost:3000/games \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","startDate":"2020-01-01T00:00:00Z","endDate":"2099-01-01T00:00:00Z","startingBalance":10000}' | jq .

# Copy game id and set it:
GAME_ID=<paste_game_id>

# Place a trade
curl -s -X POST http://localhost:3000/games/$GAME_ID/trades \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"AAPL","direction":"buy","quantity":5}' | jq .

# View portfolio
curl -s http://localhost:3000/games/$GAME_ID/portfolio \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Expected: all curl commands return valid JSON with correct data.

---

## Update PLAN.md

After all tasks pass, update `/Users/tristan/prog/MarketTrader/PLAN.md`:

- Mark all Phase 4 items as `[x]`
- Update **Current State** section to note Phase 4 is complete and Phase 5 (WebSocket) is next
