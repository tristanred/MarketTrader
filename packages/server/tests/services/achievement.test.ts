import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/app.js';
import * as schema from '../../src/db/schema.sqlite.js';
import { AchievementEngine } from '../../src/achievements/engine.js';
import { EventBus } from '../../src/events/bus.js';
import { defineAchievement } from '../../src/achievements/define.js';
import { GameClientRegistry } from '../../src/ws/registry.js';
import { SystemSettingsService } from '../../src/services/system-settings.js';
import { getProgressForPlayer } from '../../src/services/achievement.js';
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
      achievementsEnabled: true,
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
  const engine = new AchievementEngine(db, bus, registry, settings, defs);
  engine.start();
  return { engine, bus };
}

const counterTo3 = defineAchievement({
  key: 'counter-3',
  name: 'Counter 3',
  description: 'Trade 3 times.',
  rarity: 'common',
  icon: 'circle',
  target: 3,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    await ctx.increment(event.gamePlayerId, 1);
  },
});

const secretOnTrade = defineAchievement({
  key: 'secret-one',
  name: 'Secret One',
  description: 'Secret.',
  rarity: 'legendary',
  icon: 'gem',
  target: 1,
  secret: true,
  events: ['trade.executed'],
  async onEvent(event, ctx) {
    await ctx.unlock(event.gamePlayerId);
  },
});

function tradeEvent(gameId: string, gamePlayerId: string, id: string) {
  return {
    type: 'trade.executed' as const,
    gameId,
    gamePlayerId,
    symbol: 'AAPL',
    direction: 'buy' as const,
    quantity: 1,
    price: 100,
    tradeId: id,
    executedAt: new Date().toISOString(),
  };
}

describe('getProgressForPlayer', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => { db = await createTestDb(); });

  it('includes locked non-secret defs and the owner in-progress rows when includeLocked=true', async () => {
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const { engine, bus } = makeEngine(db as unknown as Db, [counterTo3]);
    await bus.emit(tradeEvent(gameId, gamePlayerId, 't1')); // counter-3 -> 1/3 in-progress

    const view = await getProgressForPlayer(db as unknown as Db, engine, gameId, gamePlayerId, true);
    expect(view.definitions.map((d) => d.key)).toContain('counter-3');
    const rows = view.progress[gamePlayerId] ?? [];
    const row = rows.find((r) => r.achievementKey === 'counter-3');
    expect(row).toBeDefined();
    expect(row!.unlockedAt).toBeNull();
    expect(row!.progress).toBe(1);
  });

  it('omits in-progress rows when includeLocked=false (definition still listed)', async () => {
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const { engine, bus } = makeEngine(db as unknown as Db, [counterTo3]);
    await bus.emit(tradeEvent(gameId, gamePlayerId, 't1'));

    const view = await getProgressForPlayer(db as unknown as Db, engine, gameId, gamePlayerId, false);
    expect(view.definitions.map((d) => d.key)).toContain('counter-3'); // visible (non-secret)
    const rows = view.progress[gamePlayerId] ?? [];
    expect(rows.find((r) => r.achievementKey === 'counter-3')).toBeUndefined(); // in-progress hidden
  });

  it('hides a secret def until the player unlocks it', async () => {
    const { gameId, gamePlayerId } = await seedGame(db as unknown as Db);
    const { engine, bus } = makeEngine(db as unknown as Db, [secretOnTrade]);

    const before = await getProgressForPlayer(db as unknown as Db, engine, gameId, gamePlayerId, true);
    expect(before.definitions.map((d) => d.key)).not.toContain('secret-one');

    await bus.emit(tradeEvent(gameId, gamePlayerId, 't1')); // unlocks secret-one
    const after = await getProgressForPlayer(db as unknown as Db, engine, gameId, gamePlayerId, true);
    expect(after.definitions.map((d) => d.key)).toContain('secret-one');
    const rows = after.progress[gamePlayerId] ?? [];
    expect(rows.find((r) => r.achievementKey === 'secret-one')?.unlockedAt).not.toBeNull();
  });
});
