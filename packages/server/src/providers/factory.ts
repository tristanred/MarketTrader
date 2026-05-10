import { env } from '../env.js';
import type { StockProvider } from './interface.js';
import { YahooProvider } from './yahoo.js';
import { AlpacaProvider } from './alpaca.js';

/**
 * Instantiates the correct {@link StockProvider} based on the `STOCK_PROVIDER`
 * environment variable. Wrapped by {@link CachedProvider} in `app.ts`.
 *
 * @throws {Error} if `STOCK_PROVIDER=alpaca` and `ALPACA_API_KEY` is missing.
 */
export function createProvider(): StockProvider {
  switch (env.STOCK_PROVIDER) {
    case 'alpaca': {
      if (!env.ALPACA_API_KEY) {
        throw new Error('ALPACA_API_KEY is required when STOCK_PROVIDER=alpaca');
      }
      return new AlpacaProvider(env.ALPACA_API_KEY);
    }
    default:
      return new YahooProvider();
  }
}
