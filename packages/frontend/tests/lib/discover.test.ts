import { describe, it, expect } from 'vitest';
import type { DiscoverItem, DiscoverList } from '@markettrader/shared';
import { byChangeDesc, formatSessionDate, heatStyle, teaserItems } from '@/lib/discover';

const item = (symbol: string, changePct: number | null = 1): DiscoverItem => ({
  symbol,
  name: `${symbol} Inc.`,
  price: 10,
  changePct,
});

function list(sections: DiscoverList['sections']): DiscoverList {
  return { gameId: 'g', sessionDate: '2026-05-18', generatedAt: '2026-05-18T20:05:00Z', sections };
}

describe('teaserItems', () => {
  it('takes the first pick, the top gainer and the most active stock', () => {
    const rows = teaserItems(
      list([
        { kind: 'picks', items: [item('P1'), item('P2')] },
        { kind: 'gainers', items: [item('G1')] },
        { kind: 'active', items: [item('A1')] },
      ]),
    );
    expect(rows.map((r) => [r.symbol, r.reason])).toEqual([
      ['P1', 'Daily pick'],
      ['G1', 'Top gainer'],
      ['A1', 'Most active'],
    ]);
  });

  it('skips repeats and tops up from the remaining picks when movers are missing', () => {
    const rows = teaserItems(
      list([
        { kind: 'picks', items: [item('P1'), item('P2'), item('P3')] },
        { kind: 'gainers', items: [item('P1')] },
      ]),
    );
    expect(rows.map((r) => r.symbol)).toEqual(['P1', 'P2', 'P3']);
  });
});

describe('heatStyle', () => {
  it('leaves unknown and flat moves untinted', () => {
    expect(heatStyle(null)).toBeUndefined();
    expect(heatStyle(0)).toBeUndefined();
  });

  it('tints gains and losses with their tokens and caps the intensity', () => {
    expect(heatStyle(2.5)?.backgroundColor).toBe(
      'color-mix(in srgb, var(--gain) 12%, var(--panel))',
    );
    expect(heatStyle(-40)?.backgroundColor).toBe(
      'color-mix(in srgb, var(--loss) 20%, var(--panel))',
    );
  });
});

describe('formatSessionDate', () => {
  it('formats the calendar day without shifting it across timezones', () => {
    expect(formatSessionDate('2026-05-18')).toBe('Mon, May 18');
  });
});

describe('byChangeDesc', () => {
  it('sorts biggest gain first and puts unquoted stocks last', () => {
    const sorted = [item('A', -1), item('B', null), item('C', 3)].sort(byChangeDesc);
    expect(sorted.map((i) => i.symbol)).toEqual(['C', 'A', 'B']);
  });
});
