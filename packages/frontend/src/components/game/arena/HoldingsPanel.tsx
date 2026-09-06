import { memo } from 'react';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { useLiveStore } from '@/stores/liveStore';
import { cn } from '@/lib/utils';

export interface HoldingRow {
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number;
  /** Last-known market value (qty × price). Live ticks override this per-row. */
  marketValue: number;
  /** Last-known P&L percent. Live ticks override this per-row. */
  pnlPct: number;
}

export interface HoldingsPanelProps {
  rows: HoldingRow[];
  onSelect?: (symbol: string) => void;
  className?: string;
}

const PRICE_FMT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const VALUE_FMT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});
const WHOLE_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * Left-rail holdings list. Two lines per position — identity and value on top,
 * cost basis and P&L beneath — closed by a measured rule whose filled length is
 * the position's weight, so the rail reads as a top-down allocation gauge.
 * Each row is memoized and subscribes to its own symbol's live tick, so a price
 * update for one holding doesn't re-render the others.
 */
export function HoldingsPanel({ rows, onSelect, className }: HoldingsPanelProps) {
  // Ranking and the weight-bar denominators come from the baseline `marketValue`
  // props, never the live store: reading prices here would re-render every row
  // on every tick and defeat the per-row subscription below.
  const ranked = [...rows].sort((a, b) => b.marketValue - a.marketValue);
  const totalValue = ranked.reduce((sum, r) => sum + r.marketValue, 0);
  const maxValue = ranked[0]?.marketValue ?? 0;

  return (
    <Panel className={className}>
      <PanelHeader>Holdings · {rows.length}</PanelHeader>
      <PanelBody>
        {ranked.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted">
            No holdings yet. Buy a symbol to open a position.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {ranked.map((r) => (
              <HoldingRowItem
                key={r.symbol}
                row={r}
                maxValue={maxValue}
                totalValue={totalValue}
                {...(onSelect ? { onSelect } : {})}
              />
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

const HoldingRowItem = memo(function HoldingRowItem({
  row,
  maxValue,
  totalValue,
  onSelect,
}: {
  row: HoldingRow;
  /** Largest position's baseline value — the weight bar's full-width mark. */
  maxValue: number;
  /** Baseline sum of all positions, for the announced allocation share. */
  totalValue: number;
  onSelect?: (symbol: string) => void;
}) {
  // Subscribe to the live price *for this symbol only*. Returns a primitive
  // so Object.is equality means the row re-renders only when its own price
  // changes — ticks on other symbols don't re-render this row.
  const livePrice = useLiveStore((s) => s.pricesBySymbol[row.symbol]?.price);
  const marketValue = livePrice !== undefined ? livePrice * row.quantity : row.marketValue;
  const pnlPct =
    livePrice !== undefined && row.avgCost > 0
      ? ((livePrice - row.avgCost) / row.avgCost) * 100
      : row.pnlPct;
  const pnlAbs = marketValue - row.avgCost * row.quantity;
  const tone = pnlPct >= 0 ? 'text-gain' : 'text-loss';

  const barPct = maxValue > 0 ? clampPct((marketValue / maxValue) * 100) : 0;
  const sharePct = totalValue > 0 ? clampPct((marketValue / totalValue) * 100) : 0;

  // The server has no company names for holdings yet and sends the symbol as a
  // stand-in; rendering it again would just print the ticker twice.
  const showName = row.name !== row.symbol;

  const content = (
    <>
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-xs text-accent">{row.symbol}</span>
        <span className="shrink-0 font-mono text-xs text-text-strong">
          {VALUE_FMT.format(marketValue)}
        </span>
      </span>
      <span className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-[10px]">
        <span className="truncate">
          {showName ? (
            <>
              <span className="text-muted">{row.name}</span>
              <span aria-hidden className="text-muted"> · </span>
            </>
          ) : null}
          <span className="text-text">{row.quantity}</span>
          <span className="text-muted"> @ {PRICE_FMT.format(row.avgCost)}</span>
        </span>
        <span className="shrink-0">
          <span className={tone}>{fmtSignedUsd(pnlAbs)}</span>
          <span className={cn('ml-1.5', tone)}>{fmtPct(pnlPct)}</span>
        </span>
      </span>
    </>
  );

  return (
    <li>
      {onSelect ? (
        <button
          type="button"
          onClick={() => onSelect(row.symbol)}
          aria-label={`${row.symbol}, ${sharePct.toFixed(0)}% of holdings, ${fmtPct(pnlPct)}`}
          className="block w-full rounded-chip px-1 py-1.5 text-left hover:bg-hairline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          {content}
        </button>
      ) : (
        <div className="px-1 py-1.5">{content}</div>
      )}
      {/* The separator is the gauge: hairline track, accent fill sized to this
          position's share of the largest one. */}
      <div aria-hidden className="h-px w-full bg-hairline">
        <div className="h-px bg-accent" style={{ width: `${barPct}%` }} />
      </div>
    </li>
  );
});

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function fmtPct(n: number): string {
  // Normalize near-zero so a tiny negative doesn't render "−0.00%".
  const v = Math.abs(n) < 0.005 ? 0 : n;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}

function fmtSignedUsd(n: number): string {
  // Whole dollars only — cents are noise on the secondary line, and the rail
  // has no room for them next to the percentage.
  const v = Math.abs(n) < 0.5 ? 0 : n;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}$${WHOLE_FMT.format(Math.abs(v))}`;
}
