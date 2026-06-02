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

/**
 * Center-column holdings table. Each row is a memoized sub-component that
 * subscribes to its own symbol's live tick — so a price update for one
 * holding doesn't re-render the others.
 */
export function HoldingsPanel({ rows, onSelect, className }: HoldingsPanelProps) {
  return (
    <Panel className={className}>
      <PanelHeader>Holdings · {rows.length} positions</PanelHeader>
      <PanelBody>
        {rows.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted">No holdings yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-hairline text-[9px] uppercase tracking-[0.16em] text-muted">
                <th className="py-1 text-left font-medium">Symbol</th>
                <th className="text-left font-medium">Name</th>
                <th className="text-right font-medium">Qty</th>
                <th className="text-right font-medium">Avg Cost</th>
                <th className="text-right font-medium">Value</th>
                <th className="text-right font-medium">P&L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <HoldingRowItem
                  key={r.symbol}
                  row={r}
                  {...(onSelect ? { onSelect } : {})}
                />
              ))}
            </tbody>
          </table>
        )}
      </PanelBody>
    </Panel>
  );
}

const HoldingRowItem = memo(function HoldingRowItem({
  row,
  onSelect,
}: {
  row: HoldingRow;
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

  return (
    <tr
      onClick={onSelect ? () => onSelect(row.symbol) : undefined}
      className={cn(
        'border-b border-hairline last:border-0',
        onSelect && 'cursor-pointer hover:bg-hairline',
      )}
    >
      <td className="py-1 font-mono text-accent">{row.symbol}</td>
      <td className="truncate pr-2 text-muted">{row.name}</td>
      <td className="text-right font-mono">{row.quantity}</td>
      <td className="text-right font-mono text-muted">{PRICE_FMT.format(row.avgCost)}</td>
      <td className="text-right font-mono">{PRICE_FMT.format(marketValue)}</td>
      <td className={cn('text-right font-mono', pnlPct >= 0 ? 'text-gain' : 'text-loss')}>
        {fmtPct(pnlPct)}
      </td>
    </tr>
  );
});

function fmtPct(n: number): string {
  // Normalize near-zero so a tiny negative doesn't render "−0.00%".
  const v = Math.abs(n) < 0.005 ? 0 : n;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}
