import { TradeError } from '../providers/index.js';

/**
 * Charset a stored ticker must match. Same rule the watchlist route applies
 * (`routes/watchlists.ts`), enforced here too because orders persist and are
 * re-quoted by the workers on every tick — a ticker no provider can resolve
 * costs one uncacheable upstream lookup per tick for as long as the row rests.
 */
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.\-]*$/;

/** Longest ticker accepted. Matches the bound the trade route's Zod schema uses. */
const MAX_SYMBOL_LENGTH = 10;

/** Whether `symbol` is well-formed enough to store on a resting order. */
export function isTradableSymbol(symbol: string): boolean {
  return symbol.length > 0 && symbol.length <= MAX_SYMBOL_LENGTH && SYMBOL_PATTERN.test(symbol);
}

/**
 * Throws {@link TradeError} `INVALID_SYMBOL` unless `symbol` is well-formed.
 * Call before persisting any order the workers will re-quote.
 */
export function assertTradableSymbol(symbol: string): void {
  if (!isTradableSymbol(symbol)) {
    throw new TradeError('INVALID_SYMBOL', 'Not a valid ticker symbol');
  }
}
