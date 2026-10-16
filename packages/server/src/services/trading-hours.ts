import type { MarketState } from '@markettrader/shared';

/**
 * Whether the market-hours policy treats `state` as open for trading. Regular
 * hours always count; PRE and POST count only when `includeExtended` is set
 * (the live `MARKET_HOURS_INCLUDE_EXTENDED` option).
 */
export function isTradingOpen(state: MarketState, includeExtended: boolean): boolean {
  if (state === 'REGULAR') return true;
  if (!includeExtended) return false;
  return state === 'PRE' || state === 'POST';
}
