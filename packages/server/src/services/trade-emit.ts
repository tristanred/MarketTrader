import type { Db } from '../db/index.js';
import type { EventBus } from '../events/bus.js';
import type { StockProvider } from '../providers/index.js';
import type { ExecuteTradeResult } from './trade.js';
import { loadPlayerPortfolio } from './portfolio.js';

/** Inputs needed to emit the follow-on domain events after a committed trade. */
export interface EmitTradeEventsParams {
  bus: EventBus;
  db: Db;
  provider: StockProvider;
  gameId: string;
  gamePlayerId: string;
  /** Cash balance AFTER the trade (read from gamePlayers post-tx). */
  cashAfter: number;
  symbol: string;
  direction: 'buy' | 'sell';
  quantity: number;
  /**
   * Full trade result from {@link executeTrade}. Pass a synthesized object with
   * zeroed P&L / hold-duration for paths that don't go through `executeTrade`
   * (pending-trade settle); set `isResting` on the call site so we know to
   * suppress `position.closed`.
   */
  result: ExecuteTradeResult;
  executedAt: string;
  /**
   * When true, the sell came from a resting/pending order whose cost basis
   * was lost at placement. `position.closed` is suppressed because realized
   * P&L and hold duration cannot be computed — emitting zeros would unlock
   * duration-based achievements (e.g. paper-hands) on every fill. See
   * `docs/design.md` → "Known gap: resting-sell realized P&L".
   */
  isResting?: boolean;
}

/**
 * Emits `holdings.changed` (always) and `position.closed` (non-resting sells
 * only) after a trade commit. Holdings metrics (`topConcentrationRatio`,
 * `cashRatio`) are derived from {@link loadPlayerPortfolio}, which falls back
 * to cost basis on quote-fetch failure — so emits cannot block on a flaky
 * price provider.
 *
 * Existing `trade.executed` emits at the call site are unchanged — this helper
 * only handles the two new events introduced by the additional-achievements
 * work. Wrap with `void` + `.catch` at the call site to keep emits off the
 * critical path.
 */
export async function emitTradeEvents(p: EmitTradeEventsParams): Promise<void> {
  let topConcentrationRatio = 0;
  let cashRatio = 1;
  if (p.result.distinctSymbols > 0) {
    const portfolio = await loadPlayerPortfolio(p.db, p.provider, p.gamePlayerId, p.cashAfter);
    if (portfolio.totalValue > 0) {
      const topSymbolValue = portfolio.holdings.reduce(
        (max, h) => (h.marketValue > max ? h.marketValue : max),
        0,
      );
      topConcentrationRatio = topSymbolValue / portfolio.totalValue;
      cashRatio = p.cashAfter / portfolio.totalValue;
    }
  }
  void p.bus.emit({
    type: 'holdings.changed',
    gameId: p.gameId,
    gamePlayerId: p.gamePlayerId,
    distinctSymbols: p.result.distinctSymbols,
    topConcentrationRatio,
    cashRatio,
    changedAt: p.executedAt,
  });
  if (p.direction === 'sell' && !p.isResting) {
    void p.bus.emit({
      type: 'position.closed',
      gameId: p.gameId,
      gamePlayerId: p.gamePlayerId,
      symbol: p.symbol,
      quantity: p.quantity,
      realizedPnl: p.result.realizedPnl,
      realizedPnlPct: p.result.realizedPnlPct,
      holdDurationMs: p.result.holdDurationMs,
      fullyClosed: p.result.fullyClosed,
      closedAt: p.executedAt,
    });
  }
}
