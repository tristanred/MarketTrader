# Phase 5 — Games List + Auth Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the games list page (current ShadCN Card+Table) and the login/register pages (current centered Card on plain background) to match the terminal aesthetic established in phases 1–4 — without changing routes, auth flow, or data fetching.

**Architecture:** Three pages get rewritten in place using existing phase-1 design tokens (`bg-bg`, `text-text`, `text-accent`, `font-mono`, etc.) and panel chrome where appropriate. Games list becomes row cards; auth pages get a 60/40 split layout with a decorative ticker-tape atmosphere panel on the left and the form panel on the right. The atmosphere panel uses faux data so first-impression is fast and offline-capable. No new server endpoints, no shared-types changes.

**Tech Stack:** React 19, Tailwind 3.4 (phase-1 tokens), React Query 5, Vitest + React Testing Library.

**Spec reference:** `docs/superpowers/specs/2026-05-15-terminal-design-refresh.md` §4.1 (Games list), §4.3 (Login/Register).

**Branch & commit cadence:** Work happens on `feat/phase-5-list-and-auth` (already created from `new-ui`). Each task ends with a focused commit. Merge into `new-ui` after Task 7.

---

## Task 0: Confirm branch state

- [ ] **Step 1: Verify current branch and clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status --short
```

Expected: branch is `feat/phase-5-list-and-auth`, status is clean.

- [ ] **Step 2: Verify phase 1 deliverables present**

```bash
ls packages/frontend/src/components/panel/
ls packages/frontend/src/lib/gameDay.ts
```

Expected: panel barrel + getDayCounter exist.

---

## File Structure

**Modified (frontend):**
- `packages/frontend/src/pages/GamesListPage.tsx` — rewritten to row-card layout.
- `packages/frontend/src/pages/LoginPage.tsx` — rewritten to split-layout.
- `packages/frontend/src/pages/RegisterPage.tsx` — rewritten to split-layout.
- `packages/frontend/src/components/CreateGameDialog.tsx` — only the trigger button restyled; the dialog itself keeps existing ShadCN chrome (it's transient + already works).
- `packages/frontend/tests/App.test.tsx` — adjust assertion text if the rewrites change heading copy. (The current test only asserts "Sign in" / "Create account" headings — both kept verbatim.)

**Created (frontend):**
- `packages/frontend/src/components/auth/AuthAtmospherePanel.tsx` — decorative left panel (faux leaderboard + faux ticker tape) shared by Login + Register.
- `packages/frontend/tests/AuthAtmospherePanel.test.tsx` — basic render tests.
- `packages/frontend/tests/GamesListPage.test.tsx` — high-level page test (loading / empty / row-card render / link nav).

**Untouched:**
- `packages/frontend/src/components/CreateGameDialog.tsx` body — dialog content stays as-is.
- All API hooks (`useGames`, `useLogin`, `useRegister`) — unchanged signatures.
- `packages/frontend/src/pages/SymbolPage.tsx` — already restyled in phase 3.

---

## Shared Conventions

- Every page uses phase-1 tokens: `bg-bg`, `text-text`, `text-text-strong`, `text-muted`, `text-accent`, `border-hairline-strong`, `font-mono`.
- Status pills use mono caps with `text-[10px] tracking-[0.14em]`.
- P&L colors are `text-gain` / `text-loss`; never accent.
- The atmosphere panel uses hardcoded faux data (no API calls) — render speed matters on first paint, and offline must work.

---

## Task 1: `AuthAtmospherePanel` component

**Files:**
- Create: `packages/frontend/src/components/auth/AuthAtmospherePanel.tsx`
- Create: `packages/frontend/tests/AuthAtmospherePanel.test.tsx`

The panel renders a faux leaderboard (3 rows) and a faux ticker tape with no live data — purely atmosphere. Renders the brand mark at the top.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AuthAtmospherePanel } from '@/components/auth/AuthAtmospherePanel';

describe('AuthAtmospherePanel', () => {
  it('renders the brand mark "MarketTrader"', () => {
    render(<AuthAtmospherePanel />);
    expect(screen.getByText('MarketTrader')).toBeInTheDocument();
  });

  it('renders at least three faux leaderboard rows', () => {
    render(<AuthAtmospherePanel />);
    expect(screen.getByText(/tristan/i)).toBeInTheDocument();
    expect(screen.getByText(/marcus/i)).toBeInTheDocument();
    expect(screen.getByText(/jules/i)).toBeInTheDocument();
  });

  it('renders a faux ticker strip with an index symbol', () => {
    render(<AuthAtmospherePanel />);
    expect(screen.getByText('^GSPC')).toBeInTheDocument();
  });

  it('marks the whole panel as decorative via aria-hidden', () => {
    const { container } = render(<AuthAtmospherePanel />);
    // The whole atmosphere section is decorative — screen readers don't
    // need to announce the faux numbers.
    const root = container.firstElementChild;
    expect(root?.getAttribute('aria-hidden')).toBe('true');
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- AuthAtmospherePanel
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/frontend/src/components/auth/AuthAtmospherePanel.tsx`:

