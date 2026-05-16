import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useStockSearch } from '@/api/stocks';
import { cn } from '@/lib/utils';

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

export interface SymbolSearchProps {
  /** Called with the canonical (uppercase) symbol when a result is chosen. */
  onSelect: (symbol: string) => void;
  /** Input placeholder. */
  placeholder?: string;
  /** When true, renders a `⌘K` keyboard hint chip on the right. */
  hintKbd?: boolean;
  /** Auto-focus the input on mount (used by the overlay). */
  autoFocus?: boolean;
  className?: string;
}

/**
 * Typeahead symbol search. Two consumers: {@link SymbolSearchOverlay}
 * (cmd+k modal) and the in-arena pinned panel (phase 3b). The component
 * itself doesn't decide what to do with the chosen symbol — that's
 * `onSelect`'s job.
 */
export function SymbolSearch({
  onSelect,
  placeholder = 'Search symbol...',
  hintKbd = false,
  autoFocus = false,
  className,
}: SymbolSearchProps) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim(), 250);
  const results = useStockSearch(debounced);
  const showList = debounced.length > 0;

  return (
    <div className={cn('w-full', className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted"
          aria-hidden
        />
        <input
          type="search"
          role="searchbox"
          aria-label="Symbol search"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 w-full rounded-chip border border-hairline-strong bg-panel pl-7 pr-12 font-mono text-xs text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          autoComplete="off"
        />
        {hintKbd ? (
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-chip border border-hairline-strong bg-bg px-1.5 py-0.5 font-mono text-[10px] text-muted">
            ⌘K
          </kbd>
        ) : null}
      </div>
      {showList ? (
        <ul className="mt-1 max-h-72 overflow-y-auto rounded-chip border border-hairline-strong bg-panel">
          {(results.data ?? []).map((r) => (
            <li key={r.symbol}>
              <button
                type="button"
                onClick={() => onSelect(r.symbol.toUpperCase())}
                className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-xs hover:bg-hairline"
              >
                <span className="font-mono text-accent">{r.symbol}</span>
                <span className="text-muted">{r.name}</span>
              </button>
            </li>
          ))}
          {(results.data?.length ?? 0) === 0 && !results.isLoading ? (
            <li className="px-2 py-1.5 text-xs text-muted">No matches.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
