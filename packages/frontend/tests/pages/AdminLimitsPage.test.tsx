import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type {
  AdminLimitOverrideEntry,
  AdminLimitPolicy,
  AdminTopConsumersResponse,
} from '@markettrader/shared';

const policy: AdminLimitPolicy = {
  enabled: true,
  maturityDays: 7,
  probationPercent: 25,
  privilegedCidrs: ['203.0.113.0/24'],
  privilegedMultiplier: 10,
  requestIp: '203.0.113.7',
  requestIpPrivileged: true,
};
const top: AdminTopConsumersResponse = {
  window: '24h',
  metric: 'requests',
  rows: [
    {
      subjectType: 'user',
      subjectId: 'u1',
      username: 'spammer',
      count: 9001,
      top: 'POST /games',
      sharedRegistrationIpCount: 3,
    },
    {
      subjectType: 'ip',
      subjectId: '198.51.100.9',
      username: null,
      count: 120,
      top: 'GET /stocks/search',
      sharedRegistrationIpCount: 0,
    },
  ],
};
const overrides: AdminLimitOverrideEntry[] = [
  {
    userId: 'u7',
    username: 'colleague',
    key: 'gamesCreated',
    value: 30,
    note: 'runs the office league',
    updatedBy: 'a1',
    updatedByUsername: 'root',
    updatedAt: '2026-10-14T00:00:00.000Z',
  },
];

const useAdminTopConsumers = vi.fn();
const clearLimit = vi.fn();
vi.mock('@/api/admin/limits', () => ({
  useAdminLimitPolicy: () => ({ data: policy, isLoading: false, isError: false }),
  useAdminTopConsumers: (...args: unknown[]) => useAdminTopConsumers(...args),
  useAdminLimitOverrides: () => ({ data: overrides, isLoading: false, isError: false }),
  useAdminClearUserLimit: () => ({ mutateAsync: clearLimit, isPending: false }),
}));

import { AdminLimitsPage } from '@/pages/admin/AdminLimitsPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminLimitsPage />
    </MemoryRouter>,
  );
}

describe('AdminLimitsPage', () => {
  beforeEach(() => {
    useAdminTopConsumers
      .mockReset()
      .mockReturnValue({ data: top, isLoading: false, isError: false });
    clearLimit.mockReset().mockResolvedValue(undefined);
  });

  it('lists top consumers with a shared-IP warning', () => {
    renderPage();
    const table = screen.getByRole('table', { name: 'Top consumers' });
    expect(within(table).getByRole('link', { name: 'spammer' })).toHaveAttribute(
      'href',
      '/admin/users/u1',
    );
    expect(within(table).getByText('9001')).toBeInTheDocument();
    expect(within(table).getByText('⚠ 3 shared IP')).toBeInTheDocument();
    expect(within(table).getByText('198.51.100.9')).toBeInTheDocument();
  });

  it('re-queries when the metric and window toggles change', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(useAdminTopConsumers).toHaveBeenLastCalledWith('24h', 'requests');
    await user.click(screen.getByRole('button', { name: 'Denials' }));
    expect(useAdminTopConsumers).toHaveBeenLastCalledWith('24h', 'denials');
    await user.click(screen.getByRole('button', { name: '7 days' }));
    expect(useAdminTopConsumers).toHaveBeenLastCalledWith('7d', 'denials');
  });

  it('clears an override after confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    const table = screen.getByRole('table', { name: 'Active overrides' });
    expect(within(table).getByText('Games created / week')).toBeInTheDocument();
    expect(within(table).getByText('runs the office league')).toBeInTheDocument();
    await user.click(
      within(table).getByRole('button', {
        name: 'Clear override for colleague Games created / week',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Clear override' }));
    expect(clearLimit).toHaveBeenCalledWith({ userId: 'u7', key: 'gamesCreated' });
  });

  it('summarises the policy, shows the caller IP, and links to the config editor', () => {
    renderPage();
    expect(screen.getByText('203.0.113.0/24')).toBeInTheDocument();
    expect(screen.getByText('25% of each per-user limit, except live connections')).toBeInTheDocument();
    expect(screen.getByText(/privileged ✓/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Edit in Configuration/ })).toHaveAttribute(
      'href',
      '/admin/config',
    );
  });
});