```tsx
import { cn } from '@/lib/utils';

const FAUX_LEADERBOARD = [
  { rank: 1, name: 'tristan', value: '$128,430', pnl: '+28.43%', positive: true },
  { rank: 2, name: 'marcus', value: '$118,902', pnl: '+18.90%', positive: true },
  { rank: 3, name: 'jules', value: '$96,210', pnl: '−3.79%', positive: false },
  { rank: 4, name: 'ari', value: '$94,012', pnl: '−5.99%', positive: false },
];

const FAUX_TICKER = [
  { symbol: '^GSPC', last: '5,284.12', pct: '+0.32%', positive: true },
  { symbol: '^IXIC', last: '16,742.39', pct: '+0.51%', positive: true },
  { symbol: 'AAPL', last: '189.42', pct: '+0.84%', positive: true },
  { symbol: 'TSLA', last: '241.05', pct: '−1.12%', positive: false },
  { symbol: 'NVDA', last: '1,178.30', pct: '+2.41%', positive: true },
];

/**
 * Decorative side panel for the Login + Register pages. Renders a faux
 * leaderboard and faux ticker strip at low opacity to set the terminal
 * mood without distracting from the form. Pure presentation — no API
 * calls, no live data.
 */
export function AuthAtmospherePanel({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative hidden h-full flex-col justify-between overflow-hidden border-r border-hairline-strong bg-bg p-8 lg:flex',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm font-bold tracking-[-0.02em] text-text-strong">
        <span className="inline-block h-2 w-2 rounded-[2px] bg-accent" />
        MarketTrader
      </div>

      <div className="opacity-25">
        <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted">Leaderboard</div>
        <ul className="space-y-1.5">
          {FAUX_LEADERBOARD.map((row) => (
            <li
              key={row.rank}
              className="grid grid-cols-[28px_1fr_auto_auto] items-baseline gap-3 text-xs"
            >
              <span className="font-mono text-[10px] text-muted">
                {String(row.rank).padStart(2, '0')}
              </span>
              <span className="text-text">{row.name}</span>
              <span className="font-mono text-text">{row.value}</span>
              <span className={cn('font-mono', row.positive ? 'text-gain' : 'text-loss')}>
                {row.pnl}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="opacity-25">
        <div className="flex h-6 items-center gap-6 overflow-hidden whitespace-nowrap border-t border-hairline-strong pt-2 font-mono text-[11px]">
          {FAUX_TICKER.map((t) => (
            <span key={t.symbol} className="flex items-baseline gap-1">
              <span className="text-text">{t.symbol}</span>
              <span className="text-muted">{t.last}</span>
              <span className={t.positive ? 'text-gain' : 'text-loss'}>{t.pct}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- AuthAtmospherePanel
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/auth/AuthAtmospherePanel.tsx packages/frontend/tests/AuthAtmospherePanel.test.tsx
git commit -m "feat(frontend): AuthAtmospherePanel decorative side panel

Hard-coded faux leaderboard + ticker strip at 25% opacity — purely
atmosphere so the first paint of login/register pages reads as a
trading app even before any data loads. aria-hidden because the
content is non-informative."
```

