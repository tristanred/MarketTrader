import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { StockProvider } from '../providers/index.js';
import { computeUnrealizedPnL } from './trade.js';

/** One holding enriched with the latest quote and unrealized P&L. */
export interface EnrichedHolding {
  symbol: string;
  quantity: number;
  avgCostBasis: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
}

/** Full portfolio view for one game-player: cash + holdings + total. */
export interface PlayerPortfolio {
  cashBalance: number;
  holdings: EnrichedHolding[];
  /** Cash + held positions + value of any pending-trade reservations. */
  totalValue: number;
  /**
   * Value tied up in pending orders: reservedCash for pending buys, plus
   * (quantity × current price) for pending sells. Already included in {@link totalValue}.
   */
  reservedValue: number;
}

/**
 * Builds the enriched portfolio view for a single game-player. Fetches live
 * quotes for every held symbol and every pending-sell reservation; falls back
 * to cost basis / reservedPrice when a quote fetch fails.
 *
 * Caller is responsible for fetching the game-player row first (membership /
 * permission checks vary by endpoint).
 */
export async function loadPlayerPortfolio(
  db: Db,
  provider: StockProvider,
  gamePlayerId: string,
  cashBalance: number,
): Promise<PlayerPortfolio> {
  const { portfolios, trades } = schema;

  const holdings = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.gamePlayerId, gamePlayerId));

  const enrichedHoldings = await Promise.all(
    holdings.map(async (h) => {
      let currentPrice = Number(h.avgCostBasis);
      try {
        const quote = await provider.getQuote(h.symbol);
        currentPrice = quote.price;
      } catch {
        // Fall back to cost basis if quote fetch fails
      }
      const avgCostBasis = Number(h.avgCostBasis);
      const marketValue = h.quantity * currentPrice;
      const unrealizedPnL = computeUnrealizedPnL(h.quantity, avgCostBasis, currentPrice);
      const unrealizedPnLPercent =
        avgCostBasis !== 0 ? ((currentPrice - avgCostBasis) / avgCostBasis) * 100 : 0;
      return {
        symbol: h.symbol,
        quantity: h.quantity,
        avgCostBasis,
        currentPrice,
        marketValue,
        unrealizedPnL,
        unrealizedPnLPercent,
      };
    }),
  );

  const reservations = await db
    .select()
    .from(trades)
    .where(
      and(
        eq(trades.gamePlayerId, gamePlayerId),
        inArray(trades.status, ['pending', 'working']),
      ),
    );

  let reservedValue = 0;
  for (const p of reservations) {
    if (p.direction === 'buy') {
      reservedValue += Number(p.reservedCash ?? 0);
    } else {
      let price = Number(p.reservedPrice ?? 0);
      try {
        const q = await provider.getQuote(p.symbol);
        price = q.price;
      } catch {
        // Fall back to reservedPrice if quote fetch fails
      }
      reservedValue += p.quantity * price;
    }
  }

  const totalValue =
    cashBalance +
    enrichedHoldings.reduce((sum, h) => sum + h.marketValue, 0) +
    reservedValue;

  return { cashBalance, holdings: enrichedHoldings, totalValue, reservedValue };
}
