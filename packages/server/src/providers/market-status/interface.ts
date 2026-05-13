import type { MarketStatusResult } from '@markettrader/shared';

/**
 * Reports whether a stock exchange is currently open. Implementations are
 * configured via `MARKET_STATUS_PROVIDER` and parallel the {@link StockProvider}
 * abstraction so the active impl can be swapped at startup.
 *
 * On failure, throw {@link StockProviderError} (reused — same code values).
 */
export interface MarketStatusProvider {
  getStatus(): Promise<MarketStatusResult>;
}
