import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStockSearch, useStockDetails, useStockQuote } from '@/api/stocks';
import { usePlaceTrade, usePortfolio } from '@/api/trades';
import { useLiveStore } from '@/stores/liveStore';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import { cn, formatUSD, SYMBOL_RE } from '@/lib/utils';
import type { TradeDirection } from '@markettrader/shared';

type Term = 'DAY' | 'GTC';
type PriceType = 'MARKET' | 'LIMIT' | 'STOP' | 'BRACKET';
type DirectionTab = 'buy' | 'sell-short' | 'sell' | 'buy-to-cover';

interface TradeOrderDialogProps {
  open: boolean;
  initialSymbol: string | null;
  gameId: string;
  /** When false, SELL SHORT and BUY TO COVER tabs are hidden entirely. */
  allowShortSelling: boolean;
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
 * Renders the full order-ticket UI (term, price type, summary, commission) but
 * the backend only consumes `{symbol, direction, quantity}` today — extra
 * controls are disabled until backend support lands.
 */
export function TradeOrderDialog({
  open,
  initialSymbol,
  gameId,
  allowShortSelling,
  onOpenChange,
  onSeeQuote,
}: TradeOrderDialogProps) {
  const [activeSymbol, setActiveSymbol] = useState<string | null>(initialSymbol);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [direction, setDirection] = useState<DirectionTab>('buy');
  const [quantity, setQuantity] = useState<number>(1);
  const [term, setTerm] = useState<Term>('DAY');
  const [priceType, setPriceType] = useState<PriceType>('MARKET');
  const [limitPrice, setLimitPrice] = useState<string>('');

  useEffect(() => {
    if (open) {
      setActiveSymbol(initialSymbol);
      setSearchQuery('');
      setShowSuggestions(false);
      setDirection('buy');
      setQuantity(1);
      setTerm('DAY');
      setPriceType('MARKET');
      setLimitPrice('');
    }
  }, [open, initialSymbol]);

  const debouncedQuery = useDebouncedValue(searchQuery, 250);
  const search = useStockSearch(debouncedQuery);
  const details = useStockDetails(activeSymbol ?? '');
  const quote = useStockQuote(activeSymbol ?? '');
  const livePrice = useLiveStore((s) =>
    activeSymbol ? s.pricesBySymbol[activeSymbol]?.price : undefined,
  );
  const portfolio = usePortfolio(gameId);
  const place = usePlaceTrade(gameId);

  const displayPrice = livePrice ?? quote.data?.price ?? details.data?.price;
  const cashBalance = portfolio.data?.cashBalance ?? 0;
  const totalPortfolioValue = portfolio.data?.totalValue ?? 0;
  const heldQuantity = useMemo(() => {
    if (!activeSymbol) return 0;
    return (
      portfolio.data?.holdings.find((h) => h.symbol === activeSymbol)?.quantity ?? 0
    );
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

  const allocationPct = useMemo(() => {
    if (totalPortfolioValue <= 0) return 0;
    return Math.min(100, (orderValue / totalPortfolioValue) * 100);
  }, [orderValue, totalPortfolioValue]);

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
  };

  const canSubmit =
    !!activeSymbol &&
    priceType === 'MARKET' &&
    term === 'DAY' &&
    (direction === 'buy' || direction === 'sell') &&
    effectiveQuantity >= 1 &&
    maxQuantity >= 1 &&
    !place.isPending;

  const handleSubmit = async () => {
    if (!activeSymbol || !canSubmit) return;
    try {
      const result = await place.mutateAsync({
        symbol: activeSymbol,
        direction: tradeDirection,
        quantity: effectiveQuantity,
      });
      if (result.kind === 'pending') {
        const verb = tradeDirection === 'buy' ? 'Buy' : 'Sell';
        toast({
          title: `${verb} ${effectiveQuantity} ${activeSymbol} queued`,
          description: `Order will execute at next market open (~ ${formatUSD(result.pending.reservedPrice * effectiveQuantity)}).`,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="uppercase tracking-wide">Trade Order</DialogTitle>
        </DialogHeader>

        <div className="max-h-[75vh] overflow-y-auto px-6 py-4 space-y-4 bg-muted/30">
          {/* Symbol search */}
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

          {/* Direction tabs */}
          <DirectionTabs
            value={direction}
            onChange={setDirection}
            allowShortSelling={allowShortSelling}
          />

          {activeSymbol && (
            <>
              {/* Symbol meta */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded bg-primary px-2 py-0.5 text-xs font-semibold uppercase text-primary-foreground">
                    {activeSymbol}
                  </span>
                  {details.data?.exchange && (
                    <span className="text-xs text-muted-foreground tracking-wide">
                      U.S.: {details.data.exchange}
                    </span>
                  )}
                </div>
                <h2 className="text-2xl font-bold">
                  {details.data?.companyName ?? activeSymbol}
                </h2>
                <hr />
              </div>

              {/* Quantity slider + big number */}
              <div className="space-y-2">
                <div className="flex items-end justify-between gap-4">
                  <div className="flex-1">
                    <input
                      type="range"
                      min={1}
                      max={Math.max(1, maxQuantity)}
                      step={1}
                      value={effectiveQuantity}
                      onChange={(e) => setQuantity(Number(e.target.value) || 1)}
                      disabled={maxQuantity < 1}
                      className="w-full accent-foreground"
                    />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={maxQuantity > 0 ? maxQuantity : undefined}
                      step={1}
                      value={effectiveQuantity}
                      onChange={(e) =>
                        setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                      }
                      className="w-24 text-right text-2xl font-bold h-12 bg-background"
                    />
                    <span className="text-2xl font-bold">
                      {effectiveQuantity === 1 ? 'Share' : 'Shares'}
                    </span>
                  </div>
                </div>
                <p className="text-right text-xs text-muted-foreground">
                  Use the slider to set a value or enter one manually.
                  {isBuy
                    ? ` Max ${maxQuantity} (affordable).`
                    : ` Max ${maxQuantity} (held).`}
                </p>
              </div>

              {/* Portfolio Allocation */}
              <div className="space-y-1">
                <Label>Portfolio Allocation</Label>
                <div className="h-3 w-full rounded bg-muted">
                  <div
                    className="h-full rounded bg-green-600"
                    style={{ width: `${allocationPct}%` }}
                  />
                </div>
              </div>

              {/* Term */}
              <div className="space-y-1">
                <Label>Term</Label>
                <SegmentedTwo
                  leftLabel="Day Order"
                  rightLabel="Good Til Canceled"
                  leftActive={term === 'DAY'}
                  onLeft={() => setTerm('DAY')}
                  onRight={undefined}
                  rightDisabledHint="Coming soon"
                />
              </div>

              {/* Price Type + Price */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="price-type">Price Type</Label>
                  <select
                    id="price-type"
                    value={priceType}
                    onChange={(e) => setPriceType(e.target.value as PriceType)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm uppercase tracking-wide font-semibold focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="MARKET">MARKET</option>
                    <option value="LIMIT" disabled>
                      LIMIT (coming soon)
                    </option>
                    <option value="STOP" disabled>
                      STOP (coming soon)
                    </option>
                    <option value="BRACKET" disabled>
                      BRACKET (coming soon)
                    </option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="limit-price">Price</Label>
                  <Input
                    id="limit-price"
                    type="number"
                    step="0.01"
                    min={0}
                    placeholder="$"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    disabled={priceType === 'MARKET'}
                    className="bg-background"
                  />
                </div>
              </div>

              {/* Order summary */}
              <div className="space-y-2">
                <Label>Order Summary</Label>
                <div className="rounded-md border bg-background">
                  <SummaryRow
                    label="Price per share"
                    value={displayPrice !== undefined ? formatUSD(displayPrice) : '—'}
                  />
                  <SummaryRow label="Amount" value={String(effectiveQuantity)} />
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
                <p className="text-right text-xs text-muted-foreground">
                  *Estimate based on current quote price
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t bg-background px-6 py-3">
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
              className="uppercase tracking-wide bg-violet-600 hover:bg-violet-700 text-white"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {place.isPending ? 'Submitting…' : 'Submit Order'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DirectionTabs({
  value,
  onChange,
  allowShortSelling,
}: {
  value: DirectionTab;
  onChange: (next: DirectionTab) => void;
  allowShortSelling: boolean;
}) {
  const tabs: { key: DirectionTab; label: string; disabled?: boolean }[] =
    allowShortSelling
      ? [
          { key: 'buy', label: 'Buy' },
          { key: 'sell-short', label: 'Sell Short', disabled: true },
          { key: 'sell', label: 'Sell' },
          { key: 'buy-to-cover', label: 'Buy to Cover', disabled: true },
        ]
      : [
          { key: 'buy', label: 'Buy' },
          { key: 'sell', label: 'Sell' },
        ];
  const gridClass = allowShortSelling ? 'grid-cols-4' : 'grid-cols-2';
  return (
    <div className={cn('grid rounded-md border overflow-hidden bg-background', gridClass)}>
      {tabs.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            disabled={t.disabled}
            onClick={() => !t.disabled && onChange(t.key)}
            className={cn(
              'px-3 py-3 text-sm font-semibold uppercase tracking-wide transition-colors',
              active && 'bg-foreground text-background',
              !active && !t.disabled && 'hover:bg-muted',
              t.disabled &&
                'cursor-not-allowed text-muted-foreground bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(0,0,0,0.05)_6px,rgba(0,0,0,0.05)_12px)]',
            )}
            title={t.disabled ? 'Coming soon' : undefined}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function SegmentedTwo({
  leftLabel,
  rightLabel,
  leftActive,
  onLeft,
  onRight,
  rightDisabledHint,
}: {
  leftLabel: string;
  rightLabel: string;
  leftActive: boolean;
  onLeft: () => void;
  onRight: (() => void) | undefined;
  rightDisabledHint?: string;
}) {
  const rightDisabled = !onRight;
  return (
    <div className="grid grid-cols-2 rounded-md border overflow-hidden bg-background">
      <button
        type="button"
        onClick={onLeft}
        className={cn(
          'px-3 py-3 text-sm font-semibold uppercase tracking-wide transition-colors',
          leftActive ? 'bg-background text-foreground' : 'hover:bg-muted',
        )}
      >
        {leftLabel}
      </button>
      <button
        type="button"
        onClick={onRight}
        disabled={rightDisabled}
        title={rightDisabled ? rightDisabledHint : undefined}
        className={cn(
          'px-3 py-3 text-sm font-semibold uppercase tracking-wide transition-colors',
          !leftActive && !rightDisabled && 'bg-foreground text-background',
          rightDisabled &&
            'cursor-not-allowed text-muted-foreground bg-foreground/90 text-background/70',
        )}
      >
        {rightLabel}
      </button>
    </div>
  );
}

function SummaryRow({
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
        'flex items-center justify-between px-4 py-2',
        !last && 'border-b',
        bold && 'font-semibold',
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

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
