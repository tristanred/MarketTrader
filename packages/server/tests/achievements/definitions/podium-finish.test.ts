import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import podiumFinish from '../../../src/achievements/definitions/podium-finish.js';

describe('achievement: podium-finish', () => {
  it('unlocks for ranks 1, 2, and 3', async () => {
    const h = await makeAchievementHarness(podiumFinish, { numPlayers: 4 });
    await h.dispatch({
      type: 'game.ended',
      gameId: h.gameId,
      endedAt: new Date().toISOString(),
      finalRanking: [
        { gamePlayerId: h.players[0]!.gamePlayerId, rank: 1, totalValue: 20000 },
        { gamePlayerId: h.players[1]!.gamePlayerId, rank: 2, totalValue: 15000 },
        { gamePlayerId: h.players[2]!.gamePlayerId, rank: 3, totalValue: 12000 },
        { gamePlayerId: h.players[3]!.gamePlayerId, rank: 4, totalValue: 10000 },
      ],
    });
    expect(await h.isUnlocked(h.players[0]!.gamePlayerId)).toBe(true);
    expect(await h.isUnlocked(h.players[1]!.gamePlayerId)).toBe(true);
    expect(await h.isUnlocked(h.players[2]!.gamePlayerId)).toBe(true);
    expect(await h.isUnlocked(h.players[3]!.gamePlayerId)).toBe(false);
  });
});
