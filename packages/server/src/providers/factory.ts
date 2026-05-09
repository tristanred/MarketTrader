import { env } from '../env.js';
import type { StockProvider } from './interface.js';
import { YahooProvider } from './yahoo.js';
import { AlpacaProvider } from './alpaca.js';

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
