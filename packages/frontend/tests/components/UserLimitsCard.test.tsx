import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AdminUserLimitsResponse } from '@markettrader/shared';

const data: AdminUserLimitsResponse = {
  userId: 'u1',
  mature: false,
  probationEndsAt: '2026-10-20T12:00:00.000Z',
  privilegedMultiplier: 10,
  rows: [
    {
      key: 'gamesCreated',
      label: 'Games created / week',
      kind: 'quota',
      configKey: 'LIMIT_GAMES_CREATED_PER_WEEK',
      baseValue: 10,
      effectiveMax: 3,
      basis: 'probation',
      override: null,
      used: 3,
      overridable: true,
    },
    {
      key: 'trades',
      label: 'Trades / min',
      kind: 'rate',
      configKey: 'LIMIT_TRADES_PER_MINUTE',
      baseValue: 60,
      effectiveMax: 120,
      basis: 'override',
      override: {
        value: 120,
        note: 'office bot',
        updatedBy: 'admin-id',
        updatedAt: '2026-10-14T00:00:00.000Z',
      },
      used: 4,
      overridable: true,
    },
    {
      key: 'registrationsPerIp',
      label: 'Registrations per IP / day',
      kind: 'ip',
      configKey: 'LIMIT_REGISTRATIONS_PER_IP_PER_DAY',
      baseValue: 5,
      effectiveMax: 5,
      basis: 'base',
      override: null,
      used: null,
      overridable: false,
    },
  ],
  registrationIp: '198.51.100.4',
  siblingAccounts: [{ id: 'u2', username: 'alt_account', createdAt: '2026-10-13T09:00:00.000Z' }],
  requestVolume7d: [{ route: 'POST /games', count: 42 }],
  denials7d: [{ limitKey: 'gamesCreated', count: 7, lastAt: '2026-10-14T08:00:00.000Z' }],
};

const setLimit = vi.fn();
const clearLimit = vi.fn();
vi.mock('@/api/admin/limits', () => ({
  useAdminUserLimits: () => ({ data, isLoading: false, isError: false }),
  useAdminSetUserLimit: () => ({ mutateAsync: setLimit, isPending: false }),
  useAdminClearUserLimit: () => ({ mutateAsync: clearLimit, isPending: false }),
}));

import { UserLimitsCard } from '@/components/admin/UserLimitsCard';

function renderCard() {
  const view = render(
    <MemoryRouter>
      <UserLimitsCard userId="u1" />
    </MemoryRouter>,
  );
  const row = (key: string) =>
    view.container.querySelector<HTMLElement>(`[data-limit-key="${key}"]`)!;
  return { ...view, row };
}

describe('UserLimitsCard', () => {
  beforeEach(() => {
    setLimit.mockReset().mockResolvedValue(undefined);
    clearLimit.mockReset().mockResolvedValue(undefined);
  });

  it('shows effective max, basis, and usage per limit', () => {
    const { row } = renderCard();
    expect(within(row('gamesCreated')).getByText('Probation')).toBeInTheDocument();
    expect(within(row('gamesCreated')).getByText('3 / 3')).toBeInTheDocument();
    expect(within(row('trades')).getByText('Override')).toBeInTheDocument();
    expect(within(row('trades')).getByText('office bot')).toBeInTheDocument();
    expect(within(row('registrationsPerIp')).getByText('Not overridable')).toBeInTheDocument();
    expect(screen.getByText(/On probation until/)).toBeInTheDocument();
  });

  it('saves an override with its note', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Override Games created / week' }));
    const input = screen.getByLabelText('Override value for Games created / week');
    await user.clear(input);
    await user.type(input, '4');
    await user.type(screen.getByLabelText('Override note for Games created / week'), 'colleague');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(setLimit).toHaveBeenCalledWith({
      userId: 'u1',
      key: 'gamesCreated',
      value: 4,
      note: 'colleague',
    });
  });

  it('refuses a non-positive override without calling the API', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Override Games created / week' }));
    const input = screen.getByLabelText('Override value for Games created / week');
    await user.clear(input);
    await user.type(input, '0');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(setLimit).not.toHaveBeenCalled();
    expect(screen.getByText('Whole number ≥ 1')).toBeInTheDocument();
  });

  it('clears an override after confirmation', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Clear override for Trades / min' }));
    await user.click(screen.getByRole('button', { name: 'Clear override' }));
    expect(clearLimit).toHaveBeenCalledWith({ userId: 'u1', key: 'trades' });
  });

  it('renders an override below current usage and a null usage without crashing', () => {
    data.rows[0] = { ...data.rows[0]!, effectiveMax: 2, used: 5, basis: 'override' };
    const { row } = renderCard();
    expect(within(row('gamesCreated')).getByText('5 / 2')).toBeInTheDocument();
    expect(within(row('registrationsPerIp')).getByText('—')).toBeInTheDocument();
  });

  it('lists accounts sharing the registration IP, request volume, and denials', () => {
    renderCard();
    expect(screen.getByText('198.51.100.4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'alt_account' })).toHaveAttribute(
      'href',
      '/admin/users/u2',
    );
    expect(screen.getByText('POST /games')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});
