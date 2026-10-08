import { useMemo, useState } from 'react';
import type { DiscoverItem } from '@markettrader/shared';
import { byChangeDesc, heatStyle } from '@/lib/discover';
import { cn, formatPct, formatUSD } from '@/lib/utils';

export interface PicksHeatGridProps {
  items: DiscoverItem[];
  onSelect: (symbol: string) => void;
}

const ALL = '__all__';

/**
 * The daily picks as a market-map grid: one tile per stock, tinted by the
 * size and direction of its move, sorted biggest gain first. A row of sector
 * chips narrows the grid to one sector.
 */
export function PicksHeatGrid({ items, onSelect }: PicksHeatGridProps) {
  const [sector, setSector] = useState<string>(ALL);

  const sectors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (item.sector) counts.set(item.sector, (counts.get(item.sector) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);

  const visible = useMemo(
    () => items.filter((i) => sector === ALL || i.sector === sector).sort(byChangeDesc),
    [items, sector],
  );

  return (
    <div className="flex flex-col gap-3">
      {sectors.length > 1 ? (
        // One scrolling row on a phone: wrapped, the chips take four rows and push
        // the grid below the fold.
        <div
          role="group"
          aria-label="Filter by sector"
          className="-mx-2.5 flex gap-1.5 overflow-x-auto px-2.5 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
        >
          <SectorChip active={sector === ALL} onClick={() => setSector(ALL)}>
            All <Count>{items.length}</Count>
          </SectorChip>
          {sectors.map(([name, count]) => (
            <SectorChip key={name} active={sector === name} onClick={() => setSector(name)}>
              {name} <Count>{count}</Count>
            </SectorChip>
          ))}
        </div>
      ) : null}

      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {visible.map((item) => (
          <li key={item.symbol} className="min-w-0">
            <PickTile item={item} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PickTile({ item, onSelect }: { item: DiscoverItem; onSelect: (symbol: string) => void }) {
  const pct = item.changePct;
  const direction = pct === null ? null : pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return (
    <button
      type="button"
      onClick={() => onSelect(item.symbol)}
      style={heatStyle(pct)}
      aria-label={`${item.symbol}${item.name ? `, ${item.name}` : ''}${
        pct === null ? '' : `, ${direction} ${formatPct(Math.abs(pct)).replace('+', '')}`
      }. Open quote.`}
      className={cn(
        'flex h-full w-full flex-col gap-1 rounded-chip border border-hairline px-2.5 py-2 text-left',
        'hover:border-hairline-strong hover:brightness-110',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-text-strong">{item.symbol}</span>
        <span
          className={cn(
            'font-mono text-xs font-medium',
            pct === null
              ? 'text-muted'
              : pct > 0
                ? 'text-gain'
                : pct < 0
                  ? 'text-loss'
                  : 'text-muted',
          )}
        >
          {pct === null ? '—' : formatPct(pct)}
        </span>
      </span>
      <span className="truncate text-[11px] text-muted">{item.name ?? item.symbol}</span>
      <span className="font-mono text-xs text-text">
        {item.price === null ? '—' : formatUSD(item.price)}
      </span>
    </button>
  );
}

function SectorChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-chip border px-2 py-0.5 text-xs',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
        active
          ? 'border-accent bg-accent-bg text-accent'
          : 'border-hairline-strong text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return <span className="font-mono opacity-70">{children}</span>;
}
