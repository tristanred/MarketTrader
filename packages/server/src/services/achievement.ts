import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type {
  AchievementDefinitionDTO,
  AchievementProgressDTO,
} from '@markettrader/shared';
import type { AchievementEngine } from '../achievements/engine.js';

/**
 * Shape returned by {@link getAchievementsForGame}. `definitions` is filtered
 * to only enabled definitions that at least one player has unlocked, so
 * locked-achievement metadata never leaves the server. `progress` carries
 * the matching unlock rows for every player. `totalEnabledCount` is the
 * count of enabled definitions in the game (the denominator for the
 * `X / Y unlocked` summary on the FE).
 */
export interface GameAchievementsView {
  definitions: AchievementDefinitionDTO[];
  progress: Record<string, AchievementProgressDTO[]>;
  totalEnabledCount: number;
}

/**
 * Returns the achievement definitions and progress rows that the player UI
 * is allowed to see. Locked-but-in-progress rows are dropped so the wire
 * payload cannot leak a definition's existence; the matching definition is
 * only included once at least one player has unlocked it. Disabled
 * definitions are excluded unconditionally. The admin view in
 * {@link getAdminAchievementsForGame} is unaffected and still returns
 * the full registry.
 */
export async function getAchievementsForGame(
  db: Db,
  engine: AchievementEngine,
  gameId: string,
): Promise<GameAchievementsView> {
  const allDefs = await buildDefinitionDTOs(engine, gameId);
  const totalEnabledCount = allDefs.filter((d) => d.enabled).length;

  const rows = await db
    .select({
      gamePlayerId: schema.achievementProgress.gamePlayerId,
      achievementKey: schema.achievementProgress.achievementKey,
      progress: schema.achievementProgress.progress,
      target: schema.achievementProgress.target,
      unlockedAt: schema.achievementProgress.unlockedAt,
    })
    .from(schema.achievementProgress)
    .where(eq(schema.achievementProgress.gameId, gameId));

  const unlockedKeys = new Set<string>();
  for (const row of rows) {
    if (row.unlockedAt !== null) unlockedKeys.add(row.achievementKey);
  }

  const definitions = allDefs.filter(
    (d) => d.enabled && unlockedKeys.has(d.key),
  );
  const visibleKeys = new Set(definitions.map((d) => d.key));

  const progress: Record<string, AchievementProgressDTO[]> = {};
  for (const row of rows) {
    if (!visibleKeys.has(row.achievementKey)) continue;
    if (row.unlockedAt === null) continue;
    const list = progress[row.gamePlayerId] ?? [];
    list.push({
      gamePlayerId: row.gamePlayerId,
      achievementKey: row.achievementKey,
      progress: row.progress,
      target: row.target,
      unlockedAt: row.unlockedAt,
    });
    progress[row.gamePlayerId] = list;
  }

  return { definitions, progress, totalEnabledCount };
}

/**
 * Returns the achievement definitions and unlock rows for a single player.
 * `definitions` is scoped to enabled definitions unlocked by *that* player;
 * locked-but-in-progress rows are dropped. `totalEnabledCount` is the game's
 * full enabled count so the FE can show `X / Y unlocked`.
 */
export async function getProgressForPlayer(
  db: Db,
  engine: AchievementEngine,
  gameId: string,
  gamePlayerId: string,
): Promise<GameAchievementsView> {
  const allDefs = await buildDefinitionDTOs(engine, gameId);
  const totalEnabledCount = allDefs.filter((d) => d.enabled).length;

  const rows = await db
    .select({
      gamePlayerId: schema.achievementProgress.gamePlayerId,
      achievementKey: schema.achievementProgress.achievementKey,
      progress: schema.achievementProgress.progress,
      target: schema.achievementProgress.target,
      unlockedAt: schema.achievementProgress.unlockedAt,
    })
    .from(schema.achievementProgress)
    .where(
      and(
        eq(schema.achievementProgress.gameId, gameId),
        eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
      ),
    );

  const unlockedKeys = new Set<string>();
  for (const row of rows) {
    if (row.unlockedAt !== null) unlockedKeys.add(row.achievementKey);
  }

  const definitions = allDefs.filter(
    (d) => d.enabled && unlockedKeys.has(d.key),
  );
  const visibleKeys = new Set(definitions.map((d) => d.key));

  const list: AchievementProgressDTO[] = [];
  for (const row of rows) {
    if (!visibleKeys.has(row.achievementKey)) continue;
    if (row.unlockedAt === null) continue;
    list.push({
      gamePlayerId: row.gamePlayerId,
      achievementKey: row.achievementKey,
      progress: row.progress,
      target: row.target,
      unlockedAt: row.unlockedAt,
    });
  }

  return {
    definitions,
    progress: { [gamePlayerId]: list },
    totalEnabledCount,
  };
}

/**
 * Admin view: everything {@link getAchievementsForGame} returns plus rows
 * whose key is no longer in the registry, so an operator can spot and
 * clean them up.
 */
export async function getAdminAchievementsForGame(
  db: Db,
  engine: AchievementEngine,
  gameId: string,
): Promise<{
  definitions: AchievementDefinitionDTO[];
  rows: Array<AchievementProgressDTO & { orphaned: boolean }>;
}> {
  const definitions = await buildDefinitionDTOs(engine, gameId);
  const knownKeys = new Set(definitions.map((d) => d.key));

  const rows = await db
    .select({
      gamePlayerId: schema.achievementProgress.gamePlayerId,
      achievementKey: schema.achievementProgress.achievementKey,
      progress: schema.achievementProgress.progress,
      target: schema.achievementProgress.target,
      unlockedAt: schema.achievementProgress.unlockedAt,
    })
    .from(schema.achievementProgress)
    .where(eq(schema.achievementProgress.gameId, gameId));

  return {
    definitions,
    rows: rows.map((r) => ({
      gamePlayerId: r.gamePlayerId,
      achievementKey: r.achievementKey,
      progress: r.progress,
      target: r.target,
      unlockedAt: r.unlockedAt,
      orphaned: !knownKeys.has(r.achievementKey),
    })),
  };
}

async function buildDefinitionDTOs(
  engine: AchievementEngine,
  gameId: string,
): Promise<AchievementDefinitionDTO[]> {
  const defs = engine.listDefinitions();
  return Promise.all(
    defs.map(async (d) => ({
      key: d.key,
      name: d.name,
      description: d.description,
      ...(d.category !== undefined && { category: d.category }),
      rarity: d.rarity,
      icon: d.icon,
      target: d.target,
      enabled: await engine.isEnabled(gameId, d.key),
    })),
  );
}
