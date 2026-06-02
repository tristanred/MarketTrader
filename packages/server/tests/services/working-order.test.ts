import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import {
  placeWorkingOrder,
  cancelWorkingOrder,
  evaluateTriggers,
  expireDayOrders,
  availableCash,
  availableShares,
  listWorkingOrders,
  getOpenOrderSymbols,
  WorkingOrderNotFoundError,
} from '../../src/services/working-order.js';
import { TradeError } from '../../src/providers/index.js';
import { schema } from '../../src/db/index.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function seed(opts: { cash?: number } = {}): Promise<{ db: Db; gamePlayerId: string }> {
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
      startingBalance: opts.cash ?? 10000,
      status: 'active',
      createdBy: user.id,
    })
    .returning({ id: schema.games.id });
  if (!game) throw new Error('seed game');
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game.id, userId: user.id, cashBalance: opts.cash ?? 10000 })
    .returning({ id: schema.gamePlayers.id });
  if (!gp) throw new Error('seed gp');
  return { db, gamePlayerId: gp.id };
}

async function seedHolding(db: Db, gamePlayerId: string, symbol: string, qty: number, basis = 50): Promise<void> {
  await db
    .insert(schema.portfolios)
    .values({ gamePlayerId, symbol, quantity: qty, avgCostBasis: basis });
}

async function getCash(db: Db, gamePlayerId: string): Promise<number> {
  const [p] = await db
    .select({ c: schema.gamePlayers.cashBalance })
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.id, gamePlayerId));
  return Number(p?.c ?? 0);
}

async function getQty(db: Db, gamePlayerId: string, _symbol: string): Promise<number> {
  const [h] = await db
    .select({ q: schema.portfolios.quantity })
    .from(schema.portfolios)
    .where(eq(schema.portfolios.gamePlayerId, gamePlayerId));
  return h?.q ?? 0;
}

async function getSymbolQty(db: Db, gamePlayerId: string, symbol: string): Promise<number> {
  const [h] = await db
    .select({ q: schema.portfolios.quantity })
    .from(schema.portfolios)
    .where(
      and(
        eq(schema.portfolios.gamePlayerId, gamePlayerId),
        eq(schema.portfolios.symbol, symbol),
      ),
    );
  return h?.q ?? 0;
}

/**
 * `createTestDb()` uses libsql `cache=shared`, so rows from other tests in
 * the same worker persist. Filter outcomes by the test's own gamePlayerId to
 * avoid counting cross-test fills.
 */
function ownedBy(
  outcomes: Awaited<ReturnType<typeof import('../../src/services/working-order.js').evaluateTriggers>>,
  gamePlayerId: string,
) {
  return outcomes.filter((o) =>
    o.kind === 'filled'
      ? o.row.gamePlayerId === gamePlayerId
      : o.gamePlayerId === gamePlayerId,
  );
}

