import { describe, it, expect } from 'vitest';
import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';
import type { Trade } from '@markettrader/shared';
import { foldTick, toCandles, toVolumeBars, tradesToMarkers } from '@/lib/chart-data';

const candle = (time: number, o: number, h: number, l: number, c: number): CandlestickData => ({
  time: time as UTCTimestamp,
  open: o,
  high: h,
  low: l,
  close: c,
});

function trade(overrides: Partial<Trade>): Trade {
  return {
    id: 't',
    gamePlayerId: 'gp',
    symbol: 'AAPL',
    direction: 'buy',
    quantity: 1,
    price: 100,
    executedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

const iso = (sec: number) => new Date(sec * 1000).toISOString();

describe('toCandles', () => {
  it('falls back to close for a bar without OHLC', () => {
    expect(toCandles([{ time: 10, close: 5 }])).toEqual([candle(10, 5, 5, 5, 5)]);
  });
});

describe('toVolumeBars', () => {
  it('returns nothing when no bar carries volume', () => {
    expect(toVolumeBars([{ time: 1, close: 1 }])).toEqual([]);
  });

  it('tints by bar direction', () => {
    const [up, down] = toVolumeBars([
      { time: 1, open: 1, close: 2, volume: 10 },
      { time: 2, open: 2, close: 1, volume: 20 },
    ]);
    expect(up!.value).toBe(10);
    expect(up!.color).not.toBe(down!.color);
  });
});

describe('foldTick', () => {
  const last = candle(600, 10, 12, 9, 11);

  it('extends the tail candle when the tick lands inside its bucket', () => {
    expect(foldTick(last, { time: 700, price: 13 }, 300)).toEqual(candle(600, 10, 13, 9, 13));
    expect(foldTick(last, { time: 899, price: 8 }, 300)).toEqual(candle(600, 10, 12, 8, 8));
  });

  it('opens a new bucket-aligned candle past the bucket', () => {
    expect(foldTick(last, { time: 1234, price: 14 }, 300)).toEqual(candle(1200, 14, 14, 14, 14));
  });

  it('follows the tail\'s grid when it is not epoch-aligned (hourly bars at :30)', () => {
    const halfPast = candle(1800, 10, 10, 10, 10);
    expect(foldTick(halfPast, { time: 5500, price: 11 }, 3600).time).toBe(5400);
    expect(foldTick(halfPast, { time: 9100, price: 11 }, 3600).time).toBe(9000);
  });

  it('never returns a time earlier than the tail candle', () => {
    const offGrid = candle(1000, 10, 10, 10, 10);
    const next = foldTick(offGrid, { time: 1350, price: 11 }, 300);
    expect(next.time).toBe(1300);
  });

  it('starts a candle when there is no tail', () => {
    expect(foldTick(null, { time: 610, price: 5 }, 300)).toEqual(candle(600, 5, 5, 5, 5));
  });
});

describe('tradesToMarkers', () => {
  const points = [100, 200, 300];

  it('snaps each fill to the last point at or before it', () => {
    const [m] = tradesToMarkers([trade({ executedAt: iso(250) })], 'AAPL', points);
    expect(m!.time).toBe(200);
    expect(m!.shape).toBe('arrowUp');
    expect(m!.position).toBe('belowBar');
  });

  it('snaps a fill newer than the last point onto it', () => {
    const [m] = tradesToMarkers([trade({ executedAt: iso(9_999) })], 'AAPL', points);
    expect(m!.time).toBe(300);
  });

  it('drops fills before the first point and for other symbols', () => {
    const out = tradesToMarkers(
      [trade({ executedAt: iso(50) }), trade({ symbol: 'MSFT', executedAt: iso(200) })],
      'AAPL',
      points,
    );
    expect(out).toEqual([]);
  });

  it('labels sells and sorts by time', () => {
    const out = tradesToMarkers(
      [
        trade({ direction: 'sell', quantity: 5, executedAt: iso(300) }),
        trade({ quantity: 10, executedAt: iso(100) }),
      ],
      'AAPL',
      points,
    );
    expect(out.map((m) => m.time)).toEqual([100, 300]);
    expect(out[1]!.text).toBe('S 5');
    expect(out[1]!.shape).toBe('arrowDown');
    expect(out[0]!.text).toBe('B 10');
  });

  it('returns nothing when no points are plotted', () => {
    expect(tradesToMarkers([trade({})], 'AAPL', [])).toEqual([]);
  });
});
