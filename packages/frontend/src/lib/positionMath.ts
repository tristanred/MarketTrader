/**
 * Pure derivations for the Trade dialog's "Current → After" preview and
 * the segmented portfolio-allocation bar. All inputs come from
 * {@link PortfolioResponse} + the live or quoted display price.
 */

export interface PositionSnapshot {
  shares: number;
  /** Weighted-average cost basis per share. 0 when shares == 0. */
  avgCost: number;
  /** shares × currentPrice. */
  value: number;
}

/**
 * Compute the post-trade {@link PositionSnapshot}. Avg cost only changes on
 * a buy (weighted-average across the existing position + new fill). A sell
 * keeps the original avg cost — the realized P&L lives in trade history,
 * not the holding.
 *
 * For a buy that completely creates a new position, avgCost = price.
 * For a sell that closes the entire position, shares=0 and avgCost=0.
 */
export function projectPositionAfter(
  current: PositionSnapshot,
  direction: 'buy' | 'sell',
  qty: number,
  price: number,
): PositionSnapshot {
  if (qty <= 0 || price <= 0) {
    return { shares: current.shares, avgCost: current.avgCost, value: current.shares * price };
  }

  if (direction === 'buy') {
    const nextShares = current.shares + qty;
    const nextAvgCost =
      nextShares === 0
        ? 0
        : (current.shares * current.avgCost + qty * price) / nextShares;
    return { shares: nextShares, avgCost: nextAvgCost, value: nextShares * price };
  }

  const nextShares = Math.max(0, current.shares - qty);
  const nextAvgCost = nextShares === 0 ? 0 : current.avgCost;
  return { shares: nextShares, avgCost: nextAvgCost, value: nextShares * price };
}

export interface AllocationSlice {
  /** Held value of this symbol after the trade. */
  positionPct: number;
  /** Remaining cash after the trade. */
  cashPct: number;
  /** Everything else in the portfolio. */
  otherPct: number;
}

/**
 * Segment the portfolio total into three buckets for the allocation bar:
 * (this symbol after the trade) · (cash after the trade) · (other holdings).
 * Percentages sum to 100 when totalAfter > 0; otherwise all three are 0.
 */
export function projectAllocation(args: {
  totalBefore: number;
  cashBefore: number;
  currentPositionValue: number;
  direction: 'buy' | 'sell';
  tradeNotional: number;
  positionValueAfter: number;
}): AllocationSlice {
  const { totalBefore, cashBefore, currentPositionValue, direction, tradeNotional, positionValueAfter } = args;

  // Cash moves opposite to the trade direction. Total portfolio value is
  // unchanged by an instant fill at the same price.
  const cashAfter = direction === 'buy' ? cashBefore - tradeNotional : cashBefore + tradeNotional;
  const totalAfter = totalBefore; // mark-to-market is the same instant price
  if (totalAfter <= 0) return { positionPct: 0, cashPct: 0, otherPct: 0 };

  const otherValue = Math.max(0, totalBefore - cashBefore - currentPositionValue);

  const positionPct = clampPct((positionValueAfter / totalAfter) * 100);
  const cashPct = clampPct((Math.max(0, cashAfter) / totalAfter) * 100);
  const otherPct = clampPct((otherValue / totalAfter) * 100);

  return { positionPct, cashPct, otherPct };
}

function clampPct(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 100) return 100;
  return n;
}
