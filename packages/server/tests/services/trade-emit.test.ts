import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import * as schema from '../../src/db/schema.sqlite.js';
import type { Db } from '../../src/db/index.js';
import { EventBus } from '../../src/events/bus.js';
import type { DomainEvent } from '../../src/events/types.js';
import { emitTradeEvents } from '../../src/services/trade-emit.js';
import type { ExecuteTradeResult } from '../../src/services/trade.js';

async function seedGameAndPlayer(db: Db): Promise<{ gameId: string; gpId: string }> {
  const [user] = await db
    .insert(schema.users)
    .values({ username: `u-${Math.random().toString(36).slice(2)}`, passwordHash: 'x' })
    .returning();
  const [game] = await db
    .insert(schema.games)
    .values({
      name: 'g',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
      createdBy: user!.id,
    })
    .returning();
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game!.id, userId: user!.id, cashBalance: 10000 })
    .returning();
  return { gameId: game!.id, gpId: gp!.id };
}

function captureBus(bus: EventBus): DomainEvent[] {
  const captured: DomainEvent[] = [];
  bus.on('holdings.changed', (e) => {
    captured.push(e);
  });
  bus.on('position.closed', (e) => {
    captured.push(e);
  });
  return captured;
}

describe('emitTradeEvents', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let provider: MockStockProvider;
  let gameId: string;
  let gpId: string;
  const executedAt = '2026-05-25T10:00:00.000Z';

  beforeEach(async () => {
    db = await createTestDb();
    provider = new MockStockProvider();
    const seeded = await seedGameAndPlayer(db as unknown as Db);
    gameId = seeded.gameId;
    gpId = seeded.gpId;
  });

  it('emits holdings.changed for a buy live trade with distinctSymbols=1, no position.closed', async () => {
    // Seed the portfolio so the loadPlayerPortfolio inside emit can derive
    // topConcentrationRatio / cashRatio from real data.
    await db.insert(schema.portfolios).values({
      gamePlayerId: gpId,
      symbol: 'AAPL',
      quantity: 10,
      avgCostBasis: 100,
      openedAt: executedAt,
    });
    provider.setQuote('AAPL', { price: 100 });

    const bus = new EventBus();
    const captured = captureBus(bus);

    const result: ExecuteTradeResult = {
      trade: { id: 't1', gamePlayerId: gpId, symbol: 'AAPL', direction: 'buy', quantity: 10, price: 100, executedAt },
      realizedPnl: 0,
      realizedPnlPct: 0,
      holdDurationMs: 0,
      fullyClosed: false,
      distinctSymbols: 1,
    };

    await emitTradeEvents({
      bus,
      db: db as unknown as Db,
      provider,
      gameId,
      gamePlayerId: gpId,
      cashAfter: 9000,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 10,
      result,
      executedAt,
      isResting: false,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.type).toBe('holdings.changed');
    const ev = captured[0] as Extract<DomainEvent, { type: 'holdings.changed' }>;
    expect(ev.gameId).toBe(gameId);
    expect(ev.gamePlayerId).toBe(gpId);
    expect(ev.distinctSymbols).toBe(1);
    // Portfolio total = 9000 cash + 10 * 100 holding = 10000. Top symbol value = 1000.
    expect(ev.topConcentrationRatio).toBeCloseTo(0.1);
    expect(ev.cashRatio).toBeCloseTo(0.9);
    expect(ev.changedAt).toBe(executedAt);
  });

  it('emits both holdings.changed and position.closed for a non-resting sell with realized P&L', async () => {
    // No remaining holdings post-sell — distinctSymbols=0 means no quote fetch.
    provider.setQuote('AAPL', { price: 150 });

    const bus = new EventBus();
    const captured = captureBus(bus);

    const result: ExecuteTradeResult = {
      trade: { id: 't2', gamePlayerId: gpId, symbol: 'AAPL', direction: 'sell', quantity: 10, price: 150, executedAt },
      realizedPnl: 500,
      realizedPnlPct: 0.5,
      holdDurationMs: 86_400_000,
      fullyClosed: true,
      distinctSymbols: 0,
    };

    await emitTradeEvents({
      bus,
      db: db as unknown as Db,
      provider,
      gameId,
      gamePlayerId: gpId,
      cashAfter: 11500,
      symbol: 'AAPL',
      direction: 'sell',
      quantity: 10,
      result,
      executedAt,
      isResting: false,
    });

    expect(captured).toHaveLength(2);
    const holdings = captured.find((e) => e.type === 'holdings.changed') as
      | Extract<DomainEvent, { type: 'holdings.changed' }>
      | undefined;
    const closed = captured.find((e) => e.type === 'position.closed') as
      | Extract<DomainEvent, { type: 'position.closed' }>
      | undefined;
    expect(holdings).toBeDefined();
    expect(holdings!.distinctSymbols).toBe(0);
    // With no holdings, the emitter skips the portfolio derivation entirely
    // and ships the zero/one defaults.
    expect(holdings!.topConcentrationRatio).toBe(0);
    expect(holdings!.cashRatio).toBe(1);

    expect(closed).toBeDefined();
    expect(closed!.symbol).toBe('AAPL');
    expect(closed!.quantity).toBe(10);
    expect(closed!.realizedPnl).toBe(500);
    expect(closed!.realizedPnlPct).toBe(0.5);
    expect(closed!.holdDurationMs).toBe(86_400_000);
    expect(closed!.fullyClosed).toBe(true);
    expect(closed!.closedAt).toBe(executedAt);
  });

  it('suppresses position.closed for a resting sell (still emits holdings.changed)', async () => {
    provider.setQuote('AAPL', { price: 150 });

    const bus = new EventBus();
    const captured = captureBus(bus);

    // Resting-sell path: realized P&L is unavailable (cost basis was lost at
    // placement) so executeTrade returns zeros. The emitter must drop the
    // position.closed entirely rather than emit zeros.
    const result: ExecuteTradeResult = {
      trade: { id: 't3', gamePlayerId: gpId, symbol: 'AAPL', direction: 'sell', quantity: 10, price: 150, executedAt },
      realizedPnl: 0,
      realizedPnlPct: 0,
      holdDurationMs: 0,
      fullyClosed: false,
      distinctSymbols: 0,
    };

    await emitTradeEvents({
      bus,
      db: db as unknown as Db,
      provider,
      gameId,
      gamePlayerId: gpId,
      cashAfter: 11500,
      symbol: 'AAPL',
      direction: 'sell',
      quantity: 10,
      result,
      executedAt,
      isResting: true,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]!.type).toBe('holdings.changed');
  });
});
