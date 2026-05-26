import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import woodenSpoon from '../../../src/achievements/definitions/wooden-spoon.js';

describe('achievement: wooden-spoon', () => {
  it('unlocks the last-place player in a 3-player game', async () => {
    const h = await makeAchievementHarness(woodenSpoon, { numPlayers: 3 });
    await h.dispatch({
      type: 'game.ended',
      gameId: h.gameId,
      endedAt: new Date().toISOString(),
      finalRanking: [
        { gamePlayerId: h.players[0]!.gamePlayerId, rank: 1, totalValue: 20000 },
        { gamePlayerId: h.players[1]!.gamePlayerId, rank: 2, totalValue: 15000 },
        { gamePlayerId: h.players[2]!.gamePlayerId, rank: 3, totalValue: 10000 },
      ],
    });
    expect(await h.isUnlocked(h.players[2]!.gamePlayerId)).toBe(true);
    expect(await h.isUnlocked(h.players[0]!.gamePlayerId)).toBe(false);
    expect(await h.isUnlocked(h.players[1]!.gamePlayerId)).toBe(false);
  });

  it('does not unlock anyone in a 2-player game', async () => {
    const h = await makeAchievementHarness(woodenSpoon, { numPlayers: 2 });
    await h.dispatch({
      type: 'game.ended',
      gameId: h.gameId,
      endedAt: new Date().toISOString(),
      finalRanking: [
        { gamePlayerId: h.players[0]!.gamePlayerId, rank: 1, totalValue: 20000 },
        { gamePlayerId: h.players[1]!.gamePlayerId, rank: 2, totalValue: 10000 },
      ],
    });
    expect(await h.isUnlocked(h.players[1]!.gamePlayerId)).toBe(false);
  });
});
