import { describe, it, expect } from 'vitest';
import { analyseHistory } from '@/components/leaderboard/analyse-history';
import type { LeaderboardHistoryResponse } from '@markettrader/shared';

function makeHistory(
  series: Array<{
    playerId: string;
    username: string;
    points: Array<[t: string, v: number, r: number]>;
  }>,
  endedAt = '2026-05-20T12:00:00.000Z',
): LeaderboardHistoryResponse {
  return {
    range: 'all',
    startedAt: '2026-05-01T00:00:00.000Z',
    endedAt,
    series: series.map((s) => ({
      playerId: s.playerId,
      username: s.username,
      points: s.points.map(([t, v, r]) => ({ t, v, r })),
    })),
  };
}

describe('analyseHistory', () => {
  it('emits a "took #1" event when the leader changes', () => {
    const h = makeHistory([
      {
        playerId: 'a',
        username: 'alice',
        points: [
          ['2026-05-18T10:00:00.000Z', 105000, 1],
          ['2026-05-19T10:00:00.000Z', 104000, 2],
        ],
      },
      {
        playerId: 'b',
        username: 'bob',
        points: [
          ['2026-05-18T10:00:00.000Z', 103000, 2],
          ['2026-05-19T10:00:00.000Z', 106000, 1],
        ],
      },
    ]);
    const events = analyseHistory(h);
    const lead = events.find((e) => /bob took #1 from alice/.test(e.text));
    expect(lead).toBeDefined();
  });

  it('emits a rank-drop event when a player falls 5+ ranks within 48h', () => {
    const h = makeHistory([
      {
        playerId: 'a',
        username: 'alice',
        points: [
          ['2026-05-18T10:00:00.000Z', 110000, 3],
          ['2026-05-19T10:00:00.000Z', 95000, 12],
        ],
      },
    ]);
    const events = analyseHistory(h);
    const drop = events.find((e) => /alice dropped/.test(e.text));
    expect(drop).toBeDefined();
    expect(drop?.text).toContain('from #3 to #12');
  });

  it('emits peak-value events for the highest-valued players', () => {
    const h = makeHistory([
      {
        playerId: 'a',
        username: 'alice',
        points: [
          ['2026-05-18T10:00:00.000Z', 110000, 1],
          ['2026-05-19T10:00:00.000Z', 105000, 2],
        ],
      },
    ]);
    const events = analyseHistory(h);
    expect(events.some((e) => /alice peaked at \$110,000/.test(e.text))).toBe(true);
  });

  it('caps the total event list at maxEvents and orders by recency', () => {
    const points: Array<[string, number, number]> = Array.from({ length: 20 }, (_, i) => [
      new Date(2026, 4, i + 1, 10).toISOString(),
      100000 + i * 100,
      1,
    ]);
    const h = makeHistory([{ playerId: 'a', username: 'alice', points }]);
    const events = analyseHistory(h, 3);
    expect(events.length).toBeLessThanOrEqual(3);
    // Most recent first.
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1]!.at >= events[i]!.at).toBe(true);
    }
  });
});
