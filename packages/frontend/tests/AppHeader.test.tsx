import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppHeader } from '@/components/AppHeader';
import { useAuthStore } from '@/stores/authStore';
import type React from 'react';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AppHeader', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: 'tok',
      user: { id: 'u1', username: 'tristan', groups: [] },
    });
  });

  it('renders the brand mark and primary nav', () => {
    render(wrap(<AppHeader />));
    expect(screen.getByText(/MarketTrader/i)).toBeInTheDocument();
    expect(screen.getByText('Games')).toBeInTheDocument();
  });

  it('shows the admin link when the user is admin', () => {
    useAuthStore.setState({
      token: 'tok',
      user: { id: 'u1', username: 'tristan', groups: ['admin'] },
    });
    render(wrap(<AppHeader />));
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('hides the admin link for non-admin users', () => {
    render(wrap(<AppHeader />));
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('renders the username and a sign out button', () => {
    render(wrap(<AppHeader />));
    expect(screen.getByText('tristan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('renders a theme toggle button', () => {
    render(wrap(<AppHeader />));
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument();
  });
});
