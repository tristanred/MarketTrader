import { useEffect, useState } from 'react';

/**
 * Returns `value` after it has been stable for `delayMs`. Useful for
 * debouncing query inputs so we don't fire a search per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}
