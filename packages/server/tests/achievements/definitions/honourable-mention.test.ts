import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import honourableMention from '../../../src/achievements/definitions/honourable-mention.js';

describe('achievement: honourable-mention', () => {
  it('unlocks for the top half in a 4-player game (ranks 1-2)', async () => {
    const h = await makeAchievementHarness(honourableMention, { numPlayers: 4 });
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
    expect(await h.isUnlocked(h.players[2]!.gamePlayerId)).toBe(false);
    expect(await h.isUnlocked(h.players[3]!.gamePlayerId)).toBe(false);
  });

  it('does not unlock anyone in a 3-player game (insufficient size)', async () => {
    const h = await makeAchievementHarness(honourableMention, { numPlayers: 3 });
    await h.dispatch({
      type: 'game.ended',
      gameId: h.gameId,
      endedAt: new Date().toISOString(),
      finalRanking: [
        { gamePlayerId: h.players[0]!.gamePlayerId, rank: 1, totalValue: 20000 },
        { gamePlayerId: h.players[1]!.gamePlayerId, rank: 2, totalValue: 15000 },
        { gamePlayerId: h.players[2]!.gamePlayerId, rank: 3, totalValue: 12000 },
      ],
    });
    expect(await h.isUnlocked(h.players[0]!.gamePlayerId)).toBe(false);
    expect(await h.isUnlocked(h.players[1]!.gamePlayerId)).toBe(false);
  });
});
