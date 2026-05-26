import { eq, and, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { EventBus } from '../events/bus.js';
import { computeLeaderboard, type LeaderboardEntry } from './leaderboard.js';

/**
 * Persists one `portfolio_snapshots` row per player for the given game,
 * using the current leaderboard as the source of truth for `totalValue`
 * and `rank`. Caller is responsible for ensuring the game is in a state
 * worth snapshotting (active games — the worker enforces this).
 *
 * Returns the leaderboard entries that were written, so callers that need
 * to broadcast a `leaderboard_history_point` event don't have to recompute.
 */
export async function recordSnapshot(
  db: Db,
  gameId: string,
  bus?: EventBus,
): Promise<LeaderboardEntry[]> {
  const entries = await computeLeaderboard(db, gameId);
  if (entries.length === 0) return [];

  // Translate playerId (user id) → gamePlayerId (the join row id) because
  // `portfolio_snapshots.gamePlayerId` FKs against `game_players.id`. One
  // query covers every player in the game.
  const playerIds = entries.map((e) => e.playerId);
  const gpRows = await db
    .select({ id: schema.gamePlayers.id, userId: schema.gamePlayers.userId })
    .from(schema.gamePlayers)
    .where(
      and(
        eq(schema.gamePlayers.gameId, gameId),
        inArray(schema.gamePlayers.userId, playerIds),
      ),
    );
  const gpByUser = new Map(gpRows.map((r) => [r.userId, r.id]));

  const rows = entries
    .map((e) => {
      const gamePlayerId = gpByUser.get(e.playerId);
      // A player that disappeared between computeLeaderboard and this query
      // (cascading delete in flight) silently drops out. The next tick will
      // produce a consistent set.
      if (!gamePlayerId) return null;
      return {
        gameId,
        gamePlayerId,
        totalValue: e.totalValue,
        rank: e.rank,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return entries;
  await db.insert(schema.portfolioSnapshots).values(rows);

  if (bus) {
    const capturedAt = new Date().toISOString();
    const totalPlayers = rows.length;
    for (const r of rows) {
      void bus.emit({
        type: 'snapshot.recorded',
        gameId,
        gamePlayerId: r.gamePlayerId,
        totalValue: r.totalValue,
        rank: r.rank,
        totalPlayers,
        capturedAt,
      });
    }
  }

  return entries;
}

/**
 * Snapshot every active game in one pass. Used by the periodic worker.
 * Status is read from the stored column rather than recomputed — the
 * pending-orders worker and game-status service already keep that field
 * up to date, and re-running `recomputeMany` here would double the load.
 */
export async function recordSnapshotsForActiveGames(db: Db, bus?: EventBus): Promise<void> {
  const activeGames = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.status, 'active'));

  for (const g of activeGames) {
    try {
      await recordSnapshot(db, g.id, bus);
    } catch {
      // One bad game must not block the rest. The worker logs around this
      // call via its own error handler.
    }
  }
}

/**
 * Bucketise an ISO-8601 timestamp into a day key (`YYYY-MM-DD` in UTC).
 * SQLite stores timestamps as text via `datetime('now')` which is already
 * UTC; PG returns ISO strings in UTC for `mode: 'string'`. Both formats
 * have the date in the first 10 characters.
 */
function dayKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

/**
 * Reduces ended games' snapshot history to one row per player per day,
 * keeping the last row of each UTC day (closest to that day's market
 * close in practice). Idempotent: re-running on an already-compacted
 * game is a no-op because the per-bucket "keep last" step is stable.
 *
 * Sets `games.snapshotsCompactedAt` once finished so subsequent ticks
 * can skip already-processed games via a cheap filter.
 *
 * Active games are untouched — full 5-minute resolution is retained
 * while a game is in progress.
 */
export async function compactEndedGames(db: Db): Promise<{ compactedGameIds: string[] }> {
  const candidates = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(
      and(
        eq(schema.games.status, 'ended'),
        // `isNull` would be cleaner but importing it is unnecessary — SQL
        // `IS NULL` checks both dialects identically and SQLite's drizzle
        // exports `isNull` from drizzle-orm. We use sql template to avoid
        // a tiny extra import here.
        sql`${schema.games.snapshotsCompactedAt} IS NULL`,
      ),
    );

  const compactedGameIds: string[] = [];

  for (const game of candidates) {
    try {
      await compactGame(db, game.id);
      await db
        .update(schema.games)
        .set({ snapshotsCompactedAt: new Date().toISOString() })
        .where(eq(schema.games.id, game.id));
      compactedGameIds.push(game.id);
    } catch {
      // Swallow — a failed compaction leaves snapshotsCompactedAt null
      // so the next tick will retry. The worker logs the error around
      // this call.
    }
  }

  return { compactedGameIds };
}

/**
 * Compacts one game's snapshots in-place. Public for tests; the worker
 * goes through {@link compactEndedGames} which adds the `WHERE` filter
 * and the `snapshotsCompactedAt` write.
 */
export async function compactGame(db: Db, gameId: string): Promise<void> {
  const rows = await db
    .select({
      id: schema.portfolioSnapshots.id,
      gamePlayerId: schema.portfolioSnapshots.gamePlayerId,
      capturedAt: schema.portfolioSnapshots.capturedAt,
    })
    .from(schema.portfolioSnapshots)
    .where(eq(schema.portfolioSnapshots.gameId, gameId));

  if (rows.length === 0) return;

  // Group by (gamePlayerId, day). Within each bucket, keep the row with
  // the latest capturedAt; mark every other id for deletion. Sorting
  // ascending and taking the last element per bucket gives us "last of day".
  rows.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  const lastInBucket = new Map<string, string>(); // bucketKey -> id to keep
  for (const r of rows) {
    const key = `${r.gamePlayerId}|${dayKey(r.capturedAt)}`;
    lastInBucket.set(key, r.id);
  }
  const keepIds = new Set(lastInBucket.values());
  const deleteIds = rows.filter((r) => !keepIds.has(r.id)).map((r) => r.id);

  if (deleteIds.length === 0) return;

  // SQLite has a parameter limit (default 999); batch deletes to stay below it.
  const BATCH = 500;
  for (let i = 0; i < deleteIds.length; i += BATCH) {
    const chunk = deleteIds.slice(i, i + BATCH);
    await db.delete(schema.portfolioSnapshots).where(inArray(schema.portfolioSnapshots.id, chunk));
  }
}
