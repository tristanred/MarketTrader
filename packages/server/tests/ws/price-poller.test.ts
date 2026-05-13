import { describe, it, expect } from 'vitest';
import { pollPrices } from '../../src/ws/price-poller.js';
import { GameClientRegistry } from '../../src/ws/registry.js';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { schema } from '../../src/db/index.js';
import type { StockQuote } from '@markettrader/shared';
import type { WebSocket } from 'ws';

/**
 * Minimal WebSocket double for the registry — we only need readyState=OPEN
 * and a send() that records payloads, plus a removeListener no-op so the
 * registry's typing is satisfied.
 */
function makeFakeSocket(): WebSocket & { sent: string[] } {
  const sent: string[] = [];
  return {
    readyState: 1,
    send(payload: string) {
      sent.push(payload);
    },
    sent,
    // The registry only ever calls these methods on real sockets; satisfy types.
    on: () => undefined,
    once: () => undefined,
    removeListener: () => undefined,
  } as unknown as WebSocket & { sent: string[] };
}

describe('pollPrices — watchlist symbols', () => {
  it('fetches and broadcasts symbols that are only on a connected user\'s watchlist', async () => {
    const db = await createTestDb();
    const provider = new MockStockProvider();
    const registry = new GameClientRegistry();

    // ── fixtures: a user in an active game, with one held symbol and one
    //    watchlist-only symbol that no one holds.
    const [user] = await db
      .insert(schema.users)
      .values({ username: 'poller-user', passwordHash: 'x' })
      .returning();
    const [game] = await db
      .insert(schema.games)
      .values({
        name: 'g',
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
      .values({ userId: user!.id, name: 'My List' })
      .returning();
    await db.insert(schema.watchlistItems).values({ watchlistId: list!.id, symbol: 'TSLA' });

    // ── provider stubs
    provider.setQuote('AAPL', { price: 200 });
    provider.setQuote('TSLA', { price: 700 });

    // ── connect a fake client subscribed to both symbols
    const socket = makeFakeSocket();
    registry.add(game!.id, user!.id, socket);
    const entry = registry.getEntry(game!.id, socket)!;
    entry.subscriptions.add('AAPL');
    entry.subscriptions.add('TSLA');

    await pollPrices(db, provider, registry);

    expect(socket.sent.length).toBe(1);
    const event = JSON.parse(socket.sent[0]!) as { event: string; data: StockQuote[] };
    expect(event.event).toBe('price_update');
    const symbols = event.data.map((q) => q.symbol).sort();
    expect(symbols).toEqual(['AAPL', 'TSLA']);
  });

  it('does not fetch watchlist symbols for users that are not connected', async () => {
    const db = await createTestDb();
    const provider = new MockStockProvider();
    const registry = new GameClientRegistry();

    const [user] = await db
      .insert(schema.users)
      .values({ username: 'lonely-user', passwordHash: 'x' })
      .returning();
    const [list] = await db
      .insert(schema.watchlists)
      .values({ userId: user!.id, name: 'Solo' })
      .returning();
    await db.insert(schema.watchlistItems).values({ watchlistId: list!.id, symbol: 'NVDA' });

    // No clients connected → registry has no games → poller short-circuits.
    let calls = 0;
    const originalGetQuote = provider.getQuote.bind(provider);
    provider.getQuote = async (s) => {
      calls += 1;
      return originalGetQuote(s);
    };

    await pollPrices(db, provider, registry);
    expect(calls).toBe(0);
  });
});
