import { describe, it, expect } from 'vitest';
import { makeAchievementHarness } from '../../helpers/achievement-harness.js';
import champion from '../../../src/achievements/definitions/champion.js';

describe('achievement: champion', () => {
  it('unlocks for the rank-1 finisher', async () => {
    const h = await makeAchievementHarness(champion, { numPlayers: 3 });
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
    expect(await h.isUnlocked(h.players[0]!.gamePlayerId)).toBe(true);
    expect(await h.isUnlocked(h.players[1]!.gamePlayerId)).toBe(false);
    expect(await h.isUnlocked(h.players[2]!.gamePlayerId)).toBe(false);
  });

  it('does not unlock anyone when no entry is at rank 1', async () => {
    const h = await makeAchievementHarness(champion, { numPlayers: 2 });
    await h.dispatch({
      type: 'game.ended',
      gameId: h.gameId,
      endedAt: new Date().toISOString(),
      finalRanking: [
        { gamePlayerId: h.players[0]!.gamePlayerId, rank: 2, totalValue: 10000 },
        { gamePlayerId: h.players[1]!.gamePlayerId, rank: 3, totalValue: 9000 },
      ],
    });
    expect(await h.isUnlocked(h.players[0]!.gamePlayerId)).toBe(false);
    expect(await h.isUnlocked(h.players[1]!.gamePlayerId)).toBe(false);
  });
});
