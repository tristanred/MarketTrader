import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { cn } from '@/lib/utils';

export interface HoldingRow {
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number;
  marketValue: number;
  pnlPct: number;
}

export interface HoldingsPanelProps {
  rows: HoldingRow[];
  onSelect?: (symbol: string) => void;
  className?: string;
}

/**
 * Center-column holdings table. Click a row → onSelect(symbol). The arena
 * (phase 3c) wires onSelect to SelectedSymbolContext so the chart and quote
 * header update in place.
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
                <th className="text-right font-medium">Qty</th>
                <th className="text-right font-medium">Avg Cost</th>
                <th className="text-right font-medium">Value</th>
                <th className="text-right font-medium">P&L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.symbol}
                  onClick={onSelect ? () => onSelect(r.symbol) : undefined}
                  className={cn(
                    'border-b border-hairline last:border-0',
                    onSelect && 'cursor-pointer hover:bg-hairline',
                  )}
                >
                  <td className="py-1 font-mono text-accent">{r.symbol}</td>
                  <td className="text-right font-mono">{r.quantity}</td>
                  <td className="text-right font-mono text-muted">{fmt(r.avgCost)}</td>
                  <td className="text-right font-mono">{fmt(r.marketValue)}</td>
                  <td className={cn('text-right font-mono', r.pnlPct >= 0 ? 'text-gain' : 'text-loss')}>
                    {fmtPct(r.pnlPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelBody>
    </Panel>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
