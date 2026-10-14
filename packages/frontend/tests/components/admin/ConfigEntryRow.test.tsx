import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdminConfigEntry } from '@markettrader/shared';
import { ApiError } from '@/lib/api';
import { useToastStore } from '@/components/ui/toast';

const setMutate = vi.fn().mockResolvedValue({});
const resetMutate = vi.fn().mockResolvedValue({});

vi.mock('@/api/admin/config', () => ({
  useAdminSetConfig: () => ({ mutateAsync: setMutate, isPending: false }),
  useAdminResetConfig: () => ({ mutateAsync: resetMutate, isPending: false }),
}));

import { ConfigEntryRow } from '@/components/admin/ConfigEntryRow';

const live: AdminConfigEntry = {
  key: 'WATCHLIST_MAX_ITEMS', envVars: ['WATCHLIST_MAX_ITEMS'], category: 'limits',
  description: 'Symbols one watchlist may hold.', kind: 'integer', unit: null, options: null,
  min: 1, max: 500, mutability: 'live', restartReason: null, secret: false, isSet: true,
  source: 'default', bootValue: 50, effectiveValue: 50, override: null,
};

function renderRow(entry: AdminConfigEntry) {
  return render(
    <table>
      <tbody>
        <ConfigEntryRow entry={entry} />
      </tbody>
    </table>,
  );
}

describe('ConfigEntryRow', () => {
  beforeEach(() => {
    setMutate.mockClear();
    resetMutate.mockClear();
  });

  it('saves a typed integer for a live option', async () => {
    renderRow(live);
    const input = screen.getByLabelText('WATCHLIST_MAX_ITEMS value');
    await userEvent.clear(input);
    await userEvent.type(input, '75');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(setMutate).toHaveBeenCalledWith({ key: 'WATCHLIST_MAX_ITEMS', value: 75 });
  });

  it('disables Save for an out-of-range value', async () => {
    renderRow(live);
    const input = screen.getByLabelText('WATCHLIST_MAX_ITEMS value');
    await userEvent.clear(input);
    await userEvent.type(input, '9999');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Maximum 500')).toBeInTheDocument();
  });

  it('offers reset only when overridden, and shows the environment value', async () => {
    renderRow({
      ...live, source: 'override', effectiveValue: 10,
      override: { value: 10, updatedAt: '2026-10-13T12:00:00.000Z', updatedBy: 'root' },
    });
    expect(screen.getByText(/environment: 50/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reset to environment' }));
    expect(resetMutate).toHaveBeenCalledWith('WATCHLIST_MAX_ITEMS');
  });

  it('renders restart-only options read-only', () => {
    renderRow({ ...live, key: 'PORT', mutability: 'restart', restartReason: 'Bound once.' });
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByText('Restart required')).toHaveAttribute('title', 'Bound once.');
  });

  it('shows the server message for any 400 on save', async () => {
    setMutate.mockRejectedValueOnce(new ApiError(400, { message: 'body/value must be integer' }, 'Bad Request'));
    renderRow(live);
    const input = screen.getByLabelText('WATCHLIST_MAX_ITEMS value');
    await userEvent.clear(input);
    await userEvent.type(input, '75');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const last = useToastStore.getState().toasts.at(-1);
    expect(last).toMatchObject({ title: 'Invalid value', description: 'body/value must be integer' });
  });
});
