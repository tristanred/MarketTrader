import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import type React from 'react';

const apiFetch = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

import { useGame } from '@/api/games';

const GAME = { id: 'g1', startDate: '2099-01-01T00:00:00.000Z', endDate: '2099-02-01T00:00:00.000Z' };

// The app's defaults matter here: `staleTime` is what would swallow a plain
// `refetchOnWindowFocus: true` for a player who returns moments after a fetch.
function renderGame() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useGame('g1'), { wrapper });
}

function returnToTab() {
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
}

describe('useGame when the player returns to the tab', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });
  afterEach(() => {
    focusManager.setFocused(undefined);
  });

  it('re-reads a pending game even when the data is fresh, so a started game unlocks at once', async () => {
    apiFetch.mockResolvedValueOnce({ ...GAME, status: 'pending' });
    apiFetch.mockResolvedValueOnce({ ...GAME, status: 'active' });
    const { result } = renderGame();
    await waitFor(() => expect(result.current.data?.status).toBe('pending'));

    returnToTab();

    await waitFor(() => expect(result.current.data?.status).toBe('active'));
  });

  it('does not re-read a running game', async () => {
    apiFetch.mockResolvedValue({ ...GAME, status: 'active' });
    const { result } = renderGame();
    await waitFor(() => expect(result.current.data?.status).toBe('active'));

    returnToTab();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