describe('placeWorkingOrder — validation', () => {
  it('rejects market orders (those go through executeTrade)', async () => {
    const { db, gamePlayerId } = await seed();
    await expect(
      placeWorkingOrder(db, {
        gamePlayerId,
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        orderType: 'market',
        timeInForce: 'day',
      }),
    ).rejects.toBeInstanceOf(TradeError);
  });

  it('rejects limit without limitPrice', async () => {
    const { db, gamePlayerId } = await seed();
    await expect(
      placeWorkingOrder(db, {
        gamePlayerId,
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        timeInForce: 'day',
      }),
    ).rejects.toBeInstanceOf(TradeError);
  });

  it('rejects bracket buy where TP <= SL', async () => {
    const { db, gamePlayerId } = await seed();
    await expect(
      placeWorkingOrder(db, {
        gamePlayerId,
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        orderType: 'bracket',
        timeInForce: 'day',
        takeProfitPrice: 100,
        stopLossPrice: 110,
        referencePrice: 105,
      }),
    ).rejects.toBeInstanceOf(TradeError);
  });

  it('rejects a bracket buy-entry when cash is insufficient', async () => {
    const { db, gamePlayerId } = await seed({ cash: 100 });
    await expect(
      placeWorkingOrder(db, {
        gamePlayerId,
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 10,
        orderType: 'bracket',
        timeInForce: 'day',
        limitPrice: 100, // entry reservation 10 * 100 = 1000 > 100 cash
        takeProfitPrice: 120,
        stopLossPrice: 90,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });

  it('rejects a bracket sell-entry when shares are insufficient', async () => {
    const { db, gamePlayerId } = await seed();
    await seedHolding(db, gamePlayerId, 'AAPL', 3);
    await expect(
      placeWorkingOrder(db, {
        gamePlayerId,
        symbol: 'AAPL',
        direction: 'sell',
        quantity: 10, // only 3 held
        orderType: 'bracket',
        timeInForce: 'day',
        limitPrice: 100,
        // Short bracket: TP (cover) below entry, SL (cover) above.
        takeProfitPrice: 80,
        stopLossPrice: 120,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SHARES' });
  });
});

describe('placeWorkingOrder — limit buy', () => {
  it('reserves cash and inserts a working row', async () => {
    const { db, gamePlayerId } = await seed();
    const [order] = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      orderType: 'limit',
      timeInForce: 'gtc',
      limitPrice: 100,
    });
    expect(order?.reservedCash).toBe(500);
    expect(order?.orderType).toBe('limit');
    expect(order?.timeInForce).toBe('gtc');
    expect(await getCash(db, gamePlayerId)).toBe(9500);
    const list = await listWorkingOrders(db, gamePlayerId);
    expect(list).toHaveLength(1);
  });

  it('rejects when cash is insufficient', async () => {
    const { db, gamePlayerId } = await seed({ cash: 100 });
    await expect(
      placeWorkingOrder(db, {
        gamePlayerId,
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 5,
        orderType: 'limit',
        timeInForce: 'day',
        limitPrice: 100,
      }),
    ).rejects.toBeInstanceOf(TradeError);
  });
});

describe('placeWorkingOrder — limit sell', () => {
  it('decrements portfolio quantity', async () => {
    const { db, gamePlayerId } = await seed();
    await seedHolding(db, gamePlayerId, 'AAPL', 10);
    await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'sell',
      quantity: 4,
      orderType: 'limit',
      timeInForce: 'day',
      limitPrice: 110,
    });
    expect(await getQty(db, gamePlayerId, 'AAPL')).toBe(6);
  });

  it('rejects when shares are insufficient', async () => {
    const { db, gamePlayerId } = await seed();
    await seedHolding(db, gamePlayerId, 'AAPL', 3);
    await expect(
      placeWorkingOrder(db, {
        gamePlayerId,
        symbol: 'AAPL',
        direction: 'sell',
        quantity: 4,
        orderType: 'limit',
        timeInForce: 'day',
        limitPrice: 110,
      }),
    ).rejects.toBeInstanceOf(TradeError);
  });
});

describe('availableCash / availableShares', () => {
  it('availableCash reflects only the live cashBalance (reservations already deducted)', async () => {
    const { db, gamePlayerId } = await seed();
    expect(await availableCash(db, gamePlayerId)).toBe(10000);
    await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      orderType: 'limit',
      timeInForce: 'day',
      limitPrice: 100,
    });
    expect(await availableCash(db, gamePlayerId)).toBe(9500);
  });

  it('availableShares reflects the net portfolio after working sells are reserved', async () => {
    const { db, gamePlayerId } = await seed();
    await seedHolding(db, gamePlayerId, 'AAPL', 10);
    expect(await availableShares(db, gamePlayerId, 'AAPL')).toBe(10);
    await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'sell',
      quantity: 3,
      orderType: 'limit',
      timeInForce: 'day',
      limitPrice: 110,
    });
    // Placement physically decrements portfolio, so availableShares
    // returns the net remaining (10 - 3 = 7).
    expect(await availableShares(db, gamePlayerId, 'AAPL')).toBe(7);
  });
});

