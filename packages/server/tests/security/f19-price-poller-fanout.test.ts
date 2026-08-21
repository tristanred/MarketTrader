import { describe, it, expect } from 'vitest';
import type {
  StockDetails,
  StockHistoryBar,
  StockHistoryRange,
  StockQuote,
} from '@markettrader/shared';
import type { WebSocket } from 'ws';
import { pollPrices, createPricePollerState } from '../../src/ws/price-poller.js';
import { GameClientRegistry } from '../../src/ws/registry.js';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { schema } from '../../src/db/index.js';
import { env } from '../../src/env.js';
import type { StockProvider } from '../../src/providers/index.js';

/** Minimal WebSocket double — mirrors the one in tests/ws/price-poller.test.ts. */
function makeFakeSocket(): WebSocket & { sent: string[] } {
  const sent: string[] = [];
  return {
    readyState: 1,
    send(payload: string) {
      sent.push(payload);
    },
    sent,
    on: () => undefined,
    once: () => undefined,
    removeListener: () => undefined,
  } as unknown as WebSocket & { sent: string[] };
}

function quoteFor(symbol: string): StockQuote {
  return {
    symbol,
    price: 100,
    change: 0,
    changePercent: 0,
    fetchedAt: new Date().toISOString(),
  };
}

/** Provider double that exposes the optional batch path so it can be asserted. */
class BatchProvider implements StockProvider {
  quoteCalls = 0;
  batchCalls = 0;
  batchedSymbols: string[] = [];

  async getQuote(symbol: string): Promise<StockQuote> {
    this.quoteCalls += 1;
    return quoteFor(symbol);
  }

  async getQuotes(symbols: string[]): Promise<Map<string, StockQuote>> {
    this.batchCalls += 1;
    this.batchedSymbols.push(...symbols);
    return new Map(symbols.map((s) => [s, quoteFor(s)]));
  }

  async searchSymbols(): Promise<[]> {
    return [];
  }

  async getHistory(_symbol: string, _range: StockHistoryRange): Promise<StockHistoryBar[]> {
    return [];
  }

  async getDetails(symbol: string): Promise<StockDetails> {
    return { ...quoteFor(symbol), previousClose: 100 };
  }
}

/**
 * Seeds one active game with a connected client, one held symbol, and
 * `watchlistSize` watchlist-only symbols owned by that same connected user.
 */
async function seedGame(
  db: Awaited<ReturnType<typeof createTestDb>>,
  registry: GameClientRegistry,
  username: string,
  watchlistSize: number,
): Promise<{ socket: WebSocket & { sent: string[] }; gameId: string }> {
  const [user] = await db
    .insert(schema.users)
    .values({ username, passwordHash: 'x' })
    .returning();
  const [game] = await db
    .insert(schema.games)
    .values({
      name: `g-${username}`,
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10_000,
      status: 'active',
      createdBy: user!.id,
    })
    .returning();
  const [player] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game!.id, userId: user!.id, cashBalance: 10_000 })
    .returning();
  await db
    .insert(schema.portfolios)
    .values({ gamePlayerId: player!.id, symbol: 'AAPL', quantity: 10, avgCostBasis: 100 });

  const [list] = await db
    .insert(schema.watchlists)
    .values({ userId: user!.id, name: `list-${username}` })
    .returning();

  // Chunked so the parameter count stays well inside SQLite's bind limit.
  for (let start = 0; start < watchlistSize; start += 100) {
    const rows = Array.from({ length: Math.min(100, watchlistSize - start) }, (_, i) => ({
      watchlistId: list!.id,
      symbol: `W${start + i}`,
    }));
    if (rows.length > 0) await db.insert(schema.watchlistItems).values(rows);
  }

  const socket = makeFakeSocket();
  registry.add(game!.id, user!.id, socket);
  const entry = registry.getEntry(game!.id, socket)!;
  entry.subscriptions.add('AAPL');
  return { socket, gameId: game!.id };
}

