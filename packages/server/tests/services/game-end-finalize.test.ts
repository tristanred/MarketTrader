import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/app.js';
import { schema } from '../../src/db/index.js';
import type { Db } from '../../src/db/index.js';
import { recomputeGameStatus } from '../../src/services/game-status.js';
import { applySnapshotStats } from '../../src/services/game-player-stats.js';
import { AchievementEngine } from '../../src/achievements/engine.js';
import { EventBus } from '../../src/events/bus.js';
import { GameClientRegistry } from '../../src/ws/registry.js';
import { SystemSettingsService } from '../../src/services/system-settings.js';
import rockBottom from '../../src/achievements/definitions/rock-bottom.js';

describe('game-end finalize path', () => {
  it('unlocks rock-bottom when a player is last on each of the final 3 days', async () => {
    const db = (await createTestDb()) as unknown as Db;
    const [u1] = await db.insert(schema.users).values({ username: 'p1', passwordHash: 'x' }).returning();
    const [u2] = await db.insert(schema.users).values({ username: 'p2', passwordHash: 'x' }).returning();
    const [game] = await db
      .insert(schema.games)
      .values({
        name: 'g',
        startDate: '2026-05-23T00:00:00.000Z',
        endDate: '2026-05-25T23:59:59.000Z',
        startingBalance: 10000,
        createdBy: u1!.id,
        achievementsEnabled: true,
      })
      .returning();
    const [gp1] = await db.insert(schema.gamePlayers).values({ gameId: game!.id, userId: u1!.id, cashBalance: 10000 }).returning();
    const [gp2] = await db.insert(schema.gamePlayers).values({ gameId: game!.id, userId: u2!.id, cashBalance: 5000 }).returning();

    // gp2 is last on 3 consecutive days (5/23, 5/24, 5/25). applySnapshotStats
    // advances day counters only on rollover, so after 3 days of snapshots
    // the consecutive-last counter is 2 — the final day isn't counted yet.
    await applySnapshotStats(db, { gamePlayerId: gp2!.id, totalValue: 5000, rank: 2, totalPlayers: 2, capturedAt: '2026-05-23T10:00:00.000Z' });
    await applySnapshotStats(db, { gamePlayerId: gp2!.id, totalValue: 5000, rank: 2, totalPlayers: 2, capturedAt: '2026-05-24T10:00:00.000Z' });
    await applySnapshotStats(db, { gamePlayerId: gp2!.id, totalValue: 5000, rank: 2, totalPlayers: 2, capturedAt: '2026-05-25T10:00:00.000Z' });
    // Confirm pre-condition: 2 days counted, 1 still pending the rollover.
    const preStats = await db.select().from(schema.gamePlayerStats).where(eq(schema.gamePlayerStats.gamePlayerId, gp2!.id));
    expect(preStats[0]?.consecutiveDaysInLastPlace).toBe(2);

    // Wire the achievement engine with rock-bottom subscribed.
    const bus = new EventBus();
    const settings = new SystemSettingsService(db);
    const registry = new GameClientRegistry();
    const engine = new AchievementEngine(db, bus, registry, settings, [rockBottom]);
    engine.start();

    // End the game. recomputeGameStatus → recordSnapshot → finalizeSnapshotStats
    // → re-emit snapshot.recorded → engine dispatches rock-bottom which sets
    // progress = consecutiveDaysInLastPlace (now 3 after finalize) → unlock.
    await recomputeGameStatus(db, { id: game!.id, startDate: game!.startDate, endDate: game!.endDate, status: 'active' }, '2026-05-26T00:00:00.000Z', bus);

    // Give the engine handlers a tick to drain.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const [unlock] = await db
      .select()
      .from(schema.achievementProgress)
      .where(
        and(
          eq(schema.achievementProgress.gamePlayerId, gp2!.id),
          eq(schema.achievementProgress.achievementKey, 'rock-bottom'),
        ),
      );
    expect(unlock?.unlockedAt).not.toBeNull();
    engine.stop();

    // gp1 finished first — should NOT have rock-bottom.
    const [gp1Unlock] = await db
      .select()
      .from(schema.achievementProgress)
      .where(
        and(
          eq(schema.achievementProgress.gamePlayerId, gp1!.id),
          eq(schema.achievementProgress.achievementKey, 'rock-bottom'),
        ),
      );
    expect(gp1Unlock?.unlockedAt ?? null).toBeNull();
  });
});
