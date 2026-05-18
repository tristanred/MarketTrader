import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';

type SymbolReader = string | null;
type SymbolWriter = (next: string | null) => void;

const ReaderContext = createContext<SymbolReader | undefined>(undefined);
const WriterContext = createContext<SymbolWriter | undefined>(undefined);

export interface SelectedSymbolProviderProps {
  initial?: string | null;
  children: ReactNode;
}

/**
 * Shared state for the currently-selected symbol in the arena's center
 * column. Reads and writes are split into two contexts so write-only
 * consumers (e.g. clickable symbol chips) don't re-render on every
 * selection change.
 */
export function SelectedSymbolProvider({ initial = null, children }: SelectedSymbolProviderProps) {
  const [symbol, setSymbol] = useState<SymbolReader>(initial ? initial.toUpperCase() : null);
  const set = useCallback<SymbolWriter>((next) => {
    setSymbol(next === null ? null : next.toUpperCase());
  }, []);
  return (
    <WriterContext.Provider value={set}>
      <ReaderContext.Provider value={symbol}>{children}</ReaderContext.Provider>
    </WriterContext.Provider>
  );
}

/** Returns the currently-selected symbol (uppercase) or `null`. */
export function useSelectedSymbol(): SymbolReader {
  const value = useContext(ReaderContext);
  if (value === undefined) {
    throw new Error('useSelectedSymbol must be used inside a SelectedSymbolProvider');
  }
  return value;
}

/** Returns a stable setter for the selected symbol. */
export function useSetSelectedSymbol(): SymbolWriter {
  const value = useContext(WriterContext);
  if (value === undefined) {
    throw new Error('useSetSelectedSymbol must be used inside a SelectedSymbolProvider');
  }
  return value;
}

/**
 * Returns the setter when called inside a SelectedSymbolProvider, or `null`
 * when called outside. Use this from components that live above the provider
 * in the tree (e.g. AppShell-level singletons) and need to update the
 * selected symbol when one happens to be available.
 */
export function useMaybeSetSelectedSymbol(): SymbolWriter | null {
  return useContext(WriterContext) ?? null;
}
