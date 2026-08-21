import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq, and } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import { schema } from '../../src/db/index.js';
import { executeTrade } from '../../src/services/trade.js';

/**
 * Every write that moves cash or shares must be expressed relative to the row's
 * own current value — `quantity = quantity + n`, never `quantity = <number>`.
 *
 * This is asserted against the emitted SQL rather than through a concurrent
 * writer because libsql's in-memory shared cache refuses a second simultaneous
 * transaction, so the race these writes lose cannot be staged in this suite.
 * The consequence is invisible on SQLite anyway: its writers are serialized.
 * On PostgreSQL READ COMMITTED an absolute write silently discards whatever a
 * concurrent transaction committed in between — and the sell paths mutate
 * `portfolios` WITHOUT touching `game_players`, so the cash-row lock does not
 * serialize them.
 *
 * Asserting on statement shape is white-box, and deliberately so: the shape IS
 * the invariant. A behavioural test would pass on either form here.
 */
function loggingDb(): { db: ReturnType<typeof drizzle>; queries: string[] } {
  const queries: string[] = [];
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client, {
    schema,
    logger: { logQuery: (query: string) => queries.push(query) },
  });
  return { db, queries };
}

/** Statements that write the portfolios table. */
function portfolioWrites(queries: string[]): string[] {
  return queries.filter((q) => /^update\s+"portfolios"/i.test(q.trim()));
}

async function seedPlayerWithHolding(): Promise<string> {
  // createTestDb migrates the shared in-memory database the logging client
  // below also opens.
  const db = await createTestDb();
  const [user] = await db
    .insert(schema.users)
    .values({ username: `rel-${Math.random().toString(36).slice(2, 10)}`, passwordHash: 'x' })
    .returning();
  const [game] = await db
    .insert(schema.games)
    .values({
      name: 'relative-writes',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance: 100_000,
      status: 'active',
      createdBy: user!.id,
    })
    .returning();
  const [player] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game!.id, userId: user!.id, cashBalance: 100_000 })
    .returning();
  await db.insert(schema.portfolios).values({
    gamePlayerId: player!.id,
    symbol: 'REL',
    quantity: 20,
    avgCostBasis: 50,
    openedAt: '2020-01-02T00:00:00.000Z',
  });
  return player!.id;
}

describe('F4 — holding writes are relative, not absolute', () => {
  it('adds to an existing position without ever writing a computed total', async () => {
    const gamePlayerId = await seedPlayerWithHolding();
    const { db, queries } = loggingDb();

    await executeTrade(db as never, {
      gamePlayerId,
      symbol: 'REL',
      direction: 'buy',
      quantity: 5,
      price: 100,
    });

    const writes = portfolioWrites(queries);
    expect(writes.length).toBeGreaterThan(0);

    // `set "quantity" = ?` is the absolute form this guards against. The
    // relative form references the column on the right-hand side.
    for (const stmt of writes) {
      expect(stmt).toMatch(/"quantity"\s*=\s*"portfolios"\."quantity"\s*[+-]/i);
      expect(stmt).not.toMatch(/set\s+"quantity"\s*=\s*\?/i);
    }

    // And the arithmetic still has to be right.
    const check = await createTestDb();
    const [row] = await check
      .select()
      .from(schema.portfolios)
      .where(
        and(
          eq(schema.portfolios.gamePlayerId, gamePlayerId),
          eq(schema.portfolios.symbol, 'REL'),
        ),
      )
      .limit(1);
    expect(row?.quantity).toBe(25);
    // (20 * 50 + 5 * 100) / 25 = 60
    expect(Number(row?.avgCostBasis)).toBeCloseTo(60, 6);
  });

  it('computes the new average from the row rather than from a prior read', async () => {
    const gamePlayerId = await seedPlayerWithHolding();
    const { db, queries } = loggingDb();

    await executeTrade(db as never, {
      gamePlayerId,
      symbol: 'REL',
      direction: 'buy',
      quantity: 20,
      price: 100,
    });

    for (const stmt of portfolioWrites(queries)) {
      expect(stmt).toMatch(/"avg_cost_basis"\s*=\s*\("portfolios"\."quantity"/i);
    }
  });
});