describe('cancelWorkingOrder', () => {
  it('refunds cash on a buy cancel', async () => {
    const { db, gamePlayerId } = await seed();
    const [order] = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      orderType: 'limit',
      timeInForce: 'day',
      limitPrice: 100,
    });
    await cancelWorkingOrder(db, gamePlayerId, order!.id);
    expect(await getCash(db, gamePlayerId)).toBe(10000);
    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, order!.id));
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelReason).toBe('USER_CANCELLED');
  });

  it('restores share count on a sell cancel', async () => {
    const { db, gamePlayerId } = await seed();
    await seedHolding(db, gamePlayerId, 'AAPL', 10);
    const [order] = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'sell',
      quantity: 4,
      orderType: 'limit',
      timeInForce: 'day',
      limitPrice: 110,
    });
    await cancelWorkingOrder(db, gamePlayerId, order!.id);
    expect(await getQty(db, gamePlayerId, 'AAPL')).toBe(10);
  });

  it('throws WorkingOrderNotFoundError for unknown id', async () => {
    const { db, gamePlayerId } = await seed();
    await expect(
      cancelWorkingOrder(db, gamePlayerId, 'nonexistent'),
    ).rejects.toBeInstanceOf(WorkingOrderNotFoundError);
  });
});

describe('evaluateTriggers — limit', () => {
  it('fills a limit buy when quote <= limit and credits the position', async () => {
    const { db, gamePlayerId } = await seed();
    const [order] = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      orderType: 'limit',
      timeInForce: 'day',
      limitPrice: 100,
    });
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 95 });

    const outcomes = await evaluateTriggers(db, provider);

    expect(ownedBy(outcomes, gamePlayerId).filter((o) => o.kind === 'filled')).toHaveLength(1);
    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, order!.id));
    expect(row?.status).toBe('executed');
    expect(Number(row?.price)).toBe(95);
    // Buy reserved 500 at 100; filled at 95 → refund 25
    expect(await getCash(db, gamePlayerId)).toBe(9525);
    expect(await getQty(db, gamePlayerId, 'AAPL')).toBe(5);
  });

  it('does not fill a limit buy when quote > limit', async () => {
    const { db, gamePlayerId } = await seed();
    await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      orderType: 'limit',
      timeInForce: 'day',
      limitPrice: 100,
    });
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 105 });

    const outcomes = await evaluateTriggers(db, provider);
    expect(ownedBy(outcomes, gamePlayerId)).toHaveLength(0);
  });

  it('fills a limit sell when quote >= limit', async () => {
    const { db, gamePlayerId } = await seed();
    await seedHolding(db, gamePlayerId, 'AAPL', 10);
    await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'sell',
      quantity: 4,
      orderType: 'limit',
      timeInForce: 'day',
      limitPrice: 110,
    });
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 115 });

    const outcomes = await evaluateTriggers(db, provider);
    expect(ownedBy(outcomes, gamePlayerId).filter((o) => o.kind === 'filled')).toHaveLength(1);
    expect(await getCash(db, gamePlayerId)).toBe(10000 + 4 * 115);
  });
});

describe('evaluateTriggers — stop', () => {
  it('stop sell on gap-down fills at the (lower) quote, not the stop price', async () => {
    const { db, gamePlayerId } = await seed();
    await seedHolding(db, gamePlayerId, 'AAPL', 10);
    await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'sell',
      quantity: 4,
      orderType: 'stop',
      timeInForce: 'day',
      stopPrice: 100,
    });
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 92 });

    const outcomes = await evaluateTriggers(db, provider);
    const filled = ownedBy(outcomes, gamePlayerId).filter(
      (o): o is Extract<typeof o, { kind: 'filled' }> => o.kind === 'filled',
    );
    expect(filled).toHaveLength(1);
    expect(filled[0]!.trade.price).toBe(92);
    expect(await getCash(db, gamePlayerId)).toBe(10000 + 4 * 92);
  });

  it('stop buy on gap-up cancels when reserved cash is insufficient', async () => {
    const { db, gamePlayerId } = await seed({ cash: 600 });
    // Reserve at stop=100 × 5 = 500, leaving 100 cash.
    const [order] = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      orderType: 'stop',
      timeInForce: 'day',
      stopPrice: 100,
    });
    expect(await getCash(db, gamePlayerId)).toBe(100);
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 200 }); // gap-up: needs 1000, only have 100+500=600

    const outcomes = await evaluateTriggers(db, provider);
    expect(ownedBy(outcomes, gamePlayerId).some((o) => o.kind === 'cancelled')).toBe(true);
    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, order!.id));
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelReason).toBe('INSUFFICIENT_FUNDS_AT_FILL');
    // Reservation was refunded
    expect(await getCash(db, gamePlayerId)).toBe(600);
  });
});

