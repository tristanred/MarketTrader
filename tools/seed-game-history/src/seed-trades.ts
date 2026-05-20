import { db } from '../../../packages/server/src/db/index.js';
import { executeTrade } from '../../../packages/server/src/services/trade.js';
import { TradeError } from '../../../packages/server/src/providers/index.js';
import { coinFlip, pick, randInt, randomTimestampsBetween } from './rng.js';
import type { SeededPlayer } from './seed-players.js';

export interface SeedTradesOptions {
  symbols: readonly string[];
  /** Latest bar timestamp (ms) below which trades will be skipped. */
  earliestBarMs: number;
  priceAt: (symbol: string, timestampISO: string) => number | null;
}

export interface SeedTradesResult {
  inserted: number;
  skipped: number;
}

/**
 * Walks a sorted list of synthetic trade timestamps for one player and calls
 * `executeTrade` per step. Maintains an in-memory mirror of the player's cash
 * and holdings to drive constrained-random direction/symbol/quantity choices:
 *
 * - `sell` is only chosen when the player holds at least one symbol; `buy`
 *   otherwise. When both are possible, `buy` is favored ~60% of the time.
 * - Buy quantity is capped at min(50, floor(cash / price)).
 * - Sell quantity is in `[1, currentHolding]`.
 *
 * Skips a trade (and counts it) when:
 * - the random timestamp falls before any historical bar (`priceAt` returns null);
 * - the player has no cash for a buy or no shares for a sell;
 * - `executeTrade` raises {@link TradeError} (rare cash-drift edge case).
 */
export async function seedTradesForPlayer(
  player: SeededPlayer,
  startingBalance: number,
  gameStartISO: string,
  nowISO: string,
  tradeCount: number,
  opts: SeedTradesOptions,
): Promise<SeedTradesResult> {
  const timestamps = randomTimestampsBetween(gameStartISO, nowISO, tradeCount);
  let cash = startingBalance;
  const holdings = new Map<string, number>();
  let inserted = 0;
  let skipped = 0;

  for (const tsISO of timestamps) {
    const tsMs = new Date(tsISO).getTime();
    if (tsMs < opts.earliestBarMs) {
      skipped++;
      continue;
    }

    const heldSymbols = [...holdings.entries()].filter(([, qty]) => qty > 0);
    const canSell = heldSymbols.length > 0;
    const direction: 'buy' | 'sell' = !canSell ? 'buy' : coinFlip(0.6) ? 'buy' : 'sell';

    let symbol: string;
    let quantity: number;

    if (direction === 'buy') {
      symbol = pick(opts.symbols);
      const price = opts.priceAt(symbol, tsISO);
      if (price == null || price <= 0) {
        skipped++;
        continue;
      }
      const maxAffordable = Math.floor(cash / price);
      if (maxAffordable < 1) {
        skipped++;
        continue;
      }
      quantity = randInt(1, Math.min(50, maxAffordable));

      try {
        await executeTrade(db, {
          gamePlayerId: player.gamePlayerId,
          symbol,
          direction: 'buy',
          quantity,
          price,
          executedAt: tsISO,
        });
        cash -= quantity * price;
        holdings.set(symbol, (holdings.get(symbol) ?? 0) + quantity);
        inserted++;
      } catch (err) {
        if (err instanceof TradeError) {
          skipped++;
        } else {
          throw err;
        }
      }
    } else {
      const [pickedSymbol, qtyHeld] = pick(heldSymbols);
      symbol = pickedSymbol;
      const price = opts.priceAt(symbol, tsISO);
      if (price == null || price <= 0) {
        skipped++;
        continue;
      }
      quantity = randInt(1, qtyHeld);

      try {
        await executeTrade(db, {
          gamePlayerId: player.gamePlayerId,
          symbol,
          direction: 'sell',
          quantity,
          price,
          executedAt: tsISO,
        });
        cash += quantity * price;
        const newQty = qtyHeld - quantity;
        if (newQty === 0) holdings.delete(symbol);
        else holdings.set(symbol, newQty);
        inserted++;
      } catch (err) {
        if (err instanceof TradeError) {
          skipped++;
        } else {
          throw err;
        }
      }
    }
  }

  return { inserted, skipped };
}
