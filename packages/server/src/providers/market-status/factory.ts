import type { StockProvider } from '../interface.js';
import { env } from '../../env.js';
import { AlpacaMarketStatus } from './alpaca.js';
import { StaticMarketStatus } from './static.js';
import { YahooMarketStatus } from './yahoo.js';
import type { MarketStatusProvider } from './interface.js';

/**
 * Builds the active {@link MarketStatusProvider} based on env.
 * The Yahoo impl reuses the already-built {@link StockProvider} so it rides
 * the existing cache + rate-limit decorators.
 */
export function createMarketStatusProvider(stockProvider: StockProvider): MarketStatusProvider {
  switch (env.MARKET_STATUS_PROVIDER) {
    case 'alpaca':
      return new AlpacaMarketStatus(env.ALPACA_API_KEY);
    case 'yahoo':
      return new YahooMarketStatus(stockProvider);
    case 'static':
    default:
      return new StaticMarketStatus();
  }
}
