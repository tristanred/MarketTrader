import { describe, it, expect } from 'vitest';
import { MockProvider, MOCK_PRICE_MAP } from '../../src/providers/mock.js';

describe('MockProvider.getQuote', () => {
  it('returns the deterministic price from the built-in map', async () => {
    const p = new MockProvider();
    const q = await p.getQuote('AAPL');
    expect(q.symbol).toBe('AAPL');
    expect(q.price).toBe(MOCK_PRICE_MAP.AAPL);
    expect(typeof q.fetchedAt).toBe('string');
    expect(Number.isNaN(Date.parse(q.fetchedAt))).toBe(false);
  });

  it('returns $100 for unknown symbols', async () => {
    const p = new MockProvider();
    const q = await p.getQuote('ZZZZ');
    expect(q.price).toBe(100);
  });

  it('uppercases the input symbol', async () => {
    const p = new MockProvider();
    const q = await p.getQuote('aapl');
    expect(q.symbol).toBe('AAPL');
    expect(q.price).toBe(MOCK_PRICE_MAP.AAPL);
  });

  it('accepts an override map and prefers it over built-in', async () => {
    const p = new MockProvider({ AAPL: 999 });
    const q = await p.getQuote('AAPL');
    expect(q.price).toBe(999);
  });
});

describe('MockProvider.searchSymbols', () => {
  it('returns matches by case-insensitive prefix', async () => {
    const p = new MockProvider();
    const r = await p.searchSymbols('aa');
    expect(r.map((x: { symbol: string }) => x.symbol)).toContain('AAPL');
  });

  it('returns at most 10 results', async () => {
    const p = new MockProvider();
    const r = await p.searchSymbols('');
    expect(r.length).toBeLessThanOrEqual(10);
  });

  it('returns an empty list for no matches', async () => {
    const p = new MockProvider();
    const r = await p.searchSymbols('ZZZZZZ');
    expect(r).toEqual([]);
  });
});
