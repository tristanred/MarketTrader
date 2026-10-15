import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { LimitExceededBody } from '@markettrader/shared';

const apiFetch = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});
vi.mock('@/components/auth/AuthAtmospherePanel', () => ({ AuthAtmospherePanel: () => null }));

import { ApiError } from '@/lib/api';
import { RegisterPage } from '@/pages/RegisterPage';

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function submit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/username/i), 'newcomer');
  await user.type(screen.getByLabelText(/password/i), 'password123');
  await user.click(screen.getByRole('button', { name: /create account/i }));
}

describe('RegisterPage', () => {
  // Block body: a function returned from beforeEach runs as a cleanup hook,
  // and mockReset returns the mock itself.
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('says the network has hit its registration limit and when it lifts', async () => {
    const body: LimitExceededBody = {
      error: 'Account registration limit reached (5 per day from this network)',
      code: 'LIMIT_EXCEEDED',
      limit: 'registrationsPerIp',
      max: 5,
      probation: false,
      retryAfterSeconds: 7_200,
    };
    apiFetch.mockRejectedValue(new ApiError(429, body, '429 Too Many Requests'));
    renderPage();
    await submit();

    expect(
      await screen.findByText(
        'Account registration limit reached (5 per day from this network). You can try again in 2 hours.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Registration failed. Try again.')).not.toBeInTheDocument();
  });

  it('still reports a taken username', async () => {
    apiFetch.mockRejectedValue(
      new ApiError(409, { error: 'Username already taken' }, '409 Conflict'),
    );
    renderPage();
    await submit();
    expect(await screen.findByText('Username already taken')).toBeInTheDocument();
  });

  it('falls back to a generic message for other failures', async () => {
    apiFetch.mockRejectedValue(new ApiError(500, null, '500 Internal Server Error'));
    renderPage();
    await submit();
    expect(await screen.findByText('Registration failed. Try again.')).toBeInTheDocument();
  });
});
