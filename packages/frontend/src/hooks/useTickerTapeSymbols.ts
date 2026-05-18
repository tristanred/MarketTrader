import { useTickerTapeSettings } from '@/api/systemSettings';

/** Convenience hook returning just the symbols array (or `[]` while loading). */
export function useTickerTapeSymbols(): string[] {
  const q = useTickerTapeSettings();
  return q.data?.symbols ?? [];
}
