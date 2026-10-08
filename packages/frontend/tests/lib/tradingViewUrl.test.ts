import { describe, it, expect } from 'vitest';
import { tradingViewUrl } from '@/lib/utils';

describe('tradingViewUrl', () => {
  it('links a plain ticker to its TradingView symbol page', () => {
    expect(tradingViewUrl('AAPL')).toBe('https://www.tradingview.com/symbols/AAPL/');
  });

  it('converts Yahoo share-class dashes to the dot TradingView uses', () => {
    expect(tradingViewUrl('BRK-B')).toBe('https://www.tradingview.com/symbols/BRK.B/');
  });

  it('uppercases and encodes defensively', () => {
    expect(tradingViewUrl('msft')).toBe('https://www.tradingview.com/symbols/MSFT/');
    expect(tradingViewUrl('A/B')).toBe('https://www.tradingview.com/symbols/A%2FB/');
  });
});