---

## Task 2: Rewrite `LoginPage`

**Files:**
- Modify: `packages/frontend/src/pages/LoginPage.tsx`

Replace the centered Card with a 60/40 split (atmosphere panel on the left at `≥lg`, form panel on the right). Below `lg`, the atmosphere panel hides via its own `hidden lg:flex` classes and the form takes the full viewport.

- [ ] **Step 1: Read the current `LoginPage`**

```bash
cat packages/frontend/src/pages/LoginPage.tsx
```

Confirm the form's existing data flow (react-hook-form + zod + `useLogin`). The rewrite preserves all of that.

- [ ] **Step 2: Rewrite the page**

Replace `packages/frontend/src/pages/LoginPage.tsx` entirely:

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useLogin } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthAtmospherePanel } from '@/components/auth/AuthAtmospherePanel';
import { ApiError } from '@/lib/api';

const schema = z.object({
  username: z.string().min(1, 'Required'),
  password: z.string().min(1, 'Required'),
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const login = useLogin();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      navigate('/');
    } catch {
      // surfaced below
    }
  });

  const errorMessage =
    login.error instanceof ApiError && login.error.status === 401
      ? 'Invalid username or password'
      : login.error
        ? 'Login failed. Try again.'
        : null;

  return (
    <main className="grid min-h-screen bg-bg text-text lg:grid-cols-[3fr_2fr]">
      <AuthAtmospherePanel />
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-[-0.02em] text-text-strong">Sign in</h1>
            <p className="text-xs text-muted">Tournaments at real prices.</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="username" className="text-xs uppercase tracking-[0.14em] text-muted">
                Username
              </Label>
              <Input
                id="username"
                autoComplete="username"
                className="font-mono"
                {...form.register('username')}
              />
              {form.formState.errors.username && (
                <p className="text-xs text-loss">{form.formState.errors.username.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="password" className="text-xs uppercase tracking-[0.14em] text-muted">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                className="font-mono"
                {...form.register('password')}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-loss">{form.formState.errors.password.message}</p>
              )}
            </div>
            {errorMessage && <p className="text-sm text-loss">{errorMessage}</p>}
            <Button type="submit" className="w-full font-mono uppercase tracking-[0.1em]" disabled={login.isPending}>
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="text-xs text-muted">
            No account?{' '}
            <Link to="/register" className="text-accent hover:underline">
              Register
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify existing tests still pass**

The existing `App.test.tsx` asserts `screen.getByRole('heading', { name: /sign in/i })` — the new page still renders `<h1>Sign in</h1>` so the assertion holds.

```bash
pnpm --filter @markettrader/frontend test
pnpm --filter @markettrader/frontend typecheck
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/LoginPage.tsx
git commit -m "feat(frontend): LoginPage split-layout with atmosphere panel

60/40 grid at lg+, single-column at <lg. Form preserved verbatim
(react-hook-form + zod + useLogin). Labels are uppercase mono caps
matching the terminal aesthetic; password input is mono."
```

---

## Task 3: Rewrite `RegisterPage`

**Files:**
- Modify: `packages/frontend/src/pages/RegisterPage.tsx`

Same split-layout, slightly different copy. Keep the form's existing validation (username 3-30, password ≥8).

- [ ] **Step 1: Read the current page**

```bash
cat packages/frontend/src/pages/RegisterPage.tsx
```

Note the existing username/password validation rules — those are preserved.

- [ ] **Step 2: Rewrite the page**

Replace `packages/frontend/src/pages/RegisterPage.tsx` entirely:

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useRegister } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthAtmospherePanel } from '@/components/auth/AuthAtmospherePanel';
import { ApiError } from '@/lib/api';

const schema = z.object({
  username: z.string().min(3, '3-30 characters').max(30, '3-30 characters'),
  password: z.string().min(8, 'Minimum 8 characters'),
});

