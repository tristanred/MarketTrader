import { cn } from '@/lib/utils';

export interface OhlcStripProps {
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  className?: string;
}

/**
 * Compact mono strip below the chart showing open/high/low/volume for
 * the currently-selected symbol. Renders dashes for any field whose
 * value is undefined (e.g. loading state).
 */
export function OhlcStrip({ open, high, low, volume, className }: OhlcStripProps) {
  return (
    <div className={cn('flex gap-4 px-2.5 py-1.5 font-mono text-[10px] text-muted', className)}>
      <Item label="O" value={fmt(open)} />
      <Item label="H" value={fmt(high)} />
      <Item label="L" value={fmt(low)} />
      <Item label="V" value={fmtVolume(volume)} />
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-muted">{label}</span>{' '}
      <span className="text-text">{value}</span>
    </span>
  );
}

function fmt(n?: number): string {
  if (n === undefined) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtVolume(n?: number): string {
  if (n === undefined) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
