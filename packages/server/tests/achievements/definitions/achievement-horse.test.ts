import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../../helpers/app.js';
import * as schema from '../../../src/db/schema.sqlite.js';
import { AchievementEngine } from '../../../src/achievements/engine.js';
import { EventBus } from '../../../src/events/bus.js';
import { defineAchievement } from '../../../src/achievements/define.js';
import { GameClientRegistry } from '../../../src/ws/registry.js';
import { SystemSettingsService } from '../../../src/services/system-settings.js';
import achievementHorse from '../../../src/achievements/definitions/achievement-horse.js';
import type { Db } from '../../../src/db/index.js';
import type { AnyAchievementDefinition } from '../../../src/achievements/define.js';

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
      achievementsEnabled: true,
    })
    .returning();
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game!.id, userId: user!.id, cashBalance: 10000 })
    .returning();
  return { gameId: game!.id, gamePlayerId: gp!.id };
}

/**
 * Stub achievements that unlock only when a trade with the matching tradeId
 * fires. Lets tests drive exactly one stub unlock per dispatched trade so
 * the horse can react via the achievement.unlocked domain event.
 */
function makeStub(key: string, triggerTradeId: string): AnyAchievementDefinition {
  return defineAchievement({
    key,
    name: key,
    description: key,
    rarity: 'common',
    icon: 'circle',
    target: 1,
    events: ['trade.executed'],
    async onEvent(event, ctx) {
      if (event.tradeId !== triggerTradeId) return;
      await ctx.unlock(event.gamePlayerId);
    },
  });
}

function makeEngine(db: Db, defs: AnyAchievementDefinition[]) {
  const bus = new EventBus();
  const settings = new SystemSettingsService(db);
  const registry = new GameClientRegistry();
  const engine = new AchievementEngine(db, bus, registry, settings, defs);
  engine.start();
  return { engine, bus, settings, registry };
}

async function fireTrade(
  bus: EventBus,
  gameId: string,
  gamePlayerId: string,
  tradeId: string,
): Promise<void> {
  await bus.emit({
    type: 'trade.executed',
    gameId,
    gamePlayerId,
    symbol: 'AAPL',
    direction: 'buy',
    quantity: 1,
    price: 100,
    tradeId,
    executedAt: new Date().toISOString(),
  });
  await new Promise((resolve) => setImmediate(resolve));
}

async function isHorseUnlocked(db: Db, gamePlayerId: string): Promise<boolean> {
  const [row] = await db
    .select({ unlockedAt: schema.achievementProgress.unlockedAt })
    .from(schema.achievementProgress)
    .where(
      and(
        eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
        eq(schema.achievementProgress.achievementKey, 'achievement-horse'),
      ),
    )
    .limit(1);
  return row?.unlockedAt != null;
}

