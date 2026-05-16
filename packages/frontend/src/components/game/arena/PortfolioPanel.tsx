import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { cn } from '@/lib/utils';

export interface PortfolioPanelProps {
  value: number;
  pnlPct: number;
  cash: number;
  dayPnl: number;
  className?: string;
}

/** Left-column compact 2×2 stat grid: portfolio value / P&L / cash / day P&L. */
export function PortfolioPanel({ value, pnlPct, cash, dayPnl, className }: PortfolioPanelProps) {
  return (
    <Panel className={className}>
      <PanelHeader>Your portfolio</PanelHeader>
      <PanelBody>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Stat label="Value" value={formatUsd(value)} />
          <Stat label="P&L" value={formatPct(pnlPct)} tone={pnlPct >= 0 ? 'gain' : 'loss'} />
          <Stat label="Cash" value={formatUsd(cash)} dim />
          <Stat label="Day" value={formatDayPnl(dayPnl)} tone={dayPnl >= 0 ? 'gain' : 'loss'} />
        </div>
      </PanelBody>
    </Panel>
  );
}

function Stat({
  label,
  value,
  tone,
  dim,
}: {
  label: string;
  value: string;
  tone?: 'gain' | 'loss';
  dim?: boolean;
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.16em] text-muted">{label}</div>
      <div
        className={cn(
          'font-mono text-sm font-semibold',
          tone === 'gain' && 'text-gain',
          tone === 'loss' && 'text-loss',
          dim && 'text-muted',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
function formatPct(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
function formatDayPnl(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
