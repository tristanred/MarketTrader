import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import * as schema from '../../src/db/schema.sqlite.js';
import { AchievementEngine } from '../../src/achievements/engine.js';
import { EventBus } from '../../src/events/bus.js';
import { GameClientRegistry } from '../../src/ws/registry.js';
import { SystemSettingsService } from '../../src/services/system-settings.js';
import firstTrade from '../../src/achievements/definitions/first-trade.js';
import tenBuys from '../../src/achievements/definitions/ten-buys.js';
import rockBottom from '../../src/achievements/definitions/rock-bottom.js';
import type { Db } from '../../src/db/index.js';

async function seedGame(db: Db) {
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
  return { gameId: game!.id, gamePlayerId: gp!.id };
}

function makeEngine(db: Db) {
  const bus = new EventBus();
  const engine = new AchievementEngine(
    db,
    bus,
    new GameClientRegistry(),
    new SystemSettingsService(db),
    [firstTrade, tenBuys, rockBottom],
  );
  engine.start();
  return bus;
}

describe('first-trade definition', () => {
  it('unlocks on any trade.executed', async () => {
    const db = await createTestDb();
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const bus = makeEngine(db as unknown as Db);
    await bus.emit({
      type: 'trade.executed',
      gameId,
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'sell',
      quantity: 1,
      price: 100,
      tradeId: 't',
      executedAt: new Date().toISOString(),
    });
    const [row] = await db
      .select()
      .from(schema.achievementProgress)
      .where(eq(schema.achievementProgress.achievementKey, 'first-trade'));
    expect(row?.unlockedAt).not.toBeNull();
  });
});

describe('ten-buys definition', () => {
  it('only counts buys; unlocks at 10', async () => {
    const db = await createTestDb();
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const bus = makeEngine(db as unknown as Db);

    // 3 sells should not move the counter.
    for (let i = 0; i < 3; i++) {
      await bus.emit({
        type: 'trade.executed',
        gameId,
        gamePlayerId,
        symbol: 'AAPL',
        direction: 'sell',
        quantity: 1,
        price: 100,
        tradeId: `s${i}`,
        executedAt: new Date().toISOString(),
      });
    }
    // 10 buys → unlock.
    for (let i = 0; i < 10; i++) {
      await bus.emit({
        type: 'trade.executed',
        gameId,
        gamePlayerId,
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        price: 100,
        tradeId: `b${i}`,
        executedAt: new Date().toISOString(),
      });
    }
    const [row] = await db
      .select()
      .from(schema.achievementProgress)
      .where(eq(schema.achievementProgress.achievementKey, 'ten-buys'));
    expect(row?.progress).toBe(10);
    expect(row?.unlockedAt).not.toBeNull();
  });
});

describe('rock-bottom definition', () => {
  it('mirrors consecutiveDaysInLastPlace and ignores single-player games', async () => {
    const db = await createTestDb();
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const bus = makeEngine(db as unknown as Db);
    const snap = (totalPlayers: number) =>
      bus.emit({
        type: 'snapshot.recorded',
        gameId,
        gamePlayerId,
        totalValue: 1,
        rank: totalPlayers, // last
        totalPlayers,
        capturedAt: new Date().toISOString(),
      });

    const setConsec = async (n: number) => {
      await db
        .insert(schema.gamePlayerStats)
        .values({ gamePlayerId, consecutiveDaysInLastPlace: n })
        .onConflictDoUpdate({
          target: schema.gamePlayerStats.gamePlayerId,
          set: { consecutiveDaysInLastPlace: n },
        });
    };

    const rowsFor = () =>
      db
        .select()
        .from(schema.achievementProgress)
        .where(
          and(
            eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
            eq(schema.achievementProgress.achievementKey, 'rock-bottom'),
          ),
        );

    // Single-player game: ignored even with stats present.
    await setConsec(3);
    await snap(1);
    expect(await rowsFor()).toHaveLength(0);

    // 2 days in last place → progress 2, not unlocked.
    await setConsec(2);
    await snap(3);
    let [row] = await rowsFor();
    expect(row?.progress).toBe(2);
    expect(row?.unlockedAt).toBeNull();

    // 3 days → unlock.
    await setConsec(3);
    await snap(3);
    [row] = await rowsFor();
    expect(row?.progress).toBe(3);
    expect(row?.unlockedAt).not.toBeNull();
  });
});
