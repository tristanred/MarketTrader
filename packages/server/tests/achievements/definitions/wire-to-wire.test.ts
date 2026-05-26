import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import wireToWire from '../../../src/achievements/definitions/wire-to-wire.js';
import * as schema from '../../../src/db/schema.sqlite.js';

async function insertSnapshot(
  h: Awaited<ReturnType<typeof makeAchievementHarness>>,
  gamePlayerId: string,
  rank: number,
  capturedAt: string,
  totalValue = 10000,
): Promise<void> {
  await h.db.insert(schema.portfolioSnapshots).values({
    gameId: h.gameId,
    gamePlayerId,
    capturedAt,
    totalValue,
    rank,
  });
}

describe('achievement: wire-to-wire', () => {
  it('unlocks the rank-1 finisher who was rank 1 at the first snapshot', async () => {
    const h = await makeAchievementHarness(wireToWire, { numPlayers: 2 });
    await insertSnapshot(h, h.players[0]!.gamePlayerId, 1, '2024-01-01T00:00:00.000Z');
    await insertSnapshot(h, h.players[0]!.gamePlayerId, 1, '2024-01-02T00:00:00.000Z');
    await h.dispatch({
      type: 'game.ended',
      gameId: h.gameId,
      endedAt: '2024-01-03T00:00:00.000Z',
      finalRanking: [
        { gamePlayerId: h.players[0]!.gamePlayerId, rank: 1, totalValue: 20000 },
        { gamePlayerId: h.players[1]!.gamePlayerId, rank: 2, totalValue: 15000 },
      ],
    });
    expect(await h.isUnlocked(h.players[0]!.gamePlayerId)).toBe(true);
  });

  it('does not unlock when the rank-1 finisher was not rank 1 at the first snapshot', async () => {
    const h = await makeAchievementHarness(wireToWire, { numPlayers: 2 });
    await insertSnapshot(h, h.players[0]!.gamePlayerId, 2, '2024-01-01T00:00:00.000Z');
    await insertSnapshot(h, h.players[0]!.gamePlayerId, 1, '2024-01-02T00:00:00.000Z');
    await h.dispatch({
      type: 'game.ended',
      gameId: h.gameId,
      endedAt: '2024-01-03T00:00:00.000Z',
      finalRanking: [
        { gamePlayerId: h.players[0]!.gamePlayerId, rank: 1, totalValue: 20000 },
        { gamePlayerId: h.players[1]!.gamePlayerId, rank: 2, totalValue: 15000 },
      ],
    });
    expect(await h.isUnlocked(h.players[0]!.gamePlayerId)).toBe(false);
  });
});
