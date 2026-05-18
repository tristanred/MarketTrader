// Re-export the deterministic price map from the server's MockProvider so e2e
// assertions can reference the same source of truth. The e2e directory is
// excluded from the frontend tsconfig, so this cross-package import is
// resolved by Playwright's TS loader at runtime — there is no compile-time
// dependency that would break the frontend build.
import { MOCK_PRICE_MAP } from '../../../server/src/providers/mock.js';

export { MOCK_PRICE_MAP };

/**
 * Returns the deterministic mock price for a symbol, defaulting to $100 for
 * unknown tickers (matching the MockProvider's fallback behaviour).
 */
export function priceOf(symbol: string): number {
  return MOCK_PRICE_MAP[symbol.toUpperCase()] ?? 100;
}
