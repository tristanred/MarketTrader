import { describe, it, expect } from 'vitest';
import { DAILY_PICKS_COUNT, sampleDailyPicks } from '../../src/services/discover/picks.js';
import { SP500 } from '../../src/services/discover/sp500.js';

describe('sampleDailyPicks', () => {
  it('is deterministic for the same game and session date', () => {
    const a = sampleDailyPicks('game-1', '2026-05-18');
    const b = sampleDailyPicks('game-1', '2026-05-18');
    expect(a.map((p) => p.symbol)).toEqual(b.map((p) => p.symbol));
  });

  it(`returns exactly ${DAILY_PICKS_COUNT} distinct symbols`, () => {
    const picks = sampleDailyPicks('game-1', '2026-05-18');
    expect(picks).toHaveLength(DAILY_PICKS_COUNT);
    expect(new Set(picks.map((p) => p.symbol)).size).toBe(DAILY_PICKS_COUNT);
  });

  it('differs across games on the same day and across days for the same game', () => {
    const base = sampleDailyPicks('game-1', '2026-05-18').map((p) => p.symbol);
    const otherGame = sampleDailyPicks('game-2', '2026-05-18').map((p) => p.symbol);
    const otherDay = sampleDailyPicks('game-1', '2026-05-19').map((p) => p.symbol);
    expect(otherGame).not.toEqual(base);
    expect(otherDay).not.toEqual(base);
  });

  it('draws only from the S&P 500 universe', () => {
    const universe = new Set(SP500.map((e) => e.symbol));
    for (let d = 1; d <= 28; d += 1) {
      const date = `2026-02-${String(d).padStart(2, '0')}`;
      for (const p of sampleDailyPicks('game-x', date)) expect(universe.has(p.symbol)).toBe(true);
    }
  });

  it('spreads picks across the universe rather than clustering at the front', () => {
    const counts = new Map<string, number>();
    for (let g = 0; g < 200; g += 1) {
      for (const p of sampleDailyPicks(`g${g}`, '2026-05-18')) {
        counts.set(p.symbol, (counts.get(p.symbol) ?? 0) + 1);
      }
    }
    // 4000 draws over ~503 symbols: a fair sampler touches nearly all of them.
    expect(counts.size).toBeGreaterThan(SP500.length * 0.9);
  });
});
