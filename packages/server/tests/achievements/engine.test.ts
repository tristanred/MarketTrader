import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import * as schema from '../../src/db/schema.sqlite.js';
import { AchievementEngine } from '../../src/achievements/engine.js';
import { EventBus } from '../../src/events/bus.js';
import { defineAchievement } from '../../src/achievements/define.js';
import { GameClientRegistry } from '../../src/ws/registry.js';
import { SystemSettingsService } from '../../src/services/system-settings.js';
import type { Db } from '../../src/db/index.js';

async function seedGame(db: Db, achievementsEnabled = true) {
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
      achievementsEnabled,
    })
    .returning();
  const [gp] = await db
    .insert(schema.gamePlayers)
    .values({ gameId: game!.id, userId: user!.id, cashBalance: 10000 })
    .returning();
  return { gameId: game!.id, gamePlayerId: gp!.id };
}

function makeEngine(db: Db, defs: ReturnType<typeof defineAchievement>[]) {
  const bus = new EventBus();
  const settings = new SystemSettingsService(db);
  const registry = new GameClientRegistry();
  const engine = new AchievementEngine(db as Db, bus, registry, settings, defs);
  engine.start();
  return { engine, bus, settings, registry };
}

describe('AchievementEngine', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('creates a progress row on first event and unlocks via unlock()', async () => {
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const def = defineAchievement({
      key: 'unlock-on-trade',
      name: 'X',
      description: 'X',
      rarity: 'common',
      icon: 'circle',
      target: 1,
      events: ['trade.executed'],
      async onEvent(event, ctx) {
        await ctx.unlock(event.gamePlayerId);
      },
    });
    const { bus } = makeEngine(db as unknown as Db, [def]);

    await bus.emit({
      type: 'trade.executed',
      gameId,
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      price: 100,
      tradeId: 't1',
      executedAt: new Date().toISOString(),
    });

    const [row] = await db
      .select()
      .from(schema.achievementProgress)
      .where(
        and(
          eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
          eq(schema.achievementProgress.achievementKey, 'unlock-on-trade'),
        ),
      );
    expect(row).toBeDefined();
    expect(row!.progress).toBe(1);
    expect(row!.unlockedAt).not.toBeNull();
  });

  // Helper: tests in this file share an in-memory DB (cache=shared). Always
  // scope queries to the current gamePlayerId to avoid bleed-through from
  // prior tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rowFor = (db: any, gpId: string, key: string) =>
    db
      .select()
      .from(schema.achievementProgress)
      .where(
        and(
          eq(schema.achievementProgress.gamePlayerId, gpId),
          eq(schema.achievementProgress.achievementKey, key),
        ),
      );

  it('increment() auto-unlocks when reaching target and is idempotent after', async () => {
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const def = defineAchievement({
      key: 'inc-3',
      name: 'X',
      description: 'X',
      rarity: 'common',
      icon: 'circle',
      target: 3,
      events: ['trade.executed'],
      async onEvent(event, ctx) {
        await ctx.increment(event.gamePlayerId, 1);
      },
    });
    const { bus } = makeEngine(db as unknown as Db, [def]);

    for (let i = 0; i < 5; i++) {
      await bus.emit({
        type: 'trade.executed',
        gameId,
        gamePlayerId,
        symbol: 'AAPL',
        direction: 'buy',
        quantity: 1,
        price: 100,
        tradeId: `t${i}`,
        executedAt: new Date().toISOString(),
      });
    }

    const [row] = await db
      .select()
      .from(schema.achievementProgress)
      .where(
        and(
          eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
          eq(schema.achievementProgress.achievementKey, 'inc-3'),
        ),
      );
    expect(row!.progress).toBe(3);
    expect(row!.unlockedAt).not.toBeNull();
  });

  it('setProgress() can decrease (reset) and skips when unlocked', async () => {
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const def = defineAchievement({
      key: 'streak-3',
      name: 'X',
      description: 'X',
      rarity: 'common',
      icon: 'circle',
      target: 3,
      events: ['snapshot.recorded'],
      async onEvent(event, ctx) {
        if (event.rank === event.totalPlayers) await ctx.increment(event.gamePlayerId, 1);
        else await ctx.setProgress(event.gamePlayerId, 0);
      },
    });
    const { bus } = makeEngine(db as unknown as Db, [def]);

    const snap = (rank: number, totalPlayers: number) =>
      bus.emit({
        type: 'snapshot.recorded',
        gameId,
        gamePlayerId,
        totalValue: 1,
        rank,
        totalPlayers,
        capturedAt: new Date().toISOString(),
      });

    await snap(2, 2);
    await snap(2, 2);
    let [row] = await rowFor(db, gamePlayerId, 'streak-3');
    expect(row!.progress).toBe(2);

    await snap(1, 2); // not last → reset
    [row] = await rowFor(db, gamePlayerId, 'streak-3');
    expect(row!.progress).toBe(0);

    await snap(2, 2);
    await snap(2, 2);
    await snap(2, 2);
    [row] = await rowFor(db, gamePlayerId, 'streak-3');
    expect(row!.progress).toBe(3);
    expect(row!.unlockedAt).not.toBeNull();

    // Further events do not touch the unlocked row.
    const beforeUnlockedAt = row!.unlockedAt;
    await snap(1, 2);
    [row] = await rowFor(db, gamePlayerId, 'streak-3');
    expect(row!.progress).toBe(3);
    expect(row!.unlockedAt).toBe(beforeUnlockedAt);
  });

  it('one handler throwing does not block other handlers', async () => {
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const bad = defineAchievement({
      key: 'bad',
      name: 'X',
      description: 'X',
      rarity: 'common',
      icon: 'circle',
      target: 1,
      events: ['trade.executed'],
      onEvent() {
        throw new Error('boom');
      },
    });
    const good = defineAchievement({
      key: 'good',
      name: 'X',
      description: 'X',
      rarity: 'common',
      icon: 'circle',
      target: 1,
      events: ['trade.executed'],
      async onEvent(event, ctx) {
        await ctx.unlock(event.gamePlayerId);
      },
    });
    const { bus } = makeEngine(db as unknown as Db, [bad, good]);

    await bus.emit({
      type: 'trade.executed',
      gameId,
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      price: 100,
      tradeId: 't',
      executedAt: new Date().toISOString(),
    });

    const rows = await db
      .select()
      .from(schema.achievementProgress)
      .where(eq(schema.achievementProgress.gamePlayerId, gamePlayerId));
    const goodRow = rows.find((r) => r.achievementKey === 'good');
    expect(goodRow?.unlockedAt).not.toBeNull();
  });

  it('honors the game-level achievementsEnabled flag', async () => {
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db, false);
    const def = defineAchievement({
      key: 'should-not-fire',
      name: 'X',
      description: 'X',
      rarity: 'common',
      icon: 'circle',
      target: 1,
      events: ['trade.executed'],
      async onEvent(event, ctx) {
        await ctx.unlock(event.gamePlayerId);
      },
    });
    const { bus } = makeEngine(db as unknown as Db, [def]);

    await bus.emit({
      type: 'trade.executed',
      gameId,
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      price: 100,
      tradeId: 't',
      executedAt: new Date().toISOString(),
    });

    const rows = await db
      .select()
      .from(schema.achievementProgress)
      .where(eq(schema.achievementProgress.gamePlayerId, gamePlayerId));
    expect(rows).toHaveLength(0);
  });

  it('broadcast includes rarity and icon', async () => {
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const def = defineAchievement({
      key: 'broadcast-fields',
      name: 'Broadcast Test',
      description: 'desc',
      rarity: 'common',
      icon: 'circle',
      target: 1,
      events: ['trade.executed'],
      async onEvent(event, ctx) {
        await ctx.unlock(event.gamePlayerId);
      },
    });
    const { bus, registry } = makeEngine(db as unknown as Db, [def]);
    vi.spyOn(registry, 'broadcast');

    await bus.emit({
      type: 'trade.executed',
      gameId,
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      price: 100,
      tradeId: 't-broadcast',
      executedAt: new Date().toISOString(),
    });

    expect(registry.broadcast).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        event: 'achievement_unlocked',
        data: expect.objectContaining({
          rarity: 'common',
          icon: 'circle',
        }),
      }),
    );
  });

  it('routes position.closed events to subscribed achievements by gameId', async () => {
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const def = defineAchievement({
      key: 'test-pc',
      name: 'Test PC',
      description: '',
      rarity: 'common',
      icon: 'star',
      target: 1,
      events: ['position.closed'],
      async onEvent(event, ctx) {
        await ctx.unlock(event.gamePlayerId);
      },
    });
    const { bus } = makeEngine(db as unknown as Db, [def]);

    await bus.emit({
      type: 'position.closed',
      gameId,
      gamePlayerId,
      symbol: 'AAPL',
      quantity: 1,
      realizedPnl: 0,
      realizedPnlPct: 0,
      holdDurationMs: 0,
      fullyClosed: false,
      closedAt: new Date().toISOString(),
    });

    const [row] = await rowFor(db, gamePlayerId, 'test-pc');
    expect(row?.unlockedAt).not.toBeNull();
  });

  it('honors the global disable setting and per-game override', async () => {
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const def = defineAchievement({
      key: 'toggleable',
      name: 'X',
      description: 'X',
      rarity: 'common',
      icon: 'circle',
      target: 1,
      events: ['trade.executed'],
      async onEvent(event, ctx) {
        await ctx.unlock(event.gamePlayerId);
      },
    });
    const { bus, settings, engine } = makeEngine(db as unknown as Db, [def]);

    // Global disable wins.
    await settings.setAchievementGloballyEnabled('toggleable', false, null);
    engine.invalidateCache();
    await bus.emit({
      type: 'trade.executed',
      gameId,
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      price: 100,
      tradeId: 't1',
      executedAt: new Date().toISOString(),
    });
    expect(await rowFor(db, gamePlayerId, 'toggleable')).toHaveLength(0);

    // Re-enable globally, fire again → unlocks.
    await settings.setAchievementGloballyEnabled('toggleable', true, null);
    engine.invalidateCache();
    await bus.emit({
      type: 'trade.executed',
      gameId,
      gamePlayerId,
      symbol: 'AAPL',
      direction: 'buy',
      quantity: 1,
      price: 100,
      tradeId: 't2',
      executedAt: new Date().toISOString(),
    });
    const rows = await rowFor(db, gamePlayerId, 'toggleable');
    expect(rows[0]?.unlockedAt).not.toBeNull();
  });
});
