import { eq } from 'drizzle-orm';
import type { GameStatus } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { EventBus } from '../events/bus.js';
import { computeLeaderboard } from './leaderboard.js';

type GameRecord = { id: string; startDate: string; endDate: string; status: string };

/**
 * Derives the correct status for a game based on the current time.
 * Once a game is manually set to `'ended'` it stays ended regardless of dates.
 */
function computeStatus(game: GameRecord, now: string): GameStatus {
  if (game.status === 'ended') return 'ended';
  if (now >= game.endDate) return 'ended';
  if (now >= game.startDate) return 'active';
  return 'pending';
}

/**
 * Computes the current status for a single game and persists it to the database
 * if it has changed (e.g., `pending` → `active` when `startDate` passes).
 *
 * @param now - ISO 8601 timestamp used as "current time"; defaults to `Date.now()`.
 *   Overridable in tests to simulate time progression.
 * @returns The resolved {@link GameStatus}.
 */
export async function recomputeGameStatus(
  db: Db,
  game: GameRecord,
  now = new Date().toISOString(),
  bus?: EventBus,
): Promise<GameStatus> {
  const newStatus = computeStatus(game, now);
  if (newStatus !== game.status) {
    await db.update(schema.games).set({ status: newStatus }).where(eq(schema.games.id, game.id));
    if (bus) {
      if (newStatus === 'active') {
        void bus.emit({ type: 'game.started', gameId: game.id, startedAt: now });
      } else if (newStatus === 'ended') {
        // Final ranking is convenient context for "finish top N" achievements.
        // Best-effort: leaderboard read failures must not roll back the status.
        try {
          const entries = await computeLeaderboard(db, game.id);
          // Map playerId (user id) → gamePlayerId for consumer convenience.
          const gpRows = await db
            .select({ id: schema.gamePlayers.id, userId: schema.gamePlayers.userId })
            .from(schema.gamePlayers)
            .where(eq(schema.gamePlayers.gameId, game.id));
          const gpByUser = new Map(gpRows.map((r) => [r.userId, r.id]));
          const finalRanking = entries
            .map((e) => {
              const gpId = gpByUser.get(e.playerId);
              return gpId ? { gamePlayerId: gpId, rank: e.rank, totalValue: e.totalValue } : null;
            })
            .filter((r): r is NonNullable<typeof r> => r !== null);
          void bus.emit({ type: 'game.ended', gameId: game.id, endedAt: now, finalRanking });
        } catch {
          void bus.emit({ type: 'game.ended', gameId: game.id, endedAt: now, finalRanking: [] });
        }
      }
    }
  }
  return newStatus;
}

/**
 * Batch version of {@link recomputeGameStatus} — runs all games concurrently
 * and returns a map of `gameId → GameStatus`.
 */
export async function recomputeMany(
  db: Db,
  games: GameRecord[],
  now = new Date().toISOString(),
  bus?: EventBus,
): Promise<Map<string, GameStatus>> {
  const result = new Map<string, GameStatus>();
  await Promise.all(
    games.map(async game => {
      const status = await recomputeGameStatus(db, game, now, bus);
      result.set(game.id, status);
    }),
  );
  return result;
}