describe('achievement: achievement-horse', () => {
  let db: Db;

  beforeEach(async () => {
    db = (await createTestDb()) as unknown as Db;
  });

  it('unlocks when the player has acquired strictly more than half of the other achievements', async () => {
    const { gameId, gamePlayerId } = await seedGame(db);
    // 4 other achievements; need > 2 (i.e. 3) unlocked to trigger the horse.
    const stubs = [makeStub('s1', 't1'), makeStub('s2', 't2'), makeStub('s3', 't3'), makeStub('s4', 't4')];
    const { bus } = makeEngine(db, [...stubs, achievementHorse]);

    await fireTrade(bus, gameId, gamePlayerId, 't1');
    await fireTrade(bus, gameId, gamePlayerId, 't2');
    expect(await isHorseUnlocked(db, gamePlayerId)).toBe(false);

    await fireTrade(bus, gameId, gamePlayerId, 't3');
    expect(await isHorseUnlocked(db, gamePlayerId)).toBe(true);
  });

  it('does not unlock at exactly half', async () => {
    const { gameId, gamePlayerId } = await seedGame(db);
    // 4 other achievements; 2 unlocked is exactly half, not strictly more.
    const stubs = [makeStub('s1', 't1'), makeStub('s2', 't2'), makeStub('s3', 't3'), makeStub('s4', 't4')];
    const { bus } = makeEngine(db, [...stubs, achievementHorse]);

    await fireTrade(bus, gameId, gamePlayerId, 't1');
    await fireTrade(bus, gameId, gamePlayerId, 't2');
    expect(await isHorseUnlocked(db, gamePlayerId)).toBe(false);
  });

  it('does not count the horse itself in the denominator', async () => {
    const { gameId, gamePlayerId } = await seedGame(db);
    // 3 other achievements; > 1.5 means 2 unlocks trigger the horse.
    // If the horse counted itself the denominator would be 4 and 2 unlocks
    // would not yet cross the threshold.
    const stubs = [makeStub('s1', 't1'), makeStub('s2', 't2'), makeStub('s3', 't3')];
    const { bus } = makeEngine(db, [...stubs, achievementHorse]);

    await fireTrade(bus, gameId, gamePlayerId, 't1');
    await fireTrade(bus, gameId, gamePlayerId, 't2');
    expect(await isHorseUnlocked(db, gamePlayerId)).toBe(true);
  });

  it('only unlocks once even if more achievements arrive after the threshold', async () => {
    const { gameId, gamePlayerId } = await seedGame(db);
    const stubs = [makeStub('s1', 't1'), makeStub('s2', 't2'), makeStub('s3', 't3')];
    const { bus } = makeEngine(db, [...stubs, achievementHorse]);

    await fireTrade(bus, gameId, gamePlayerId, 't1');
    await fireTrade(bus, gameId, gamePlayerId, 't2');
    const [first] = await db
      .select({ unlockedAt: schema.achievementProgress.unlockedAt })
      .from(schema.achievementProgress)
      .where(
        and(
          eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
          eq(schema.achievementProgress.achievementKey, 'achievement-horse'),
        ),
      )
      .limit(1);
    expect(first?.unlockedAt).not.toBeNull();

    await fireTrade(bus, gameId, gamePlayerId, 't3');
    const [second] = await db
      .select({ unlockedAt: schema.achievementProgress.unlockedAt })
      .from(schema.achievementProgress)
      .where(
        and(
          eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
          eq(schema.achievementProgress.achievementKey, 'achievement-horse'),
        ),
      )
      .limit(1);
    expect(second?.unlockedAt).toBe(first?.unlockedAt);
  });

  it('is independent across players', async () => {
    const { gameId, gamePlayerId } = await seedGame(db);
    // Add a second player to the same game.
    const [user2] = await db
      .insert(schema.users)
      .values({ username: `u2-${Math.random().toString(36).slice(2)}`, passwordHash: 'x' })
      .returning();
    const [gp2] = await db
      .insert(schema.gamePlayers)
      .values({ gameId, userId: user2!.id, cashBalance: 10000 })
      .returning();

    const stubs = [makeStub('s1', 't1'), makeStub('s2', 't2'), makeStub('s3', 't3')];
    const { bus } = makeEngine(db, [...stubs, achievementHorse]);

    await fireTrade(bus, gameId, gamePlayerId, 't1');
    await fireTrade(bus, gameId, gamePlayerId, 't2');
    expect(await isHorseUnlocked(db, gamePlayerId)).toBe(true);
    expect(await isHorseUnlocked(db, gp2!.id)).toBe(false);
  });

  it('respects per-game achievement overrides when counting available achievements', async () => {
    const { gameId, gamePlayerId } = await seedGame(db);
    // 4 stubs, but one is disabled per-game → denominator drops to 3,
    // so 2 unlocks (> 1.5) is enough to trigger the horse.
    const stubs = [makeStub('s1', 't1'), makeStub('s2', 't2'), makeStub('s3', 't3'), makeStub('s4', 't4')];
    await db.insert(schema.gameAchievementOverrides).values({
      gameId,
      achievementKey: 's4',
      enabled: false,
    });
    const { bus } = makeEngine(db, [...stubs, achievementHorse]);

    await fireTrade(bus, gameId, gamePlayerId, 't1');
    await fireTrade(bus, gameId, gamePlayerId, 't2');
    expect(await isHorseUnlocked(db, gamePlayerId)).toBe(true);
  });
});
