import { memo, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStockSearch, useStockDetails, useStockQuote } from '@/api/stocks';
import { usePlaceTrade, usePortfolio } from '@/api/trades';
import { useLiveStore } from '@/stores/liveStore';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import { cn, formatUSD, SYMBOL_RE } from '@/lib/utils';
import { projectAllocation, projectPositionAfter, type PositionSnapshot } from '@/lib/positionMath';
import type { OrderType, PlaceTradeRequest, TradeDirection } from '@markettrader/shared';

type Term = 'DAY' | 'GTC';
type PriceType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT' | 'BRACKET';
type DirectionTab = 'buy' | 'sell-short' | 'sell' | 'buy-to-cover';

const PRICE_TYPE_TO_ORDER_TYPE: Record<PriceType, OrderType> = {
  MARKET: 'market',
  LIMIT: 'limit',
  STOP: 'stop',
  STOP_LIMIT: 'stop_limit',
  BRACKET: 'bracket',
};

interface TradeOrderDialogProps {
  open: boolean;
  initialSymbol: string | null;
  /** Direction the dialog opens on. Defaults to 'buy'. */
  initialDirection?: TradeDirection;
  gameId: string;
  /** When false, SELL SHORT and BUY TO COVER tabs are hidden entirely. */
  allowShortSelling: boolean;
  /** Per-game gate. When false, LIMIT and STOP_LIMIT options are hidden. */
  allowLimitOrders: boolean;
  /** Per-game gate. When false, STOP and STOP_LIMIT options are hidden. */
  allowStopOrders: boolean;
  /** Per-game gate. When false, BRACKET is hidden. */
  allowBracketOrders: boolean;
  /** Per-game gate. When false, the GTC option is hidden (and the Term row may collapse). */
  allowGTC: boolean;
  onOpenChange: (open: boolean) => void;
  onSeeQuote: (symbol: string) => void;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

const COMMISSION_USD = 0;

/**
 * Rich trade-entry dialog launched from {@link QuoteInfoDialog}'s "Trade" button.
 * Renders a sticky mini-quote at the top so the price never leaves the screen
 * during sizing, then walks the user through direction → size → order options →
 * summary. Per-game feature flags hide order types entirely rather than
 * showing them disabled — see {@link TradeOrderDialogProps}.
 */
export function TradeOrderDialog({
  open,
  initialSymbol,
  initialDirection = 'buy',
  gameId,
  allowShortSelling,
  allowLimitOrders,
  allowStopOrders,
  allowBracketOrders,
  allowGTC,
  onOpenChange,
  onSeeQuote,
}: TradeOrderDialogProps) {
  const [activeSymbol, setActiveSymbol] = useState<string | null>(initialSymbol);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [direction, setDirection] = useState<DirectionTab>(initialDirection);
  const [quantity, setQuantity] = useState<number>(1);
  const [term, setTerm] = useState<Term>('DAY');
  const [priceType, setPriceType] = useState<PriceType>('MARKET');
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [stopPrice, setStopPrice] = useState<string>('');
  const [takeProfitPrice, setTakeProfitPrice] = useState<string>('');
  const [stopLossPrice, setStopLossPrice] = useState<string>('');

  useEffect(() => {
    if (open) {
      setActiveSymbol(initialSymbol);
      setSearchQuery('');
      setShowSuggestions(false);
      setDirection(initialDirection);
      setQuantity(1);
      setTerm('DAY');
      setPriceType('MARKET');
      setLimitPrice('');
      setStopPrice('');
      setTakeProfitPrice('');
      setStopLossPrice('');
    }
  }, [open, initialSymbol, initialDirection]);

  const debouncedQuery = useDebouncedValue(searchQuery, 250);
  const search = useStockSearch(debouncedQuery);
  const details = useStockDetails(activeSymbol ?? '');
  const livePrice = useLiveStore((s) =>
    activeSymbol ? s.pricesBySymbol[activeSymbol]?.price : undefined,
  );
  // Skip the REST /stocks/:symbol fetch when a live WebSocket tick already
  // gives us the current price. We still fetch when livePrice is undefined
  // (e.g. dialog opens before the first tick lands).
  const quote = useStockQuote(activeSymbol ?? '', { enabled: livePrice === undefined });
  const portfolio = usePortfolio(gameId);
  const place = usePlaceTrade(gameId);

  const displayPrice = livePrice ?? quote.data?.price ?? details.data?.price;

  // Helper: pick a sane default for the conditional price field that this
  // price type needs. Invoked from the pill onClick so the field is filled
  // synchronously rather than via a post-render effect (which would re-run
  // every time the user typed in the field).
  const pickPriceType = (next: PriceType) => {
    setPriceType(next);
    if (displayPrice === undefined || displayPrice <= 0) return;
    const fmt = (n: number) => n.toFixed(2);
    if (next === 'LIMIT' && limitPrice === '') setLimitPrice(fmt(displayPrice));
    else if (next === 'STOP' && stopPrice === '') setStopPrice(fmt(displayPrice));
    else if (next === 'STOP_LIMIT') {
      if (limitPrice === '') setLimitPrice(fmt(displayPrice));
      if (stopPrice === '') setStopPrice(fmt(displayPrice));
    } else if (next === 'BRACKET') {
      const isBuySide = direction === 'buy';
      const offset = displayPrice * 0.05;
      const tpDefault = isBuySide ? displayPrice + offset : displayPrice - offset;
      const slDefault = isBuySide ? displayPrice - offset : displayPrice + offset;
      if (takeProfitPrice === '') setTakeProfitPrice(fmt(tpDefault));
      if (stopLossPrice === '') setStopLossPrice(fmt(slDefault));
    }
  };

  const cashBalance = portfolio.data?.cashBalance ?? 0;
  const totalPortfolioValue = portfolio.data?.totalValue ?? 0;
  const heldQuantity = useMemo(() => {
    if (!activeSymbol) return 0;
    return portfolio.data?.holdings.find((h) => h.symbol === activeSymbol)?.quantity ?? 0;
  }, [portfolio.data, activeSymbol]);
  const heldAvgCost = useMemo(() => {
    if (!activeSymbol) return 0;
    return portfolio.data?.holdings.find((h) => h.symbol === activeSymbol)?.avgCostBasis ?? 0;
  }, [portfolio.data, activeSymbol]);

  const isBuy = direction === 'buy';
  const tradeDirection: TradeDirection = isBuy ? 'buy' : 'sell';

  const maxQuantity = useMemo(() => {
    if (isBuy) {
      if (!displayPrice || displayPrice <= 0) return 0;
      return Math.max(0, Math.floor(cashBalance / displayPrice));
    }
    return heldQuantity;
  }, [isBuy, displayPrice, cashBalance, heldQuantity]);

  const effectiveQuantity = Math.min(Math.max(1, quantity), Math.max(1, maxQuantity));
  const orderValue = (displayPrice ?? 0) * effectiveQuantity;
  const total = orderValue + COMMISSION_USD;

  const currentPosition: PositionSnapshot = useMemo(
    () => ({
      shares: heldQuantity,
      avgCost: heldAvgCost,
      value: heldQuantity * (displayPrice ?? 0),
    }),
    [heldQuantity, heldAvgCost, displayPrice],
  );
  const afterPosition = useMemo(
    () => projectPositionAfter(currentPosition, tradeDirection, effectiveQuantity, displayPrice ?? 0),
    [currentPosition, tradeDirection, effectiveQuantity, displayPrice],
  );
  const allocation = useMemo(
    () =>
      projectAllocation({
        totalBefore: totalPortfolioValue,
        cashBefore: cashBalance,
        currentPositionValue: currentPosition.value,
        direction: tradeDirection,
        tradeNotional: orderValue,
        positionValueAfter: afterPosition.value,
      }),
    [
      totalPortfolioValue,
      cashBalance,
      currentPosition.value,
      tradeDirection,
      orderValue,
      afterPosition.value,
    ],
  );

  const handlePickSymbol = (next: string) => {
    setActiveSymbol(next);
    setSearchQuery('');
    setShowSuggestions(false);
    setQuantity(1);
  };

  const handleClear = () => {
    setDirection('buy');
    setQuantity(1);
    setTerm('DAY');
    setPriceType('MARKET');
    setLimitPrice('');
    setStopPrice('');
    setTakeProfitPrice('');
    setStopLossPrice('');
  };

  const showLimitPrice = priceType === 'LIMIT' || priceType === 'STOP_LIMIT' || priceType === 'BRACKET';
  const showStopPrice = priceType === 'STOP' || priceType === 'STOP_LIMIT';
  const showBracket = priceType === 'BRACKET';
  const limitPriceRequired = priceType === 'LIMIT' || priceType === 'STOP_LIMIT';

  const { parsedLimit, parsedStop, parsedTP, parsedSL } = useMemo(
    () => ({
      parsedLimit: parseFloat(limitPrice),
      parsedStop: parseFloat(stopPrice),
      parsedTP: parseFloat(takeProfitPrice),
      parsedSL: parseFloat(stopLossPrice),
    }),
    [limitPrice, stopPrice, takeProfitPrice, stopLossPrice],
  );

  const priceFieldsValid = (() => {
    if (priceType === 'MARKET') return true;
    if (priceType === 'LIMIT') return parsedLimit > 0;
    if (priceType === 'STOP') return parsedStop > 0;
    if (priceType === 'STOP_LIMIT') return parsedLimit > 0 && parsedStop > 0;
    if (priceType === 'BRACKET') {
      if (!(parsedTP > 0) || !(parsedSL > 0)) return false;
      return tradeDirection === 'buy' ? parsedTP > parsedSL : parsedTP < parsedSL;
    }
    return false;
  })();

  const canSubmit =
    !!activeSymbol &&
    (direction === 'buy' || direction === 'sell') &&
    effectiveQuantity >= 1 &&
    maxQuantity >= 1 &&
    priceFieldsValid &&
    !place.isPending;

  const submitLabel = (() => {
    if (place.isPending) return 'Submitting…';
    if (!activeSymbol) return 'Submit Order';
    const verb = (() => {
      if (direction === 'buy') return 'Buy';
      if (direction === 'sell') return 'Sell';
      if (direction === 'sell-short') return 'Sell short';
      return 'Buy to cover';
    })();
    return `${verb} ${effectiveQuantity} ${activeSymbol}`;
  })();

  const handleSubmit = async () => {
    if (!activeSymbol || !canSubmit) return;
    try {
      const payload: PlaceTradeRequest = {
        symbol: activeSymbol,
        direction: tradeDirection,
        quantity: effectiveQuantity,
        orderType: PRICE_TYPE_TO_ORDER_TYPE[priceType],
        timeInForce: term === 'GTC' ? 'gtc' : 'day',
        ...(showLimitPrice && limitPrice.length > 0 && { limitPrice: parsedLimit }),
        ...(showStopPrice && { stopPrice: parsedStop }),
        ...(showBracket && {
          takeProfitPrice: parsedTP,
          stopLossPrice: parsedSL,
        }),
      };
      const result = await place.mutateAsync(payload);
      if (result.kind === 'pending') {
        const verb = tradeDirection === 'buy' ? 'Buy' : 'Sell';
        toast({
          title: `${verb} ${effectiveQuantity} ${activeSymbol} queued`,
          description: `Order will execute at next market open (~ ${formatUSD(result.pending.reservedPrice * effectiveQuantity)}).`,
          variant: 'success',
        });
      } else if (result.kind === 'working') {
        const verb = tradeDirection === 'buy' ? 'Buy' : 'Sell';
        const label =
          priceType === 'BRACKET'
            ? 'bracket'
            : priceType === 'STOP_LIMIT'
              ? 'stop-limit'
              : priceType.toLowerCase();
        toast({
          title: `${verb} ${effectiveQuantity} ${activeSymbol} placed`,
          description: `${label} ${term} order resting — will fill when the price condition is met.`,
          variant: 'success',
        });
      } else {
        const verb = tradeDirection === 'buy' ? 'Bought' : 'Sold';
        let description: string | undefined =
          displayPrice !== undefined ? `~ ${formatUSD(orderValue)}` : undefined;
        if (result.priceWasStale === true) {
          const ageSec = Math.round((result.priceAgeMs ?? 0) / 1000);
          description = `Filled at last known price (${ageSec}s old) — live data was rate-limited.`;
        }
        toast({
          title: `${verb} ${effectiveQuantity} ${activeSymbol}`,
          ...(description !== undefined ? { description } : {}),
          variant: 'success',
        });
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Trade failed',
        description: extractApiMessage(err),
        variant: 'destructive',
      });
    }
  };