describe('F19 — price poller fan-out is bounded', () => {
  it('caps symbols per tick, keeps held symbols, and reports the truncation', async () => {
    const db = await createTestDb();
    const provider = new MockStockProvider();
    const registry = new GameClientRegistry();

    const overflow = 25;
    await seedGame(db, registry, 'f19-cap-user', env.PRICE_POLLER_MAX_SYMBOLS + overflow);

    const fetched: string[] = [];
    const original = provider.getQuote.bind(provider);
    provider.getQuote = async (symbol: string) => {
      fetched.push(symbol);
      return original(symbol);
    };

    const warnings: { details: Record<string, number>; message: string }[] = [];
    const logger = {
      warn: (details: Record<string, number>, message: string) => {
        warnings.push({ details, message });
      },
      error: () => {},
    };

    await pollPrices(db, provider, registry, logger);

    expect(fetched.length).toBe(env.PRICE_POLLER_MAX_SYMBOLS);
    // Holdings must never be the symbols that get dropped — they drive
    // portfolio value and trade pricing, unlike watchlist rows.
    expect(fetched).toContain('AAPL');
    expect(warnings.length).toBe(1);
    // One held symbol on top of the watchlist rows.
    const seeded = env.PRICE_POLLER_MAX_SYMBOLS + overflow + 1;
    expect(warnings[0]!.details).toEqual({
      requested: seeded,
      fetched: env.PRICE_POLLER_MAX_SYMBOLS,
      dropped: seeded - env.PRICE_POLLER_MAX_SYMBOLS,
    });
  });

  it('warns again after a quiet period, not once per process', async () => {
    const db = await createTestDb();
    const provider = new MockStockProvider();
    const registry = new GameClientRegistry();

    const { socket, gameId } = await seedGame(
      db,
      registry,
      'f19-requiet-user',
      env.PRICE_POLLER_MAX_SYMBOLS + 5,
    );

    const truncationWarnings: Record<string, number>[] = [];
    const logger = {
      warn: (details: Record<string, number>) => {
        if (details.dropped !== undefined) truncationWarnings.push(details);
      },
      error: () => {},
    };
    const state = createPricePollerState();

    await pollPrices(db, provider, registry, logger, state);
    expect(truncationWarnings.length).toBe(1);

    // Every night is a quiet period: nobody connected, so the tick returns
    // before it can observe an overflow. If that left the transition flag set,
    // the next busy day would truncate in silence.
    registry.remove(gameId, socket);
    await pollPrices(db, provider, registry, logger, state);
    expect(truncationWarnings.length).toBe(1);

    // Busy again: a second overflowing game with a connected client.
    await seedGame(db, registry, 'f19-requiet-user-2', env.PRICE_POLLER_MAX_SYMBOLS + 5);
    await pollPrices(db, provider, registry, logger, state);

    expect(truncationWarnings.length).toBe(2);
  });

  it('does not truncate or warn when the symbol set is inside the cap', async () => {
    const db = await createTestDb();
    const provider = new MockStockProvider();
    const registry = new GameClientRegistry();

    await seedGame(db, registry, 'f19-small-user', 5);

    const truncationWarnings: Record<string, number>[] = [];
    const logger = {
      error: () => {},
      warn: (details: Record<string, number>, _message: string) => {
        if (details.dropped !== undefined) truncationWarnings.push(details);
      },
    };

    const fetched: string[] = [];
    const original = provider.getQuote.bind(provider);
    provider.getQuote = async (symbol: string) => {
      fetched.push(symbol);
      return original(symbol);
    };

    await pollPrices(db, provider, registry, logger);

    expect(fetched.length).toBe(6);
    expect(truncationWarnings).toEqual([]);
  });

  it('uses the provider batch path instead of one request per symbol', async () => {
    const db = await createTestDb();
    const provider = new BatchProvider();
    const registry = new GameClientRegistry();

    await seedGame(db, registry, 'f19-batch-user', 40);

    await pollPrices(db, provider, registry);

    expect(provider.quoteCalls).toBe(0);
    expect(provider.batchCalls).toBe(1);
    expect(provider.batchedSymbols.length).toBe(41);
    expect(provider.batchedSymbols).toContain('AAPL');
  });
});
