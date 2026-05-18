import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useCommandKStore } from '@/stores/commandKStore';
import type React from 'react';

vi.mock('@/api/stocks', () => ({
  useStockSearch: () => ({ data: [], isLoading: false, error: null }),
}));

import { SymbolSearchPanel } from '@/components/game/arena/SymbolSearchPanel';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

describe('SymbolSearchPanel', () => {
  beforeEach(() => {
    useCommandKStore.getState().close();
  });

  it('renders the search input with the ⌘K hint', () => {
    render(wrap(<SymbolSearchPanel onSelect={() => {}} />));
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByText('⌘K')).toBeInTheDocument();
  });

  it('opens the cmd+k overlay when the input is focused', async () => {
    const user = userEvent.setup();
    render(wrap(<SymbolSearchPanel onSelect={() => {}} />));
    await user.click(screen.getByRole('searchbox'));
    expect(useCommandKStore.getState().open).toBe(true);
  });

  it('opens the cmd+k overlay when the input is focused via keyboard tab', async () => {
    const user = userEvent.setup();
    render(wrap(<SymbolSearchPanel onSelect={() => {}} />));
    await user.tab();
    expect(screen.getByRole('searchbox')).toHaveFocus();
    expect(useCommandKStore.getState().open).toBe(true);
  });
});
