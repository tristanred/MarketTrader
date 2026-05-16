import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';

const tapeData = { symbols: ['AAPL', 'MSFT'], updatedAt: '2026-05-15T14:00:00Z' };
const mutateAsync = vi.fn().mockResolvedValue({
  symbols: ['AAPL', 'MSFT', 'NVDA'],
  updatedAt: '2026-05-15T14:01:00Z',
});

vi.mock('@/api/admin/system', () => ({
  useAdminTickerTape: () => ({ data: tapeData, isLoading: false }),
  useAdminUpdateTickerTape: () => ({ mutateAsync, isPending: false }),
}));

import { TickerTapeEditor } from '@/components/admin/TickerTapeEditor';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('TickerTapeEditor', () => {
  it('renders the current symbols as removable chips', () => {
    render(wrap(<TickerTapeEditor />));
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('MSFT')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /remove/i })).toHaveLength(2);
  });

  it('adds a typed symbol to the working list', async () => {
    const user = userEvent.setup();
    render(wrap(<TickerTapeEditor />));
    const input = screen.getByLabelText(/add symbol/i);
    await user.type(input, 'NVDA');
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(screen.getByText('NVDA')).toBeInTheDocument();
  });

  it('uppercases input on add', async () => {
    const user = userEvent.setup();
    render(wrap(<TickerTapeEditor />));
    const input = screen.getByLabelText(/add symbol/i);
    await user.type(input, 'tsla');
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(screen.getByText('TSLA')).toBeInTheDocument();
  });

  it('removes a symbol when its remove button is clicked', async () => {
    const user = userEvent.setup();
    render(wrap(<TickerTapeEditor />));
    expect(screen.getByText('MSFT')).toBeInTheDocument();
    const msftRemove = screen.getAllByRole('button', { name: /remove/i })[1]!;
    await user.click(msftRemove);
    expect(screen.queryByText('MSFT')).toBeNull();
  });

  it('submits the working list on Save', async () => {
    const user = userEvent.setup();
    render(wrap(<TickerTapeEditor />));
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ symbols: ['AAPL', 'MSFT'] });
    });
  });

  it('disables Save when the working list is empty', async () => {
    const user = userEvent.setup();
    render(wrap(<TickerTapeEditor />));
    const removeBtns = screen.getAllByRole('button', { name: /remove/i });
    await user.click(removeBtns[0]!);
    await user.click(screen.getAllByRole('button', { name: /remove/i })[0]!);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });
});