describe('evaluateTriggers — stop_limit', () => {
  it('first cross flips stopTriggeredAt without filling', async () => {
    const { db, gamePlayerId } = await seed();
    await seedHolding(db, gamePlayerId, 'AAPL', 10);
    const [order] = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'sell',
      quantity: 4,
      orderType: 'stop_limit',
      timeInForce: 'day',
      stopPrice: 100,
      limitPrice: 95,
    });
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 99 }); // stop crossed but no fill since 99 < 95-limit-for-sell

    const outcomes = await evaluateTriggers(db, provider);
    expect(ownedBy(outcomes, gamePlayerId).some((o) => o.kind === 'triggered')).toBe(true);
    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, order!.id));
    expect(row?.status).toBe('working');
    expect(row?.stopTriggeredAt).not.toBeNull();

    // Next tick: price recovers above limit → fills
    provider.setQuote('AAPL', { price: 96 });
    const o2 = await evaluateTriggers(db, provider);
    expect(ownedBy(o2, gamePlayerId).filter((o) => o.kind === 'filled')).toHaveLength(1);
  });
});

describe('evaluateTriggers — bracket', () => {
  let env: { db: Db; gamePlayerId: string };
  beforeEach(async () => {
    env = await seed({ cash: 100000 });
  });

  it('parent fills first, children wait, then TP fills and SL cancels (OCO)', async () => {
    const { db, gamePlayerId } = env;
    const orders = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 10,
      orderType: 'bracket',
      timeInForce: 'day',
      limitPrice: 100,
      takeProfitPrice: 120,
      stopLossPrice: 90,
    });
    expect(orders).toHaveLength(3);
    const parent = orders.find((o) => o.bracketRole === 'entry')!;
    const tp = orders.find((o) => o.bracketRole === 'take_profit')!;
    const sl = orders.find((o) => o.bracketRole === 'stop_loss')!;

    const provider = new MockStockProvider();
    // Tick 1: only parent eligible to fill at 95
    provider.setQuote('AAPL', { price: 95 });
    let outcomes = await evaluateTriggers(db, provider);
    expect(ownedBy(outcomes, gamePlayerId).filter((o) => o.kind === 'filled')).toHaveLength(1);
    const [parentRow] = await db.select().from(schema.trades).where(eq(schema.trades.id, parent.id));
    expect(parentRow?.status).toBe('executed');
    let [tpRow] = await db.select().from(schema.trades).where(eq(schema.trades.id, tp.id));
    expect(tpRow?.status).toBe('working');

    // Tick 2: price spikes to 121 → TP fills, SL cancels via OCO
    provider.setQuote('AAPL', { price: 121 });
    outcomes = await evaluateTriggers(db, provider);
    const filled = ownedBy(outcomes, gamePlayerId).filter((o) => o.kind === 'filled');
    expect(filled).toHaveLength(1);
    [tpRow] = await db.select().from(schema.trades).where(eq(schema.trades.id, tp.id));
    expect(tpRow?.status).toBe('executed');
    const [slRow] = await db.select().from(schema.trades).where(eq(schema.trades.id, sl.id));
    expect(slRow?.status).toBe('cancelled');
    expect(slRow?.cancelReason).toBe('OCO_SIBLING_FILLED');
  });

  it('long bracket round-trip leaves the position flat (no leaked shares)', async () => {
    const { db, gamePlayerId } = env;
    const orders = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'BRKT',
      direction: 'buy',
      quantity: 10,
      orderType: 'bracket',
      timeInForce: 'day',
      limitPrice: 100,
      takeProfitPrice: 120,
      stopLossPrice: 90,
    });
    const parent = orders.find((o) => o.bracketRole === 'entry')!;
    const tp = orders.find((o) => o.bracketRole === 'take_profit')!;

    const provider = new MockStockProvider();
    // Entry buy fills at 95 → player now holds 10 shares.
    provider.setQuote('BRKT', { price: 95 });
    await evaluateTriggers(db, provider);
    const [parentRow] = await db.select().from(schema.trades).where(eq(schema.trades.id, parent.id));
    expect(parentRow?.status).toBe('executed');
    expect(await getSymbolQty(db, gamePlayerId, 'BRKT')).toBe(10);

    // TP sell fills at 121 → position must return to flat (0 shares).
    provider.setQuote('BRKT', { price: 121 });
    await evaluateTriggers(db, provider);
    const [tpRow] = await db.select().from(schema.trades).where(eq(schema.trades.id, tp.id));
    expect(tpRow?.status).toBe('executed');

    // Regression: before the fix, the TP child sell credited the sale proceeds
    // but never decremented the holding (it was never reserved at placement),
    // leaving 10 phantom shares that inflated portfolio value.
    expect(await getSymbolQty(db, gamePlayerId, 'BRKT')).toBe(0);
  });

  it('short bracket round-trip leaves the position flat (no leaked shares)', async () => {
    const { db, gamePlayerId } = env;
    await seedHolding(db, gamePlayerId, 'SHRT', 10, 100);
    const orders = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'SHRT',
      direction: 'sell',
      quantity: 10,
      orderType: 'bracket',
      timeInForce: 'day',
      limitPrice: 100,
      // Short bracket: TP (buy-to-cover) below entry, SL (buy-to-cover) above.
      takeProfitPrice: 80,
      stopLossPrice: 120,
    });
    const parent = orders.find((o) => o.bracketRole === 'entry')!;
    const tp = orders.find((o) => o.bracketRole === 'take_profit')!;

    // Sell-entry decrements the holding at placement → 0 shares held.
    expect(await getSymbolQty(db, gamePlayerId, 'SHRT')).toBe(0);

    const provider = new MockStockProvider();
    // Entry sell fills at 100.
    provider.setQuote('SHRT', { price: 100 });
    await evaluateTriggers(db, provider);
    const [parentRow] = await db.select().from(schema.trades).where(eq(schema.trades.id, parent.id));
    expect(parentRow?.status).toBe('executed');

    // TP buy-to-cover fills at 79 → buys back the 10 shares.
    provider.setQuote('SHRT', { price: 79 });
    await evaluateTriggers(db, provider);
    const [tpRow] = await db.select().from(schema.trades).where(eq(schema.trades.id, tp.id));
    expect(tpRow?.status).toBe('executed');
    expect(await getSymbolQty(db, gamePlayerId, 'SHRT')).toBe(10);
  });

  it('cancelling a bracket parent before fill also cancels both children', async () => {
    const { db, gamePlayerId } = env;
    const orders = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 10,
      orderType: 'bracket',
      timeInForce: 'day',
      limitPrice: 100,
      takeProfitPrice: 120,
      stopLossPrice: 90,
    });
    const parent = orders.find((o) => o.bracketRole === 'entry')!;
    const result = await cancelWorkingOrder(db, gamePlayerId, parent.id);
    expect(result.cancelledIds).toHaveLength(3);
    const rows = await db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.gamePlayerId, gamePlayerId));
    expect(rows.every((r) => r.status === 'cancelled')).toBe(true);
  });
});

