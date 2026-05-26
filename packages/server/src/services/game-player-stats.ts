import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

/** Returns the `YYYY-MM-DD` UTC calendar day for an ISO 8601 timestamp. */
export function utcDayKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/**
 * Upserts a zero-initialised `game_player_stats` row for the given player and
 * returns its current snapshot. Idempotent.
 */
export async function ensureStatsRow(db: Db, gamePlayerId: string) {
  await db
    .insert(schema.gamePlayerStats)
    .values({ gamePlayerId })
    .onConflictDoNothing({ target: schema.gamePlayerStats.gamePlayerId });
  const [row] = await db
    .select()
    .from(schema.gamePlayerStats)
    .where(eq(schema.gamePlayerStats.gamePlayerId, gamePlayerId))
    .limit(1);
  if (!row) throw new Error(`Stats row missing after upsert for ${gamePlayerId}`);
  return row;
}