type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const register = useRegister();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await register.mutateAsync(values);
      navigate('/');
    } catch {
      // surfaced below
    }
  });

  const errorMessage =
    register.error instanceof ApiError && register.error.status === 409
      ? 'Username already taken'
      : register.error
        ? 'Registration failed. Try again.'
        : null;

  return (
    <main className="grid min-h-screen bg-bg text-text lg:grid-cols-[3fr_2fr]">
      <AuthAtmospherePanel />
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-[-0.02em] text-text-strong">Create account</h1>
            <p className="text-xs text-muted">First registrant becomes admin.</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="username" className="text-xs uppercase tracking-[0.14em] text-muted">
                Username
              </Label>
              <Input
                id="username"
                autoComplete="username"
                className="font-mono"
                {...form.register('username')}
              />
              {form.formState.errors.username && (
                <p className="text-xs text-loss">{form.formState.errors.username.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="password" className="text-xs uppercase tracking-[0.14em] text-muted">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                className="font-mono"
                {...form.register('password')}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-loss">{form.formState.errors.password.message}</p>
              )}
            </div>
            {errorMessage && <p className="text-sm text-loss">{errorMessage}</p>}
            <Button
              type="submit"
              className="w-full font-mono uppercase tracking-[0.1em]"
              disabled={register.isPending}
            >
              {register.isPending ? 'Creating…' : 'Create account'}
            </Button>
          </form>
          <p className="text-xs text-muted">
            Already have an account?{' '}
            <Link to="/login" className="text-accent hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
pnpm --filter @markettrader/frontend test
pnpm --filter @markettrader/frontend typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/RegisterPage.tsx
git commit -m "feat(frontend): RegisterPage split-layout with atmosphere panel

Mirrors LoginPage. Form validation unchanged (3-30 char username,
≥8 char password). Subtitle 'First registrant becomes admin.' reflects
the existing bootstrap-admin behavior in the auth service."
```

---

## Task 4: `GamesListPage` — write the failing test

**Files:**
- Create: `packages/frontend/tests/GamesListPage.test.tsx`

- [ ] **Step 1: Write the test**

Create `packages/frontend/tests/GamesListPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';

const gamesData: Array<{
  id: string;
  name: string;
  status: 'pending' | 'active' | 'ended';
  startingBalance: number;
  startDate: string;
  endDate: string;
}> = [];

vi.mock('@/api/games', () => ({
  useGames: () => ({ data: gamesData, isLoading: false, isError: false }),
}));

vi.mock('@/components/CreateGameDialog', () => ({
  CreateGameDialog: () => <button>+ NEW GAME</button>,
}));

import { GamesListPage } from '@/pages/GamesListPage';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('GamesListPage', () => {
  it('renders the page heading and the new-game action', () => {
    gamesData.length = 0;
    render(wrap(<GamesListPage />));
    expect(screen.getByText('Your games')).toBeInTheDocument();
    expect(screen.getByText(/new game/i)).toBeInTheDocument();
  });

  it('renders an empty state when there are no games', () => {
    gamesData.length = 0;
    render(wrap(<GamesListPage />));
    expect(screen.getByText(/no games yet/i)).toBeInTheDocument();
  });

  it('renders one row-card per game with name + status', () => {
    gamesData.length = 0;
    gamesData.push(
      {
        id: 'g1',
        name: 'Friday Night Bloodbath',
        status: 'active',
        startingBalance: 100000,
        startDate: '2026-05-12T00:00:00Z',
        endDate: '2026-05-25T23:59:59Z',
      },
      {
        id: 'g2',
        name: 'May Weekly Cup',
        status: 'ended',
        startingBalance: 50000,
        startDate: '2026-04-01T00:00:00Z',
        endDate: '2026-04-30T00:00:00Z',
      },
    );
    render(wrap(<GamesListPage />));
    expect(screen.getByText('Friday Night Bloodbath')).toBeInTheDocument();
    expect(screen.getByText('May Weekly Cup')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('ENDED')).toBeInTheDocument();
  });

  it('links each row to /games/:id', () => {
    gamesData.length = 0;
    gamesData.push({
      id: 'g1',
      name: 'Friday Night Bloodbath',
      status: 'active',
      startingBalance: 100000,
      startDate: '2026-05-12T00:00:00Z',
      endDate: '2026-05-25T23:59:59Z',
    });
    render(wrap(<GamesListPage />));
    const link = screen.getByRole('link', { name: /friday night bloodbath/i });
    expect(link).toHaveAttribute('href', '/games/g1');
  });
});
```

- [ ] **Step 2: Verify FAIL or PASS**

```bash
pnpm --filter @markettrader/frontend test -- GamesListPage
```

Expected: some tests fail (current page renders a Table, not row cards; the status is rendered as lowercase). Note the outcome — the rewrite in Task 5 makes them all pass.

---

## Task 5: Rewrite `GamesListPage`

**Files:**
- Modify: `packages/frontend/src/pages/GamesListPage.tsx`

Replace the Table-in-a-Card with row cards. Each row is a clickable link styled to match the new aesthetic: panel chrome on hover, mono game name + meta line, status pill in uppercase mono, three stat cells (Starting Balance / Start / End), chevron.

- [ ] **Step 1: Replace the page**

```tsx
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useGames } from '@/api/games';
import { CreateGameDialog } from '@/components/CreateGameDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Panel, PanelBody } from '@/components/panel';
import { cn, formatUSD } from '@/lib/utils';
import type { GameStatus } from '@markettrader/shared';

const statusPill: Record<GameStatus, string> = {
  pending: 'bg-hairline text-muted',
  active: 'bg-accent-bg text-accent',
  ended: 'bg-hairline text-muted',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function GamesListPage() {
  const games = useGames();

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-[-0.025em] text-text-strong">Your games</h1>
          <p className="text-xs text-muted">Tournaments you've joined.</p>
        </div>
        <CreateGameDialog />
      </div>

      {games.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {games.isError && (
        <Panel>
          <PanelBody>
            <p className="text-xs text-loss">Couldn't load games. Try again.</p>
          </PanelBody>
        </Panel>
      )}

      {games.data && games.data.length === 0 && (
        <Panel>
          <PanelBody>
            <p className="py-8 text-center font-mono text-xs text-muted">
              No games yet — create one to get started.
            </p>
          </PanelBody>
        </Panel>
      )}

      {games.data && games.data.length > 0 && (
        <ul className="space-y-2">
          {games.data.map((g) => (
            <li key={g.id}>
              <Link
                to={`/games/${g.id}`}
                className="block rounded-panel border border-hairline-strong bg-panel transition-colors hover:border-muted"
              >
                <div className="grid grid-cols-1 items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_auto_auto_auto_auto_auto]">
                  <div>
                    <div className="text-sm font-semibold text-text-strong">{g.name}</div>
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                      {formatDate(g.startDate)} → {formatDate(g.endDate)}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'rounded-chip px-2 py-0.5 font-mono text-[10px] tracking-[0.14em]',
                      statusPill[g.status],
                    )}
                  >
                    {g.status.toUpperCase()}
                  </span>
                  <StatCell label="Starting" value={formatUSD(g.startingBalance)} />
                  <StatCell label="Start" value={formatDate(g.startDate)} />
                  <StatCell label="End" value={formatDate(g.endDate)} />
                  <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden text-right sm:block">
      <div className="text-[9px] uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className="font-mono text-xs text-text">{value}</div>
    </div>
  );
}
```

Note: `formatUSD` from `@/lib/utils` returns a string with `$` prefix already, so we use it directly. The stat cells hide on narrow viewports — at `<sm` the row collapses to name + status + chevron.

- [ ] **Step 2: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- GamesListPage
```

Expected: 4 tests pass.

- [ ] **Step 3: Full frontend suite + typecheck + lint**

```bash
pnpm --filter @markettrader/frontend test
pnpm --filter @markettrader/frontend typecheck
pnpm --filter @markettrader/frontend lint
```

All PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/GamesListPage.tsx packages/frontend/tests/GamesListPage.test.tsx
git commit -m "feat(frontend): GamesListPage row-card layout

Replaces the Card+Table with clickable row cards using panel chrome.
Status renders as a mono uppercase pill (ACTIVE / PENDING / ENDED);
each row links to /games/:id; empty + error states use Panel chrome.
Stat cells (Starting / Start / End) hide on narrow viewports."
```

---

## Task 6: Restyle the CreateGameDialog trigger

**Files:**
- Modify: `packages/frontend/src/components/CreateGameDialog.tsx`

Only the trigger button needs a touch-up to read as "+ NEW GAME" with mono uppercase styling matching the page header. The dialog body itself isn't on the terminal-aesthetic path — leave the dialog content alone.

- [ ] **Step 1: Read the current dialog**

```bash
cat packages/frontend/src/components/CreateGameDialog.tsx
```

Find the trigger button (typically a `<Button>` wrapped in `<DialogTrigger asChild>`). Note its current label and styling.

- [ ] **Step 2: Update the trigger label + styling**

Edit the trigger button. The label becomes `+ NEW GAME` and styling adds `font-mono uppercase tracking-[0.1em]`. Example edit:

```tsx
// Find:
<Button>Create game</Button>
// Replace with:
<Button className="font-mono uppercase tracking-[0.1em]">+ New game</Button>
```

If the existing trigger uses different code (different prop names or wrapper), preserve that shape and only touch the label + className. Leave everything inside the `<DialogContent>` alone.

- [ ] **Step 3: Verify tests still pass**

```bash
pnpm --filter @markettrader/frontend test
```

Existing test setups that simulate clicking "Create game" may now need to match `+ New game` instead. If any test fails because of the label change, update the matcher accordingly — that's the only legitimate test breakage from this task.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/CreateGameDialog.tsx
git commit -m "feat(frontend): CreateGameDialog trigger styling

Trigger renamed to '+ New game' with mono caps so it matches the
games-list page header. Dialog body unchanged."
```

---

## Task 7: Full-suite verification

- [ ] **Step 1: Run everything**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm --filter @markettrader/frontend build
```

Expected: all PASS. Frontend tests grow by 4 (AuthAtmospherePanel) + 4 (GamesListPage) = 8 → 145. Server tests unchanged at 246.

- [ ] **Step 2: Manual smoke check (optional, if dev server is permitted)**

```bash
pnpm dev
```

Visit `/login` and `/register` — see the split-layout with the faux ticker on the left at desktop widths, the single-column form on mobile. Visit `/` (after signing in) — see row cards. Click a game → arena loads.

---

## What's NOT in this phase

- Real data on the atmosphere panel — it's faux on purpose so the first paint is fast and works offline.
- Restyling the `CreateGameDialog` body — the dialog itself is transient and works; making it match the terminal aesthetic isn't worth the churn.
- Sortable / filterable games list — out of scope.
- A "Joined as: X days ago" or "Day n/N" stat on the games list — would require enriching the `GET /games` response; defer until needed.

---

## Self-Review

**1. Spec coverage** (§4.1 + §4.3):
- Games list row cards ✓ Task 5
- Empty state mono-styled ✓ Task 5
- `+ NEW GAME` action ✓ Task 6
- Login/Register split layout ✓ Tasks 2, 3
- Atmosphere panel with faux content ✓ Task 1
- Form chrome restyled ✓ Tasks 2, 3
- All existing functionality preserved ✓ (forms unchanged, validation unchanged, API hooks unchanged)

**2. Placeholder scan:** none. Every step has runnable code.

**3. Type / API consistency:**
- `useGames`, `useLogin`, `useRegister` signatures unchanged.
- `GameStatus` enum reused from `@markettrader/shared`.
- `Panel`/`PanelBody` re-used from phase 1.
- `formatUSD` re-used from `@/lib/utils`.

**4. Ambiguity check:** The decision to leave CreateGameDialog's body alone (Task 6) is explicit. The decision to render the atmosphere panel only at `≥lg` (`hidden lg:flex` in the panel itself) means the form gets the full viewport on mobile — that's the simplest responsive behavior and matches the spec's description.