describe('expireDayOrders', () => {
  it('cancels working rows whose expiresAt is in the past', async () => {
    const { db, gamePlayerId } = await seed();
    const [order] = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      orderType: 'limit',
      timeInForce: 'day',
      limitPrice: 100,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    const result = await expireDayOrders(db);
    expect(result.cancelledIds).toContain(order!.id);
    expect(await getCash(db, gamePlayerId)).toBe(10000);
  });

  it('leaves GTC orders alone (expiresAt is null)', async () => {
    const { db, gamePlayerId } = await seed();
    await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 5,
      orderType: 'limit',
      timeInForce: 'gtc',
      limitPrice: 100,
    });
    const result = await expireDayOrders(db);
    expect(result.cancelledIds).toHaveLength(0);
  });
});

describe('getOpenOrderSymbols', () => {
  it('returns distinct symbols across all working/pending rows in active games', async () => {
    const { db, gamePlayerId } = await seed();
    // Use a symbol unique to this test so cross-test bleed doesn't pollute.
    await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'XGOS',
      direction: 'buy',
      quantity: 1,
      orderType: 'limit',
      timeInForce: 'day',
      limitPrice: 100,
    });
    await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'XGOS2',
      direction: 'buy',
      quantity: 1,
      orderType: 'limit',
      timeInForce: 'day',
      limitPrice: 100,
    });
    const symbols = await getOpenOrderSymbols(db);
    expect(symbols).toContain('XGOS');
    expect(symbols).toContain('XGOS2');
  });
});
