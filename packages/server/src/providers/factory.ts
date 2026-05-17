import { env } from '../env.js';
import type { StockProvider } from './interface.js';
import { YahooProvider } from './yahoo.js';
import { AlpacaProvider } from './alpaca.js';
import { MockProvider } from './mock.js';

/**
 * Instantiates the correct {@link StockProvider} based on the `STOCK_PROVIDER`
 * environment variable. Wrapped by {@link CachedProvider} in `app.ts`.
 *
 * @throws {Error} if `STOCK_PROVIDER=alpaca` and `ALPACA_API_KEY` is missing.
 */
export function createProvider(): StockProvider {
  switch (env.STOCK_PROVIDER) {
    case 'mock': {
      const overrides = parseMockPrices(process.env.MOCK_PRICES);
      return new MockProvider(overrides);
    }
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

function parseMockPrices(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[k.toUpperCase()] = v;
      }
      return out;
    }
  } catch {
    // Malformed MOCK_PRICES is ignored; built-in map is used.
  }
  return {};
}
