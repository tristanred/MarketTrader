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
 *
 * @throws {Error} if `MARKET_STATUS_PROVIDER=alpaca` and the Alpaca key pair is
 *   missing — fail fast at boot rather than 502 on the first clock request.
 */
export function createMarketStatusProvider(stockProvider: StockProvider): MarketStatusProvider {
  switch (env.MARKET_STATUS_PROVIDER) {
    case 'alpaca':
      if (!env.ALPACA_API_KEY_ID || !env.ALPACA_API_SECRET_KEY) {
        throw new Error(
          'MARKET_STATUS_PROVIDER=alpaca requires both ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY',
        );
      }
      return new AlpacaMarketStatus(env.ALPACA_API_KEY_ID, env.ALPACA_API_SECRET_KEY);
    case 'yahoo':
      return new YahooMarketStatus(stockProvider);
    case 'static':
    default:
      return new StaticMarketStatus();
  }
}