  const isValidSearchSymbol = SYMBOL_RE.test(searchQuery.trim().toUpperCase());
  const changeUp = (details.data?.change ?? 0) >= 0;

  // Enabled order-type pills derived from per-game flags. Market is always
  // present. Stop-limit requires both limit AND stop. Hidden when disabled.
  const enabledTypes: PriceType[] = ['MARKET'];
  if (allowLimitOrders) enabledTypes.push('LIMIT');
  if (allowStopOrders) enabledTypes.push('STOP');
  if (allowLimitOrders && allowStopOrders) enabledTypes.push('STOP_LIMIT');
  if (allowBracketOrders) enabledTypes.push('BRACKET');

  // Term row visibility:
  //   - hidden entirely when GTC is not allowed (only Day exists, no choice)
  //   - visible-disabled when current type is Market (TIF doesn't apply)
  //   - visible-active otherwise
  const termRowVisible = allowGTC;
  const termRowDisabled = priceType === 'MARKET';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Trade Order</DialogTitle>
        </DialogHeader>

        {/* Sticky mini-quote header */}
        {activeSymbol && (
          <div className="sticky top-0 z-10 border-b border-hairline-strong bg-bg px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-bg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-accent">
                  <span className="h-1.5 w-1.5 rounded-full bg-gain animate-pulse-dot" />
                  {activeSymbol}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-text-strong">
                    {details.data?.companyName ?? activeSymbol}
                  </div>
                  {details.data?.exchange && (
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted">
                      {details.data.exchange}
                    </div>
                  )}
                </div>
              </div>
              {displayPrice !== undefined && (
                <div className="text-right">
                  <div className="font-mono text-xl font-bold leading-none tabular-nums">
                    {formatUSD(displayPrice)}
                  </div>
                  {details.data && (
                    <div
                      className={cn(
                        'mt-1 font-mono text-xs font-semibold tabular-nums',
                        changeUp ? 'text-gain' : 'text-loss',
                      )}
                    >
                      <span aria-hidden>{changeUp ? '▲' : '▼'}</span>{' '}
                      {(details.data.change ?? 0) >= 0 ? '+' : ''}
                      {(details.data.change ?? 0).toFixed(2)} ·{' '}
                      {(details.data.changePercent ?? 0).toFixed(2)}%
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-5">
          {/* Symbol search — only shown when no symbol is selected yet */}
          {!activeSymbol && (
            <div className="relative">
              <Input
                placeholder="Enter Company or Symbol"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isValidSearchSymbol) {
                    e.preventDefault();
                    handlePickSymbol(searchQuery.trim().toUpperCase());
                  }
                }}
                autoComplete="off"
                className="bg-background"
              />
              {showSuggestions && search.data && search.data.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-44 w-full overflow-auto rounded-md border bg-background shadow-md">
                  {search.data.slice(0, 8).map((r) => (
                    <li key={r.symbol}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                        onClick={() => handlePickSymbol(r.symbol)}
                      >
                        <span className="font-medium">{r.symbol}</span>
                        <span className="ml-2 text-muted-foreground">{r.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {activeSymbol && (
            <>
              {/* Direction tabs */}
              <DirectionTabs
                value={direction}
                onChange={setDirection}
                allowShortSelling={allowShortSelling}
              />

              {/* SIZE */}
              <section className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-strong">
                    Size
                  </h3>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted">
                    {isBuy ? `Buying power ${formatUSD(cashBalance)}` : `Held ${heldQuantity}`}
                  </span>
                </div>

                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <div className="rounded-md border border-hairline-strong bg-panel px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-muted">
                        Shares
                      </div>
                      <Input
                        type="number"
                        min={1}
                        max={maxQuantity > 0 ? maxQuantity : undefined}
                        step={1}
                        value={effectiveQuantity}
                        onChange={(e) =>
                          setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                        }
                        className="mt-1 h-auto border-0 bg-transparent p-0 font-mono text-3xl font-bold leading-none focus-visible:ring-0"
                      />
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-muted">
                        ≈ Amount
                      </div>
                      <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
                        {displayPrice !== undefined ? formatUSD(orderValue) : '—'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.max(1, maxQuantity))}
                    disabled={maxQuantity < 1}
                    className="rounded-md border border-hairline-strong bg-panel px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent hover:bg-accent-bg disabled:opacity-50 disabled:hover:bg-panel"
                  >
                    Max {maxQuantity}
                  </button>
                </div>

                <input
                  type="range"
                  min={1}
                  max={Math.max(1, maxQuantity)}
                  step={1}
                  value={effectiveQuantity}
                  onChange={(e) => setQuantity(Number(e.target.value) || 1)}
                  disabled={maxQuantity < 1}
                  className="w-full accent-accent"
                />

                <div className="flex gap-2">
                  <QuickFill label="+10" onClick={() => bumpQty(setQuantity, effectiveQuantity, 10, maxQuantity)} disabled={maxQuantity < 1} />
                  <QuickFill label="+25" onClick={() => bumpQty(setQuantity, effectiveQuantity, 25, maxQuantity)} disabled={maxQuantity < 1} />
                  <QuickFill label="+100" onClick={() => bumpQty(setQuantity, effectiveQuantity, 100, maxQuantity)} disabled={maxQuantity < 1} />
                  <QuickFill label="25%" onClick={() => setQuantity(Math.max(1, Math.floor(maxQuantity * 0.25)))} disabled={maxQuantity < 1} />
                  <QuickFill label="50%" onClick={() => setQuantity(Math.max(1, Math.floor(maxQuantity * 0.5)))} disabled={maxQuantity < 1} />
                </div>
              </section>

              {/* PORTFOLIO ALLOCATION */}
              {totalPortfolioValue > 0 && (
                <section className="space-y-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted">
                    Portfolio after this trade
                  </div>
                  <AllocationBar
                    positionPct={allocation.positionPct}
                    cashPct={allocation.cashPct}
                    otherPct={allocation.otherPct}
                    symbol={activeSymbol}
                  />
                </section>
              )}

              {/* POSITION COMPARE — only when there's a position before or after */}
              {(currentPosition.shares > 0 || afterPosition.shares > 0) && (
                <section className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-strong">
                      Position
                    </h3>
                    <span className="text-[10px] uppercase tracking-[0.14em] text-muted">
                      Current → After
                    </span>
                  </div>
                  <PositionCompare current={currentPosition} after={afterPosition} />
                </section>
              )}

              {/* ORDER OPTIONS */}
              <section className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-strong">
                    Order
                  </h3>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted">
                    Defaults work for most trades
                  </span>
                </div>

                {/* Type pill row */}
                <PillRow label="Type">
                  {enabledTypes.map((t) => (
                    <Pill key={t} active={priceType === t} onClick={() => pickPriceType(t)}>
                      {labelForType(t)}
                    </Pill>
                  ))}
                </PillRow>

                {/* Conditional price fields */}
                {(showLimitPrice || showStopPrice) && (
                  <div className="grid grid-cols-2 gap-3">
                    {showLimitPrice && (
                      <PriceField
                        id="limit-price"
                        label={showBracket ? 'Entry limit (optional)' : 'Limit price'}
                        value={limitPrice}
                        onChange={setLimitPrice}
                        {...(displayPrice !== undefined && parsedLimit > 0 && {
                          deltaVsLast: { last: displayPrice, value: parsedLimit },
                        })}
                        invalid={limitPriceRequired && limitPrice.length > 0 && !(parsedLimit > 0)}
                      />
                    )}
                    {showStopPrice && (
                      <PriceField
                        id="stop-price"
                        label="Stop price"
                        value={stopPrice}
                        onChange={setStopPrice}
                        {...(displayPrice !== undefined && parsedStop > 0 && {
                          deltaVsLast: { last: displayPrice, value: parsedStop },
                        })}
                        invalid={stopPrice.length > 0 && !(parsedStop > 0)}
                      />
                    )}
                  </div>
                )}

                {showBracket && (
                  <div className="grid grid-cols-2 gap-3">
                    <PriceField
                      id="tp-price"
                      label="Take profit"
                      value={takeProfitPrice}
                      onChange={setTakeProfitPrice}
                    />
                    <PriceField
                      id="sl-price"
                      label="Stop loss"
                      value={stopLossPrice}
                      onChange={setStopLossPrice}
                    />
                    {parsedTP > 0 &&
                      parsedSL > 0 &&
                      (tradeDirection === 'buy' ? parsedTP <= parsedSL : parsedTP >= parsedSL) && (
                        <p className="col-span-2 text-xs text-loss">
                          {tradeDirection === 'buy'
                            ? 'Take profit must be greater than stop loss for a long bracket.'
                            : 'Take profit must be less than stop loss for a short bracket.'}
                        </p>
                      )}
                  </div>
                )}

                {/* Term pill row */}
                {termRowVisible && (
                  <PillRow
                    label="Term"
                    disabled={termRowDisabled}
                    {...(termRowDisabled && { reason: 'Not used for market orders' })}
                  >
                    <Pill active={term === 'DAY'} disabled={termRowDisabled} onClick={() => setTerm('DAY')}>
                      Day
                    </Pill>
                    <Pill active={term === 'GTC'} disabled={termRowDisabled} onClick={() => setTerm('GTC')}>
                      Good til canceled
                    </Pill>
                  </PillRow>
                )}
              </section>

              {/* SUMMARY */}
              <section className="space-y-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted">Summary</div>
                <div className="rounded-md border border-hairline-strong bg-panel font-mono">
                  <SummaryRow
                    label="Price per share"
                    value={displayPrice !== undefined ? formatUSD(displayPrice) : '—'}
                  />
                  <SummaryRow label="Quantity" value={String(effectiveQuantity)} />
                  <SummaryRow label="Commission" value={formatUSD(COMMISSION_USD)} />
                  <SummaryRow
                    label="Total"
                    value={
                      <span>
                        {displayPrice !== undefined ? formatUSD(total) : '—'}
                        <sup>*</sup>
                      </span>
                    }
                    bold
                    last
                  />
                </div>
                <p className="text-right text-[10px] uppercase tracking-[0.14em] text-muted">
                  * Estimate at current quote price
                </p>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-hairline-strong bg-bg px-6 py-3">
          <Button
            type="button"
            variant="outline"
            className="uppercase tracking-wide"
            onClick={() => activeSymbol && onSeeQuote(activeSymbol)}
            disabled={!activeSymbol}
          >
            See Quote
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="uppercase tracking-wide"
              onClick={handleClear}
            >
              Clear
            </Button>
            <Button
              type="button"
              className="uppercase tracking-wider px-6"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function bumpQty(
  setQuantity: (n: number) => void,
  current: number,
  delta: number,
  max: number,
) {
  setQuantity(Math.min(Math.max(1, current + delta), Math.max(1, max)));
}

function labelForType(t: PriceType): string {
  switch (t) {
    case 'MARKET':
      return 'Market';
    case 'LIMIT':
      return 'Limit';
    case 'STOP':
      return 'Stop';
    case 'STOP_LIMIT':
      return 'Stop limit';
    case 'BRACKET':
      return 'Bracket';
  }
}

const DirectionTabs = memo(function DirectionTabs({
  value,
  onChange,
  allowShortSelling,
}: {
  value: DirectionTab;
  onChange: (next: DirectionTab) => void;
  allowShortSelling: boolean;
}) {
  const tabs: { key: DirectionTab; label: string; tone: 'buy' | 'sell'; disabled?: boolean }[] =
    allowShortSelling
      ? [
          { key: 'buy', label: 'Buy', tone: 'buy' },
          { key: 'sell', label: 'Sell', tone: 'sell' },
          { key: 'sell-short', label: 'Sell short', tone: 'sell', disabled: true },
          { key: 'buy-to-cover', label: 'Buy to cover', tone: 'buy', disabled: true },
        ]
      : [
          { key: 'buy', label: 'Buy', tone: 'buy' },
          { key: 'sell', label: 'Sell', tone: 'sell' },
        ];
  const gridClass = allowShortSelling ? 'grid-cols-4' : 'grid-cols-2';
  return (
    <div className={cn('grid gap-1 rounded-md border border-hairline-strong bg-panel p-1', gridClass)}>
      {tabs.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            disabled={t.disabled}
            onClick={() => !t.disabled && onChange(t.key)}
            className={cn(
              'rounded-[6px] px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] transition-colors',
              !active && !t.disabled && 'text-muted hover:text-text',
              active && t.tone === 'buy' && 'bg-gain/10 text-gain shadow-[inset_0_0_0_1px_rgba(16,185,129,0.3)]',
              active && t.tone === 'sell' && 'bg-loss/10 text-loss shadow-[inset_0_0_0_1px_rgba(239,68,68,0.3)]',
              t.disabled && 'cursor-not-allowed text-disabled-fg',
            )}
            title={t.disabled ? 'Coming soon' : undefined}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
});

const PillRow = memo(function PillRow({
  label,
  children,
  disabled = false,
  reason,
}: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
  reason?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          'min-w-[44px] text-[10px] font-semibold uppercase tracking-[0.14em]',
          disabled ? 'text-disabled-fg' : 'text-muted',
        )}
      >
        {label}
      </span>
      {children}
      {disabled && reason && (
        <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-disabled-fg">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1" />
            <path d="M5 3v3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            <circle cx="5" cy="7.5" r="0.6" fill="currentColor" />
          </svg>
          {reason}
        </span>
      )}
    </div>
  );
});

const Pill = memo(function Pill({
  active,
  disabled = false,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors',
        disabled && [
          'cursor-not-allowed border-disabled-border bg-disabled-bg text-disabled-fg',
          active && 'shadow-none',
        ],
        !disabled && !active && 'border-hairline-strong bg-panel text-muted hover:text-text hover:border-muted',
        !disabled && active && 'border-accent/40 bg-accent-bg text-accent shadow-[inset_0_0_0_1px_rgba(103,232,249,0.15)]',
      )}
    >
      {children}
    </button>
  );
});

const PriceField = memo(function PriceField({
  id,
  label,
  value,
  onChange,
  deltaVsLast,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  deltaVsLast?: { last: number; value: number };
  invalid?: boolean;
}) {
  return (
    <div className="rounded-md border border-hairline-strong bg-panel px-3 py-2.5">
      <label htmlFor={id} className="text-[10px] uppercase tracking-[0.14em] text-muted">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        step="0.01"
        min={0}
        placeholder="$"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-auto border-0 bg-transparent p-0 font-mono text-lg font-bold focus-visible:ring-0"
      />
      {invalid && <p className="mt-1 text-[10px] text-loss">Must be greater than 0</p>}
      {!invalid && deltaVsLast && (
        <DeltaVsLast last={deltaVsLast.last} value={deltaVsLast.value} />
      )}
    </div>
  );
});

function DeltaVsLast({ last, value }: { last: number; value: number }) {
  const diff = value - last;
  const pct = last > 0 ? (diff / last) * 100 : 0;
  const up = diff >= 0;
  return (
    <div className="mt-1 font-mono text-[11px] tabular-nums">
      <span className="text-muted">vs last </span>
      <span className={up ? 'text-gain' : 'text-loss'}>
        {up ? '+' : ''}
        {diff.toFixed(2)}
      </span>{' '}
      <span className="text-muted">·</span>{' '}
      <span className={up ? 'text-gain' : 'text-loss'}>
        {up ? '+' : ''}
        {pct.toFixed(2)}%
      </span>
    </div>
  );
}

const QuickFill = memo(function QuickFill({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex-1 rounded-md border border-hairline-strong bg-panel py-2 text-[11px] font-semibold uppercase tracking-wider text-muted transition-colors hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-hairline-strong disabled:hover:text-muted"
    >
      {label}
    </button>
  );
});

const AllocationBar = memo(function AllocationBar({
  positionPct,
  cashPct,
  otherPct,
  symbol,
}: {
  positionPct: number;
  cashPct: number;
  otherPct: number;
  symbol: string;
}) {
  const totalShown = positionPct + cashPct + otherPct;
  if (totalShown < 0.5) {
    return <div className="h-6 rounded-md border border-hairline-strong bg-panel" />;
  }
  return (
    <div className="space-y-1.5">
      <div className="flex h-6 overflow-hidden rounded-md border border-hairline-strong bg-panel">
        {positionPct > 0 && (
          <div
            className="flex items-center justify-start bg-accent/20 px-2 text-[9px] font-bold uppercase tracking-wider text-accent"
            style={{ width: `${positionPct}%` }}
            title={`${symbol} ${positionPct.toFixed(1)}%`}
          >
            {positionPct >= 8 && `${symbol} ${positionPct.toFixed(0)}%`}
          </div>
        )}
        {otherPct > 0 && (
          <div
            className="flex items-center justify-start bg-text/10 px-2 text-[9px] font-bold uppercase tracking-wider text-muted"
            style={{ width: `${otherPct}%` }}
            title={`Other ${otherPct.toFixed(1)}%`}
          >
            {otherPct >= 10 && `Other ${otherPct.toFixed(0)}%`}
          </div>
        )}
        {cashPct > 0 && (
          <div
            className="flex items-center justify-start px-2 text-[9px] font-bold uppercase tracking-wider text-muted"
            style={{ width: `${cashPct}%` }}
            title={`Cash ${cashPct.toFixed(1)}%`}
          >
            {cashPct >= 10 && `Cash ${cashPct.toFixed(0)}%`}
          </div>
        )}
      </div>
    </div>
  );
});

const PositionCompare = memo(function PositionCompare({
  current,
  after,
}: {
  current: PositionSnapshot;
  after: PositionSnapshot;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
      <PositionCard label="Current" snapshot={current} />
      <div className="flex items-center justify-center text-muted">→</div>
      <PositionCard label="After" snapshot={after} highlight />
    </div>
  );
});

const PositionCard = memo(function PositionCard({
  label,
  snapshot,
  highlight = false,
}: {
  label: string;
  snapshot: PositionSnapshot;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2.5',
        highlight
          ? 'border-gain/30 bg-gradient-to-b from-gain/[0.06] to-panel'
          : 'border-hairline-strong bg-panel',
      )}
    >
      <div
        className={cn(
          'text-[10px] uppercase tracking-[0.14em]',
          highlight ? 'text-gain' : 'text-muted',
        )}
      >
        {label}
      </div>
      <CompareRow label="Shares" value={String(snapshot.shares)} />
      <CompareRow
        label="Avg cost"
        value={snapshot.shares > 0 ? formatUSD(snapshot.avgCost) : '—'}
      />
      <CompareRow label="Value" value={formatUSD(snapshot.value)} bold />
    </div>
  );
});

const CompareRow = memo(function CompareRow({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-0.5 text-xs">
      <span className="text-muted">{label}</span>
      <span className={cn('font-mono tabular-nums', bold && 'font-semibold')}>{value}</span>
    </div>
  );
});

const SummaryRow = memo(function SummaryRow({
  label,
  value,
  bold,
  last,
}: {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-2.5 text-sm',
        !last && 'border-b border-hairline-strong',
        bold && 'text-base font-semibold',
      )}
    >
      <span className={cn(!bold && 'text-muted')}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
});

function extractApiMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body;
    if (body && typeof body === 'object') {
      const rec = body as Record<string, unknown>;
      if (typeof rec['message'] === 'string') return rec['message'];
      if (typeof rec['error'] === 'string') return rec['error'];
    }
    return `${err.status} ${err.message}`;
  }
  return err instanceof Error ? err.message : 'Unknown error';
}
