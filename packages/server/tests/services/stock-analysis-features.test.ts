import { describe, it, expect } from 'vitest';
import { computeFeatures, rsi } from '../../src/services/stock-analysis/features.js';
import { dailySeries } from '../helpers/bars.js';

describe('computeFeatures', () => {
  it('is undefined for too short a series', () => {
    expect(computeFeatures(dailySeries([1, 2, 3]))).toBeUndefined();
    expect(computeFeatures([])).toBeUndefined();
  });

  it('computes returns, averages, and range on a steady uptrend', () => {
    const closes = Array.from({ length: 252 }, (_, i) => 100 + i);
    const f = computeFeatures(dailySeries(closes))!;
    expect(f.bars).toBe(252);
    expect(f.lastClose).toBe(351);
    // 21 bars back from 351 is 330.
    expect(f.returnsPct.m1).toBeCloseTo(((351 - 330) / 330) * 100, 2);
    expect(f.returnsPct.y1).toBeCloseTo(((351 - 100) / 100) * 100, 2);
    expect(f.sma.d20).toBeCloseTo(341.5, 2);
    expect(f.sma.d200).toBeCloseTo(251.5, 2);
    expect(f.priceVsSmaPct.d50).toBeGreaterThan(0);
    expect(f.rangeHigh).toBe(351);
    expect(f.rangeLow).toBe(100);
    expect(f.pctBelowRangeHigh).toBe(0);
    expect(f.rsi14).toBe(100);
    expect(f.recentCloses).toHaveLength(20);
    expect(f.recentCloses.at(-1)).toBe(351);
  });

  it('omits what a short series cannot support', () => {
    const f = computeFeatures(dailySeries(Array.from({ length: 30 }, (_, i) => 50 + (i % 3))))!;
    expect(f.returnsPct.m1).toBeDefined();
    expect(f.returnsPct.m3).toBeUndefined();
    expect(f.returnsPct.y1).toBeUndefined();
    expect(f.sma.d50).toBeUndefined();
    expect(f.volumeRatio20to90).toBeUndefined();
  });

  it('sorts unsorted bars and drops non-positive closes', () => {
    const bars = dailySeries(Array.from({ length: 25 }, (_, i) => 10 + i)).reverse();
    bars.push({ time: 0, close: 0 });
    const f = computeFeatures(bars)!;
    expect(f.bars).toBe(25);
    expect(f.lastClose).toBe(34);
  });
});

describe('rsi', () => {
  it('is 0 on a steady downtrend and near 50 on alternation', () => {
    expect(rsi(Array.from({ length: 30 }, (_, i) => 100 - i), 14)).toBe(0);
    const alt = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 100 : 101));
    expect(rsi(alt, 14)).toBeGreaterThan(40);
    expect(rsi(alt, 14)).toBeLessThan(60);
  });
});
