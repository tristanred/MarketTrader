import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type {
  AchievementDefinitionDTO,
  AchievementProgressDTO,
} from '@markettrader/shared';
import type { AchievementEngine } from '../achievements/engine.js';

/**
 * Shape returned by {@link getAchievementsForGame}. `definitions` is the
 * full registry (with per-game effective enabled state); `progress` is
 * keyed by `gamePlayerId` so the FE can render per-player progress bars.
 */
export interface GameAchievementsView {
  definitions: AchievementDefinitionDTO[];
  progress: Record<string, AchievementProgressDTO[]>;
}

/**
 * Returns every code-defined achievement (with per-game enabled state) plus
 * the progress rows for every player in the game. Orphaned rows whose key
 * is no longer in the registry are filtered out — the admin view returns
 * them raw if needed for cleanup.
 */
export async function getAchievementsForGame(
  db: Db,
  engine: AchievementEngine,
  gameId: string,
): Promise<GameAchievementsView> {
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

  const progress: Record<string, AchievementProgressDTO[]> = {};
  for (const row of rows) {
    if (!knownKeys.has(row.achievementKey)) continue;
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

  return { definitions, progress };
}

/**
 * Returns the progress rows for a single (game, gamePlayer) pair plus the
 * effective definition list for the game. Mirrors the shape of
 * {@link getAchievementsForGame} with a single-entry `progress` map.
 */
export async function getProgressForPlayer(
  db: Db,
  engine: AchievementEngine,
  gameId: string,
  gamePlayerId: string,
): Promise<GameAchievementsView> {
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
    .where(
      and(
        eq(schema.achievementProgress.gameId, gameId),
        eq(schema.achievementProgress.gamePlayerId, gamePlayerId),
      ),
    );

  const list: AchievementProgressDTO[] = [];
  for (const row of rows) {
    if (!knownKeys.has(row.achievementKey)) continue;
    list.push({
      gamePlayerId: row.gamePlayerId,
      achievementKey: row.achievementKey,
      progress: row.progress,
      target: row.target,
      unlockedAt: row.unlockedAt,
    });
  }

  return { definitions, progress: { [gamePlayerId]: list } };
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
