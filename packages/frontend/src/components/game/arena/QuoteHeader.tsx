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
  className?: string;
}

/**
 * Center-column quote strip: big symbol + price + delta + BUY/SELL.
 * When no symbol is selected, renders an empty-state hint instead of
 * faking numbers. `onTrade` is optional — buttons disable if absent so
 * the panel still renders cleanly during loading.
 */
export function QuoteHeader({ symbol, last, changeAbs, changePct, onTrade, className }: QuoteHeaderProps) {
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
          <span className="font-mono text-lg font-bold tracking-tight text-text-strong">{symbol}</span>
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
