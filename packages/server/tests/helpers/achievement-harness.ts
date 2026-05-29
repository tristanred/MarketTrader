import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from './app.js';
import * as schema from '../../src/db/schema.sqlite.js';
import { AchievementEngine } from '../../src/achievements/engine.js';
import { EventBus } from '../../src/events/bus.js';
import { GameClientRegistry } from '../../src/ws/registry.js';
import { SystemSettingsService } from '../../src/services/system-settings.js';
import type { Db } from '../../src/db/index.js';
import type { AnyAchievementDefinition } from '../../src/achievements/define.js';
import type { DomainEvent } from '../../src/events/types.js';

export interface SeededPlayer {
  userId: string;
  gamePlayerId: string;
}

export interface AchievementHarness {
  db: Db;
  bus: EventBus;
  engine: AchievementEngine;
  registry: GameClientRegistry;
  gameId: string;
  /** The first seeded player. Convenience for single-player tests. */
  gamePlayerId: string;
  /** All seeded players, in order. players[0] is the same as gamePlayerId. */
  players: SeededPlayer[];
  /** Captured WS broadcasts the engine made (achievement_unlocked frames). */
  broadcasts: Array<{ gameId: string; frame: unknown }>;
  /** Emit a domain event via the bus. Awaits the engine handler's settle. */
  dispatch: (event: DomainEvent) => Promise<void>;
  /** Convenience: returns the progress row for the harness' achievement + first player. */
  isUnlocked: (gamePlayerId?: string) => Promise<boolean>;
  /** Convenience: returns the current progress value for the harness' achievement + a player. */
  progress: (gamePlayerId?: string) => Promise<number>;
  /** Tear down (stop engine subscriptions). Tests can call manually; usually not needed. */
  stop: () => void;
}

export interface MakeAchievementHarnessOptions {
  /** How many players to seed. Default 1. */
  numPlayers?: number;
  /** Game starting balance. Default 10000. */
  startingBalance?: number;
  /** Whether to enable achievements on the game. Default true. */
  achievementsEnabled?: boolean;
}

/**
 * Builds an in-memory test harness for an achievement definition. Seeds a game
 * + N players, wires up an EventBus + AchievementEngine, and returns helpers
 * for dispatching events and asserting unlock state.
 *
 * The harness intercepts WS broadcasts via a wrapped GameClientRegistry so
 * tests can assert on emit ordering / payload without standing up a socket.
 */
export async function makeAchievementHarness(
  definition: AnyAchievementDefinition,
  options: MakeAchievementHarnessOptions = {},
): Promise<AchievementHarness> {
  const numPlayers = options.numPlayers ?? 1;
  const startingBalance = options.startingBalance ?? 10000;
  const achievementsEnabled = options.achievementsEnabled ?? true;

  const db = (await createTestDb()) as unknown as Db;

  const [user0] = await db
    .insert(schema.users)
    .values({ username: `u0-${randomUUID()}`, passwordHash: 'x' })
    .returning();
  const [game] = await db
    .insert(schema.games)
    .values({
      name: 'g',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2099-01-01T00:00:00.000Z',
      startingBalance,
      createdBy: user0!.id,
      achievementsEnabled,
    })
    .returning();

  const players: SeededPlayer[] = [];
  for (let i = 0; i < numPlayers; i++) {
    const u = i === 0
      ? user0!
      : (await db.insert(schema.users).values({ username: `u${i}-${randomUUID()}`, passwordHash: 'x' }).returning())[0]!;
    const [gp] = await db
      .insert(schema.gamePlayers)
      .values({ gameId: game!.id, userId: u.id, cashBalance: startingBalance })
      .returning();
    players.push({ userId: u.id, gamePlayerId: gp!.id });
  }

  const broadcasts: Array<{ gameId: string; frame: unknown }> = [];
  // Wrap registry.broadcast so tests can assert without a socket.
  const registry = new GameClientRegistry();
  const origBroadcast = registry.broadcast.bind(registry);
  registry.broadcast = ((gameId: string, frame: unknown) => {
    broadcasts.push({ gameId, frame });
    // Don't actually call origBroadcast — no sockets to send to.
    return origBroadcast;
  }) as typeof registry.broadcast;

  const settings = new SystemSettingsService(db);
  const bus = new EventBus();
  const engine = new AchievementEngine(db, bus, registry, settings, [definition]);
  engine.start();

  const dispatch = async (event: DomainEvent): Promise<void> => {
    await bus.emit(event);
    // Engine handlers run via Promise.allSettled in bus.emit; give one tick to settle.
    await new Promise((resolve) => setImmediate(resolve));
  };

  const isUnlocked = async (gamePlayerId?: string): Promise<boolean> => {
    const target = gamePlayerId ?? players[0]!.gamePlayerId;
    const [row] = await db
      .select({ unlockedAt: schema.achievementProgress.unlockedAt })
      .from(schema.achievementProgress)
      .where(
        and(
          eq(schema.achievementProgress.gamePlayerId, target),
          eq(schema.achievementProgress.achievementKey, definition.key),
        ),
      )
      .limit(1);
    return row?.unlockedAt != null;
  };

  const progress = async (gamePlayerId?: string): Promise<number> => {
    const target = gamePlayerId ?? players[0]!.gamePlayerId;
    const [row] = await db
      .select({ progress: schema.achievementProgress.progress })
      .from(schema.achievementProgress)
      .where(
        and(
          eq(schema.achievementProgress.gamePlayerId, target),
          eq(schema.achievementProgress.achievementKey, definition.key),
        ),
      )
      .limit(1);
    return row?.progress ?? 0;
  };

  return {
    db,
    bus,
    engine,
    registry,
    gameId: game!.id,
    gamePlayerId: players[0]!.gamePlayerId,
    players,
    broadcasts,
    dispatch,
    isUnlocked,
    progress,
    stop: () => engine.stop(),
  };
}
