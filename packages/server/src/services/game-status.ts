import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

type GameStatus = 'pending' | 'active' | 'ended';
type GameRecord = { id: string; startDate: string; endDate: string; status: string };

function computeStatus(game: GameRecord, now: string): GameStatus {
  if (game.status === 'ended') return 'ended';
  if (now >= game.endDate) return 'ended';
  if (now >= game.startDate) return 'active';
  return 'pending';
}

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
