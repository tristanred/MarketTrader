import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useStockSearch } from '@/api/stocks';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn } from '@/lib/utils';

export interface SymbolSearchProps {
  /** Called with the canonical (uppercase) symbol when a result is chosen. */
  onSelect: (symbol: string) => void;
  /** Input placeholder. */
  placeholder?: string;
  /** When true, renders a `⌘K` keyboard hint chip on the right. */
  hintKbd?: boolean;
  /** Auto-focus the input on mount (used by the overlay). */
  autoFocus?: boolean;
  /** Optional handler fired on input focus — used by panels that want to open an overlay. */
  onInputFocus?: () => void;
  /** Optional handler fired on input click. */
  onInputClick?: () => void;
  className?: string;
}

/**
 * Typeahead symbol search. Two consumers: {@link SymbolSearchOverlay}
 * (cmd+k modal) and the in-arena pinned panel (phase 3b). The component
 * itself doesn't decide what to do with the chosen symbol — that's
 * `onSelect`'s job.
 *
 * Keyboard model: typing brings up the result list with the first row
 * pre-highlighted; ArrowDown/ArrowUp move the highlight, Enter selects
 * the highlighted row. Mouse hover also moves the highlight so the two
 * input modes don't fight each other.
 */
export function SymbolSearch({
  onSelect,
  placeholder = 'Search symbol...',
  hintKbd = false,
  autoFocus = false,
  onInputFocus,
  onInputClick,
  className,
}: SymbolSearchProps) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim(), 250);
  const results = useStockSearch(debounced);
  const items = useMemo(() => results.data ?? [], [results.data]);
  const showList = debounced.length > 0;

  // Index of the currently-highlighted result. Reset to the first row
  // whenever the query changes so the user can hit Enter as soon as a
  // list lands without an extra ArrowDown. Keyed on `debounced` (not
  // `items`) so a re-render with the same query keeps the user's
  // arrow-key position even if the API hook returns a new array
  // reference on every poll.
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    setActiveIndex(0);
  }, [debounced]);

  const listRef = useRef<HTMLUListElement | null>(null);

  // Keep the highlighted row visible when arrow-keying off-screen in a
  // long result list. ScrollIntoView with block:'nearest' avoids the
  // page jump that block:'center' would cause. Guarded for jsdom, which
  // does not implement scrollIntoView on HTMLElement.
  useEffect(() => {
    if (!showList) return;
    const el = listRef.current?.querySelector<HTMLLIElement>(
      `[data-result-index="${activeIndex}"]`,
    );
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, showList]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList || items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const picked = items[activeIndex];
      if (picked) onSelect(picked.symbol.toUpperCase());
    }
  };

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
          onKeyDown={handleKeyDown}
          onFocus={onInputFocus}
          onClick={onInputClick}
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
        <ul
          ref={listRef}
          className="mt-1 max-h-72 overflow-y-auto rounded-chip border border-hairline-strong bg-panel"
        >
          {items.map((r, i) => (
            <li key={r.symbol} data-result-index={i}>
              <button
                type="button"
                onClick={() => onSelect(r.symbol.toUpperCase())}
                className={cn(
                  'flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-xs',
                  // Keyboard navigation owns the highlight: hover does not
                  // move `activeIndex` because the dropdown frequently
                  // renders under wherever the cursor was left, which
                  // would override the just-typed result and make Enter
                  // pick the wrong row. Hover still shows a soft tint.
                  i === activeIndex ? 'bg-hairline-strong' : 'hover:bg-hairline',
                )}
              >
                <span className="font-mono text-accent">{r.symbol}</span>
                <span className="text-muted">{r.name}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && !results.isLoading ? (
            <li className="px-2 py-1.5 text-xs text-muted">No matches.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
