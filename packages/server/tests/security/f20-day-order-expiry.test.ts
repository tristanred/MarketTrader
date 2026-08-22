import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createTestApp, createTestDb } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { nextSessionClose } from '../../src/services/market-calendar.js';
import {
  placeWorkingOrder,
  evaluateTriggers,
  expireDayOrders,
} from '../../src/services/working-order.js';
import { schema } from '../../src/db/index.js';

type Db = Awaited<ReturnType<typeof createTestDb>>;

/** Wall-clock stamp in America/New_York, for assertions that survive DST. */
function etStamp(d: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const m = new Map(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return `${m.get('year')}-${m.get('month')}-${m.get('day')} ${m.get('hour')}:${m.get('minute')}`;
}

async function qtyOf(db: Db, gamePlayerId: string, symbol: string): Promise<number> {
  const [h] = await db
    .select({ q: schema.portfolios.quantity })
    .from(schema.portfolios)
    .where(
      and(eq(schema.portfolios.gamePlayerId, gamePlayerId), eq(schema.portfolios.symbol, symbol)),
    );
  return h?.q ?? 0;
}

async function cashOf(db: Db, gamePlayerId: string): Promise<number> {
  const [p] = await db
    .select({ c: schema.gamePlayers.cashBalance })
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.id, gamePlayerId));
  return Number(p?.c ?? 0);
}

async function seedGame(db: Db): Promise<string> {
  const [user] = await db
    .insert(schema.users)
    .values({ username: `f20e_${Math.random().toString(36).slice(2, 10)}`, passwordHash: 'x' })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('seed user');
  const [game] = await db
    .insert(schema.games)
    .values({
      name: `f20e_${Math.random().toString(36).slice(2, 8)}`,
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 10000,
      status: 'active',
      createdBy: user.id,
      allowBracketOrders: true,
    })
    .returning({ id: schema.games.id });
  if (!game) throw new Error('seed game');
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game.id, userId: user.id, cashBalance: 10000 })
    .returning({ id: schema.gamePlayers.id });
  if (!gp) throw new Error('seed gp');
  return gp.id;
}

describe('nextSessionClose', () => {
  it('returns today’s close during a regular session', () => {
    // Wed 2026-08-19 14:00 ET
    expect(etStamp(nextSessionClose(new Date('2026-08-19T18:00:00Z')))).toBe('2026-08-19 16:00');
  });

  it('rolls to Monday after Friday’s close', () => {
    // Fri 2026-08-21 16:30 ET
    expect(etStamp(nextSessionClose(new Date('2026-08-21T20:30:00Z')))).toBe('2026-08-24 16:00');
  });

  it('rolls to Monday from a Saturday', () => {
    // Sat 2026-08-22 12:00 ET
    expect(etStamp(nextSessionClose(new Date('2026-08-22T16:00:00Z')))).toBe('2026-08-24 16:00');
  });

  it('skips NYSE holidays', () => {
    // Wed 2026-11-25 17:00 ET — Thu 11-26 is Thanksgiving.
    expect(etStamp(nextSessionClose(new Date('2026-11-25T22:00:00Z')))).toBe('2026-11-27 16:00');
  });

  it('extends to the post-market boundary when extended hours count as open', () => {
    const opts = { includeExtended: true };
    // Mid-session, and again after the regular close but during POST.
    expect(etStamp(nextSessionClose(new Date('2026-08-19T18:00:00Z'), opts))).toBe(
      '2026-08-19 20:00',
    );
    expect(etStamp(nextSessionClose(new Date('2026-08-19T21:00:00Z'), opts))).toBe(
      '2026-08-19 20:00',
    );
  });

  it('orders lexicographically the way expireDayOrders needs it to', () => {
    // expireDayOrders has no time predicate: it compares expiresAt as TEXT
    // against `new Date().toISOString()`. String order therefore has to agree
    // with chronological order, which only holds for the fixed-width UTC form.
    //
    // Asserting the regex on `.toISOString()` would prove nothing — that method
    // always returns that shape. What can actually regress is someone storing a
    // different rendering (an offset form like 2026-08-19T16:00:00-04:00, or a
    // Date coerced by the driver), so compare orderings directly.
    const close = nextSessionClose(new Date('2026-08-19T18:00:00Z'));
    const before = new Date(close.getTime() - 1000);
    const after = new Date(close.getTime() + 1000);

    expect(before.toISOString() < close.toISOString()).toBe(true);
    expect(after.toISOString() > close.toISOString()).toBe(true);

    // The offset form names the same instant but sorts as though it were four
    // hours earlier, so `expiresAt < now` fires before the session has closed.
    // That is the substitution this guards against.
    const offsetForm = '2026-08-19T16:00:00-04:00';
    const anHourBeforeClose = new Date(close.getTime() - 3_600_000).toISOString();

    expect(new Date(offsetForm).getTime()).toBe(close.getTime());
    // Correct rendering: not yet expired an hour before the close.
    expect(close.toISOString() < anHourBeforeClose).toBe(false);
    // Offset rendering: already "expired", an hour early.
    expect(offsetForm < anHourBeforeClose).toBe(true);
  });
});

