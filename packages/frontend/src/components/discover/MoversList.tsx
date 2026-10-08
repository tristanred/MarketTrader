import type { DiscoverItem } from '@markettrader/shared';
import { Panel, PanelBody, PanelHeader } from '@/components/panel';
import { cn, formatPct, formatUSD } from '@/lib/utils';

export interface MoversListProps {
  title: string;
  items: DiscoverItem[];
  onSelect: (symbol: string) => void;
}

/** One market-movers list (top gainers, most active, …) as a compact ranked panel. */
export function MoversList({ title, items, onSelect }: MoversListProps) {
  return (
    <Panel>
      <PanelHeader>{title}</PanelHeader>
      <PanelBody className="px-1.5 py-1">
        <ol aria-label={title}>
          {items.map((item, i) => (
            <li key={item.symbol}>
              <button
                type="button"
                onClick={() => onSelect(item.symbol)}
                className={cn(
                  'grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-chip px-1 py-1.5 text-left',
                  'hover:bg-hairline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                )}
              >
                <span className="font-mono text-[10px] text-muted">{i + 1}</span>
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-xs font-semibold text-accent">{item.symbol}</span>
                  <span className="truncate text-[11px] text-muted">{item.name}</span>
                </span>
                <span className="flex items-baseline gap-2 font-mono text-xs">
                  <span className="hidden text-text sm:inline">
                    {item.price === null ? '—' : formatUSD(item.price)}
                  </span>
                  <span
                    className={cn(
                      'w-14 text-right',
                      item.changePct === null || item.changePct === 0
                        ? 'text-muted'
                        : item.changePct > 0
                          ? 'text-gain'
                          : 'text-loss',
                    )}
                  >
                    {item.changePct === null ? '—' : formatPct(item.changePct)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </PanelBody>
    </Panel>
  );
}
