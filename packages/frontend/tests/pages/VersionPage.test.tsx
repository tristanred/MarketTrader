import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { VersionPage, compareBuilds } from '@/pages/VersionPage';

vi.mock('@/build-info', () => ({
  buildInfo: { version: '1.0.0', commit: 'aaaaaaa', buildTime: '2026-08-15T12:00:00.000Z' },
}));

vi.mock('@/api/version', () => ({ useServerVersion: vi.fn() }));

import { useServerVersion } from '@/api/version';

const mockedUseServerVersion = vi.mocked(useServerVersion);
const BROWSER = { version: '1.0.0', commit: 'aaaaaaa', buildTime: '2026-08-15T12:00:00.000Z' };

function renderPage(result: { data?: unknown; isError: boolean }) {
  mockedUseServerVersion.mockReturnValue(result as ReturnType<typeof useServerVersion>);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <VersionPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('compareBuilds', () => {
  it('matches on equal commits', () => {
    expect(compareBuilds(BROWSER, { ...BROWSER }, false)).toBe('match');
  });

  it('reports drift when the commits differ, even at the same version', () => {
    expect(compareBuilds(BROWSER, { ...BROWSER, commit: 'bbbbbbb' }, false)).toBe('drift');
  });

  it('treats a dev sentinel on either side as not comparable', () => {
    expect(compareBuilds(BROWSER, { ...BROWSER, commit: 'dev' }, false)).toBe('development');
    expect(compareBuilds({ ...BROWSER, version: '0.0.0-dev' }, BROWSER, false)).toBe('development');
  });

  it('reports the failure ahead of any comparison', () => {
    expect(compareBuilds(BROWSER, undefined, true)).toBe('unreachable');
    expect(compareBuilds(BROWSER, undefined, false)).toBe('pending');
  });
});

describe('VersionPage', () => {
  it('shows the browser build and confirms a match', () => {
    renderPage({ data: { ...BROWSER }, isError: false });

    const browser = within(screen.getByRole('region', { name: 'Browser' }));
    expect(browser.getByText('1.0.0')).toBeInTheDocument();
    expect(browser.getByText('aaaaaaa')).toBeInTheDocument();

    expect(screen.getByText(/running the same build/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reload/i })).not.toBeInTheDocument();
  });

  it('offers a reload when the browser bundle is behind', () => {
    renderPage({ data: { ...BROWSER, commit: 'bbbbbbb' }, isError: false });

    expect(screen.getByText(/older build/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  it('still reports the browser build when the server is unreachable', () => {
    renderPage({ data: undefined, isError: true });

    expect(screen.getByText(/did not respond/i)).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText('aaaaaaa')).toBeInTheDocument();
  });
});
