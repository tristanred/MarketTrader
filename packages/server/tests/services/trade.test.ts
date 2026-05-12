import { describe, it, expect } from 'vitest';
import {
  validateBuy,
  validateSell,
  computeNewAvgCostBasis,
  computeUnrealizedPnL,
} from '../../src/services/trade.js';
import { TradeError } from '../../src/providers/index.js';

describe('validateBuy', () => {
  it('passes when funds are sufficient', () => {
    expect(() => validateBuy(1000, 50, 5)).not.toThrow();
  });

  it('throws INSUFFICIENT_FUNDS when cost exceeds cash', () => {
    expect(() => validateBuy(100, 50, 5)).toThrowError(TradeError);
    try { validateBuy(100, 50, 5); } catch (e) { expect((e as TradeError).code).toBe('INSUFFICIENT_FUNDS'); }
  });

  it('passes when cost equals cash exactly', () => {
    expect(() => validateBuy(250, 50, 5)).not.toThrow();
  });

  it('throws INVALID_QUANTITY for zero quantity', () => {
    expect(() => validateBuy(1000, 50, 0)).toThrowError(TradeError);
    try { validateBuy(1000, 50, 0); } catch (e) { expect((e as TradeError).code).toBe('INVALID_QUANTITY'); }
  });

  it('throws INVALID_QUANTITY for fractional quantity', () => {
    expect(() => validateBuy(1000, 50, 1.5)).toThrowError(TradeError);
    try { validateBuy(1000, 50, 1.5); } catch (e) { expect((e as TradeError).code).toBe('INVALID_QUANTITY'); }
  });
});

describe('validateSell', () => {
  it('passes when shares are sufficient', () => {
    expect(() => validateSell(10, 5)).not.toThrow();
  });

  it('passes when selling all shares', () => {
    expect(() => validateSell(5, 5)).not.toThrow();
  });

  it('throws INSUFFICIENT_SHARES when selling more than owned', () => {
    expect(() => validateSell(3, 5)).toThrowError(TradeError);
    try { validateSell(3, 5); } catch (e) { expect((e as TradeError).code).toBe('INSUFFICIENT_SHARES'); }
  });

  it('throws INSUFFICIENT_SHARES when no shares owned', () => {
    expect(() => validateSell(0, 1)).toThrowError(TradeError);
  });

  it('throws INVALID_QUANTITY for zero quantity', () => {
    expect(() => validateSell(10, 0)).toThrowError(TradeError);
    try { validateSell(10, 0); } catch (e) { expect((e as TradeError).code).toBe('INVALID_QUANTITY'); }
  });
});

describe('computeNewAvgCostBasis', () => {
  it('returns new price when no existing position', () => {
    expect(computeNewAvgCostBasis(0, 0, 10, 50)).toBe(50);
  });

  it('computes weighted average for adding to position', () => {
    // 10 shares at $50 + 10 shares at $70 = avg $60
    expect(computeNewAvgCostBasis(10, 50, 10, 70)).toBe(60);
  });

  it('weighted average skews toward larger purchase', () => {
    // 5 shares at $100 + 15 shares at $60 = avg $70
    expect(computeNewAvgCostBasis(5, 100, 15, 60)).toBe(70);
  });
});

describe('computeUnrealizedPnL', () => {
  it('returns positive PnL when price is above cost basis', () => {
    expect(computeUnrealizedPnL(10, 50, 70)).toBe(200);
  });

  it('returns negative PnL when price is below cost basis', () => {
    expect(computeUnrealizedPnL(10, 70, 50)).toBe(-200);
  });

  it('returns zero when price equals cost basis', () => {
    expect(computeUnrealizedPnL(10, 50, 50)).toBe(0);
  });
});
