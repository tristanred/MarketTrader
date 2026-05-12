import { eq } from 'drizzle-orm';
import type { GameStatus } from '@markettrader/shared';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
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
): Promise<GameStatus> {
  const newStatus = computeStatus(game, now);
  if (newStatus !== game.status) {
    await db.update(schema.games).set({ status: newStatus }).where(eq(schema.games.id, game.id));
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
): Promise<Map<string, GameStatus>> {
  const result = new Map<string, GameStatus>();
  await Promise.all(
    games.map(async game => {
      const status = await recomputeGameStatus(db, game, now);
      result.set(game.id, status);
    }),
  );
  return result;
}
