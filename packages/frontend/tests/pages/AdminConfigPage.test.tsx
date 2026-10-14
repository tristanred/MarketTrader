import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import type { AdminConfigEntry } from '@markettrader/shared';

function entry(over: Partial<AdminConfigEntry>): AdminConfigEntry {
  return {
    key: 'X', envVars: [over.key ?? 'X'], category: 'core', description: '', kind: 'integer',
    unit: null, options: null, min: null, max: null, mutability: 'restart', restartReason: 'r',
    secret: false, isSet: true, source: 'default', bootValue: 1, effectiveValue: 1, override: null,
    ...over,
  };
}

const entries: AdminConfigEntry[] = [
  entry({ key: 'PORT', category: 'core', bootValue: 3000, effectiveValue: 3000 }),
  entry({ key: 'JWT_SECRET', category: 'security', kind: 'string', secret: true, bootValue: null, effectiveValue: null }),
  entry({
    key: 'WATCHLIST_MAX_ITEMS', category: 'limits', mutability: 'live', restartReason: null, min: 1, max: 500,
    source: 'override', bootValue: 50, effectiveValue: 10,
    override: { value: 10, updatedAt: '2026-10-13T00:00:00.000Z', updatedBy: 'root' },
  }),
];

vi.mock('@/api/admin/config', () => ({
  useAdminConfig: () => ({ data: { entries }, isLoading: false, isError: false }),
  useAdminSetConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAdminResetConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { AdminConfigPage } from '@/pages/admin/AdminConfigPage';

describe('AdminConfigPage', () => {
  it('groups options by category and never shows a secret value', () => {
    render(<AdminConfigPage />);
    expect(screen.getByRole('heading', { name: 'Configuration' })).toBeInTheDocument();
    expect(screen.getByText('Core')).toBeInTheDocument();
    expect(screen.getByText('Security & auth')).toBeInTheDocument();
    expect(screen.getByText('Set (hidden)')).toBeInTheDocument();
  });

  it('counts active overrides in a banner', () => {
    render(<AdminConfigPage />);
    expect(screen.getByText(/1 runtime override active/)).toBeInTheDocument();
  });

  it('filters by key text and by live-only', async () => {
    render(<AdminConfigPage />);
    await userEvent.type(screen.getByPlaceholderText('Filter options…'), 'port');
    expect(screen.getByText('PORT')).toBeInTheDocument();
    expect(screen.queryByText('WATCHLIST_MAX_ITEMS')).toBeNull();

    await userEvent.clear(screen.getByPlaceholderText('Filter options…'));
    await userEvent.click(screen.getByLabelText('Live-editable only'));
    expect(screen.queryByText('PORT')).toBeNull();
    expect(screen.getByText('WATCHLIST_MAX_ITEMS')).toBeInTheDocument();
  });

  it('shows the bundle’s build-time variables', () => {
    render(<AdminConfigPage />);
    expect(screen.getByText('VITE_POSTHOG_HOST')).toBeInTheDocument();
  });
});
