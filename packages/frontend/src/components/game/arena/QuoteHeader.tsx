import { Info } from 'lucide-react';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { cn } from '@/lib/utils';
import { useCommandKStore } from '@/stores/commandKStore';
import type { TradeDirection } from '@markettrader/shared';

export interface QuoteHeaderProps {
  symbol: string | null;
  last?: number;
  changeAbs?: number;
  changePct?: number;
  onTrade?: (direction: TradeDirection) => void;
  /** Opens the quote-information window. Without it the ticker is plain text. */
  onOpenQuote?: () => void;
  className?: string;
}

/**
 * Center-column quote strip: big symbol + price + delta + BUY/SELL.
 * When no symbol is selected, renders an empty-state hint instead of
 * faking numbers. `onTrade` is optional — buttons disable if absent so
 * the panel still renders cleanly during loading. The ticker doubles as the
 * arena's way into the quote window, marked by a quiet ⓘ so it's findable
 * without adding a third button beside BUY/SELL.
 */
export function QuoteHeader({
  symbol,
  last,
  changeAbs,
  changePct,
  onTrade,
  onOpenQuote,
  className,
}: QuoteHeaderProps) {
  if (!symbol) {
    return (
      <Panel className={className}>
        <PanelHeader>Quote</PanelHeader>
        <PanelBody>
          <div className="flex flex-col items-center gap-2 py-3">
            <p className="text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              ▸ No symbol selected
            </p>
            <button
              type="button"
              onClick={() => useCommandKStore.getState().open$()}
              className="inline-flex items-center gap-2 rounded-chip border border-accent bg-accent-bg px-3 py-1.5 font-mono text-xs uppercase tracking-[0.1em] text-accent hover:bg-accent/15 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              Search symbols
              <kbd className="rounded-chip border border-hairline-strong bg-bg px-1.5 py-0.5 font-mono text-[10px] tracking-normal text-muted">
                ⌘K
              </kbd>
            </button>
          </div>
        </PanelBody>
      </Panel>
    );
  }

  const pos = (changePct ?? 0) >= 0;

  return (
    <Panel className={className}>
      <PanelHeader>Quote · {symbol}</PanelHeader>
      <PanelBody>
        <div className="grid grid-cols-[auto_auto_1fr_auto_auto] items-baseline gap-4">
          {onOpenQuote ? (
            <button
              type="button"
              onClick={onOpenQuote}
              aria-label={`${symbol} details`}
              title="Quote details"
              className="group inline-flex items-center gap-1.5 rounded-chip font-mono text-lg font-bold tracking-tight text-text-strong focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <span className="decoration-accent underline-offset-4 group-hover:underline">
                {symbol}
              </span>
              <Info aria-hidden className="h-3.5 w-3.5 text-muted group-hover:text-accent" />
            </button>
          ) : (
            <span className="font-mono text-lg font-bold tracking-tight text-text-strong">
              {symbol}
            </span>
          )}
          {last !== undefined ? (
            <span className="font-mono text-xl font-semibold tracking-tight text-text-strong">
              {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(last)}
            </span>
          ) : null}
          {changePct !== undefined ? (
            <span className={cn('font-mono text-xs', pos ? 'text-gain' : 'text-loss')}>
              {pos ? '+' : '−'}{Math.abs(changeAbs ?? 0).toFixed(2)} ({pos ? '+' : '−'}{Math.abs(changePct).toFixed(2)}%)
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onTrade?.('buy')}
            disabled={!onTrade}
            className="rounded-chip bg-accent px-3 py-1 font-mono text-xs font-bold tracking-[0.1em] text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            BUY
          </button>
          <button
            type="button"
            onClick={() => onTrade?.('sell')}
            disabled={!onTrade}
            className="rounded-chip border border-loss px-3 py-1 font-mono text-xs font-bold tracking-[0.1em] text-loss hover:bg-loss/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            SELL
          </button>
        </div>
      </PanelBody>
    </Panel>
  );
}