describe('expiring a day bracket whose entry already filled', () => {
  it('cancels both children without crediting shares they never reserved', async () => {
    const db = await createTestDb();
    const gamePlayerId = await seedGame(db);
    const orders = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'BRKX',
      direction: 'buy',
      quantity: 10,
      orderType: 'bracket',
      timeInForce: 'day',
      limitPrice: 100,
      takeProfitPrice: 120,
      stopLossPrice: 90,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    const parent = orders.find((o) => o.bracketRole === 'entry')!;
    const tp = orders.find((o) => o.bracketRole === 'take_profit')!;
    const sl = orders.find((o) => o.bracketRole === 'stop_loss')!;

    const provider = new MockStockProvider();
    provider.setQuote('BRKX', { price: 95 });
    await evaluateTriggers(db, provider);

    const qtyAfterEntry = await qtyOf(db, gamePlayerId, 'BRKX');
    const cashAfterEntry = await cashOf(db, gamePlayerId);
    expect(qtyAfterEntry).toBe(10);

    await expireDayOrders(db);

    for (const id of [tp.id, sl.id]) {
      const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, id));
      expect(row?.status).toBe('cancelled');
    }
    const [parentRow] = await db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, parent.id));
    expect(parentRow?.status).toBe('executed');

    // The entry's fill already credited these shares; expiry must not repeat it.
    expect(await qtyOf(db, gamePlayerId, 'BRKX')).toBe(qtyAfterEntry);
    expect(await cashOf(db, gamePlayerId)).toBe(cashAfterEntry);
  });

  it('expires an unfilled bracket once, refunding only the entry', async () => {
    const db = await createTestDb();
    const gamePlayerId = await seedGame(db);
    const orders = await placeWorkingOrder(db, {
      gamePlayerId,
      symbol: 'BRKY',
      direction: 'buy',
      quantity: 10,
      orderType: 'bracket',
      timeInForce: 'day',
      limitPrice: 100,
      takeProfitPrice: 120,
      stopLossPrice: 90,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    expect(await cashOf(db, gamePlayerId)).toBe(9000);

    // expireDayOrders sees all three rows; cancelling the parent cascades to
    // the children, so the later iterations hit already-cancelled rows.
    await expireDayOrders(db);

    for (const o of orders) {
      const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, o.id));
      expect(row?.status).toBe('cancelled');
    }
    expect(await cashOf(db, gamePlayerId)).toBe(10000);
    expect(await qtyOf(db, gamePlayerId, 'BRKY')).toBe(0);
  });
});

describe('POST /games/:id/trades — day-TIF orders get an expiry', () => {
  let app: FastifyInstance;
  let token: string;
  let gameId: string;

  beforeAll(async () => {
    const provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 100 });
    app = await createTestApp(provider);
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'f20-expiry', password: 'password123' },
    });
    token = reg.json<{ token: string }>().token;
    const game = await app.inject({
      method: 'POST',
      url: '/games',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        name: 'F20Expiry',
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: '2099-01-01T00:00:00.000Z',
        startingBalance: 100000,
        allowLimitOrders: true,
        allowGTC: true,
      },
    });
    gameId = game.json<{ id: string }>().id;
  });

  afterAll(async () => app.close());

  async function place(timeInForce: 'day' | 'gtc') {
    const res = await app.inject({
      method: 'POST',
      url: `/games/${gameId}/trades`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        orderType: 'limit',
        timeInForce,
        limitPrice: 50,
      },
    });
    expect(res.statusCode).toBe(202);
    const order = res.json<{ orders: Array<{ expiresAt: string | null }> }>().orders[0];
    if (!order) throw new Error('no order returned');
    return order;
  }

  it('stamps a day order with the next session close', async () => {
    const order = await place('day');
    expect(order.expiresAt).not.toBeNull();
    expect(Date.parse(order.expiresAt!)).toBeGreaterThan(Date.now());
    expect(order.expiresAt).toBe(nextSessionClose(new Date()).toISOString());
  });

  it('leaves a GTC order without an expiry', async () => {
    const order = await place('gtc');
    expect(order.expiresAt).toBeNull();
  });
});
