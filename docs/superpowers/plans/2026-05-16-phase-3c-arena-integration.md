# Phase 3c — Arena Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `GameDetailPage` to compose the nine phase-3b arena panels in a three-pane grid wrapped in `SelectedSymbolProvider`, wire every symbol-click into the context, fix the ticker tape's in-game branch to write to the context, swap the cmd+k overlay's in-game navigation for a context write, and delete the legacy card components that the arena replaces.

**Architecture:** The page is laid out as a CSS grid: 280px left col / flex center col / 300px right col, between the existing global chrome (StatusStrip on top, TickerTape on bottom). The page wraps everything in `<SelectedSymbolProvider initial={defaultSymbol}>` where `defaultSymbol` is the first held symbol (or `null` if empty). Each panel receives the data it needs as props derived from the existing API hooks (`useGame`, `usePortfolio`, `useWatchlists`, `useTradeHistory`, `useWorkingOrders`). The `SelectedSymbolContext` mediates the center column — `QuoteHeader`, `ChartPanel`, and `OhlcStrip` all read from it; `HoldingsPanel`, `WatchlistPanel`, ticker tape, and the cmd+k overlay all write to it.

**Tech Stack:** React 19, React Query 5, Zustand, Tailwind 3.4, Vitest + RTL, existing `useGameSocket` for live prices, existing `liveStore` for tick subscriptions, existing `TradeOrderDialog` for buy/sell flows.

**Spec reference:** `docs/superpowers/specs/2026-05-15-terminal-design-refresh.md` §4.2 — the full arena layout, interaction model, and responsive breakpoints.

**Branch & commit cadence:** Work happens on `feat/phase-3c-arena-integration` (already created from `new-ui`). Each task ends with a focused commit. Merge into `new-ui` after Task 10.

---

## Task 0: Confirm branch state

- [ ] **Step 1: Verify current branch and clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status --short
```

Expected: branch is `feat/phase-3c-arena-integration`, status is clean.

- [ ] **Step 2: Verify phase 3b deliverables present**

```bash
ls packages/frontend/src/components/game/arena/
```

Expected: 10 files (9 panels + `index.ts`). If missing, you're on the wrong branch.

---

## File Structure

**Modified (frontend):**
- `packages/frontend/src/pages/GameDetailPage.tsx` — full rewrite. Composes the 9 panels in the three-pane grid; wraps everything in `SelectedSymbolProvider`; wires each panel's data + callbacks.
- `packages/frontend/src/components/shell/TickerTape.tsx` — fix the in-game branch so clicking a symbol writes to `SelectedSymbolContext` instead of being a non-clickable `<span>`.
- `packages/frontend/src/components/search/SymbolSearchOverlay.tsx` — when inside `/games/:gameId`, set the symbol in `SelectedSymbolContext` and close (instead of navigating away).
- `packages/frontend/src/components/game/arena/WatchlistPanel.tsx` — add the "+ ADD" affordance to the panel header (opens the cmd+k overlay).

**Created (frontend):**
- `packages/frontend/src/components/game/arena/JoinGameCard.tsx` — extracted "Join this game?" join prompt that the page renders on a 404 (small, lifted out of the rewrite for clarity).
- `packages/frontend/tests/GameDetailPage.test.tsx` — high-level integration test asserting the new layout + context wiring.

**Deleted (frontend):**
- `packages/frontend/src/components/SymbolSearchCard.tsx` — replaced by `SymbolSearchPanel` + cmd+k.
- `packages/frontend/src/components/game/YourProfileCard.tsx` — replaced by `PortfolioPanel`.
- `packages/frontend/src/components/game/AboutThisGameCard.tsx` — replaced by `AboutGameModal` (opened from status strip).
- `packages/frontend/src/components/game/GameLeaderboardCard.tsx` — replaced by `LeaderboardPanel`.
- `packages/frontend/src/components/game/HoldingsSidebar.tsx` — replaced by `HoldingsPanel` + `WatchlistPanel` (combined panel split into two).
- `packages/frontend/src/components/TradeActivityCard.tsx` — replaced by `ActivityPanel` (TradeHistoryTable + OpenOrdersList move into the activity feed in this phase; the older "history" / "open orders" tabs are dropped in favor of the live feed).
- `packages/frontend/src/components/Leaderboard.tsx` — unused after the rewrite.
- `packages/frontend/tests/SymbolSearchCard.test.tsx` — paired with the deleted component.

**Kept (no changes here):**
- `packages/frontend/src/components/QuoteInfoDialog.tsx`, `TradeOrderDialog.tsx` — modals invoked by the panel's BUY/SELL flow.
- `packages/frontend/src/components/StockChart.tsx` — wrapped by `ChartPanel` from 3b.
- Open-orders / trade-history detail views (`OpenOrdersList`, `TradeHistoryTable`) are kept in the codebase but no longer mounted on `GameDetailPage`; they remain available for future routes if needed.

---

## Shared Conventions

- Use `useSelectedSymbol()` / `useSetSelectedSymbol()` from `@/contexts/SelectedSymbolContext` (phase 3a).
- Test files mock `@/api/stocks`, `@/api/games`, `@/api/trades`, `@/api/watchlists` where appropriate to keep tests fast.
- The `SelectedSymbolProvider` wraps the entire page body; the 404 prompt (`JoinGameCard`) doesn't need a provider.

---

## Task 1: Extract `JoinGameCard`

**Files:**
- Create: `packages/frontend/src/components/game/arena/JoinGameCard.tsx`
- Create: `packages/frontend/tests/JoinGameCard.test.tsx`

Lift the "Join this game?" 404 prompt out of `GameDetailPage` so the rewrite stays focused. This is mechanical — the new file holds the existing join flow verbatim, restyled to use `Panel` chrome.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';

const joinMutate = vi.fn().mockResolvedValue({});
vi.mock('@/api/games', () => ({
  useJoinGame: () => ({ mutateAsync: joinMutate, isPending: false }),
}));

import { JoinGameCard } from '@/components/game/arena/JoinGameCard';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

describe('JoinGameCard', () => {
  it('renders a Join button and the explanatory text', () => {
    render(wrap(<JoinGameCard gameId="g1" onJoined={() => {}} />));
    expect(screen.getByRole('button', { name: /join game/i })).toBeInTheDocument();
    expect(screen.getByText(/not a member/i)).toBeInTheDocument();
  });

  it('calls the join mutation + onJoined on click', async () => {
    const user = userEvent.setup();
    const onJoined = vi.fn();
    render(wrap(<JoinGameCard gameId="g1" onJoined={onJoined} />));
    await user.click(screen.getByRole('button', { name: /join game/i }));
    expect(joinMutate).toHaveBeenCalledWith('g1');
    expect(onJoined).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- JoinGameCard
```

- [ ] **Step 3: Implement**

```tsx
import { useJoinGame } from '@/api/games';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';

export interface JoinGameCardProps {
  gameId: string;
  onJoined: () => void;
}

/**
 * Rendered on the game-detail route when the user isn't a member yet (the
 * server returns 404 for non-members). Posting accepts the join and calls
 * onJoined so the page can refetch the game.
 */
export function JoinGameCard({ gameId, onJoined }: JoinGameCardProps) {
  const join = useJoinGame();

  async function handleJoin() {
    try {
      await join.mutateAsync(gameId);
      toast({ title: 'Joined', variant: 'success' });
      onJoined();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? typeof err.body === 'object' && err.body && 'error' in err.body
            ? String((err.body as { error: unknown }).error)
            : `Error ${err.status}`
          : 'Failed to join';
      toast({ title: 'Could not join', description: msg, variant: 'destructive' });
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <Panel>
        <PanelHeader>Join this game?</PanelHeader>
        <PanelBody>
          <p className="mb-3 text-sm text-muted">
            You're not a member yet, or this game doesn't exist. Try joining — if the ID is invalid
            you'll get an error.
          </p>
          <Button onClick={handleJoin} disabled={join.isPending}>
            {join.isPending ? 'Joining…' : 'Join game'}
          </Button>
        </PanelBody>
      </Panel>
    </main>
  );
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- JoinGameCard
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/game/arena/JoinGameCard.tsx packages/frontend/tests/JoinGameCard.test.tsx
git commit -m "feat(frontend): extract JoinGameCard for the 404 join prompt

Lifted out of GameDetailPage to keep the upcoming arena rewrite
focused on the happy path. Same join behavior, restyled to use Panel
chrome."
```

---

## Task 2: Add `+ ADD` action to `WatchlistPanel`

**Files:**
- Modify: `packages/frontend/src/components/game/arena/WatchlistPanel.tsx`
- Modify: `packages/frontend/tests/WatchlistPanel.test.tsx`

The phase-3b panel deliberately deferred the "+ ADD" affordance. Add it now — clicking opens the cmd+k overlay so the user can search and pick a symbol to add.

For phase 3c we just open the overlay; actually persisting the added symbol to the watchlist needs the existing watchlist mutation hooks. The overlay's `onSelect` callback inside the arena context will write to `SelectedSymbolContext` and close — adding to the watchlist is a separate user action and is out of scope here. The "+ ADD" affordance is therefore "open the search UI and pick a symbol to look at" rather than literally adding to the watchlist. Document this in the component JSDoc.

- [ ] **Step 1: Write the failing test**

Append to `packages/frontend/tests/WatchlistPanel.test.tsx`:

```tsx
import { useCommandKStore } from '@/stores/commandKStore';

// Add inside the existing describe block, after existing tests.
it('renders an + ADD button that opens the cmd+k overlay', async () => {
  const user = userEvent.setup();
  useCommandKStore.getState().close();
  render(<WatchlistPanel rows={ROWS} />);
  const addBtn = screen.getByRole('button', { name: /\+ ?ADD/i });
  await user.click(addBtn);
  expect(useCommandKStore.getState().open).toBe(true);
});
```

Make sure `userEvent` is imported in the file (it should be from earlier tests).

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- WatchlistPanel
```

Expected: the new test fails because no `+ ADD` button exists.

- [ ] **Step 3: Update the component**

Replace the `<PanelHeader>Watchlist</PanelHeader>` line in `packages/frontend/src/components/game/arena/WatchlistPanel.tsx` with:

```tsx
<PanelHeader
  right={
    <button
      type="button"
      onClick={() => useCommandKStore.getState().open$()}
      className="font-mono text-[10px] tracking-[0.14em] text-accent hover:underline"
    >
      + ADD
    </button>
  }
>
  Watchlist
</PanelHeader>
```

Add the import at the top:

```tsx
import { useCommandKStore } from '@/stores/commandKStore';
```

Update the component JSDoc to note the affordance opens the search overlay rather than adding directly:

```tsx
/**
 * Right-column compact watchlist. Each clickable row drives the arena's
 * SelectedSymbolContext. The "+ ADD" affordance opens the global search
 * overlay; persisting a chosen symbol into the active watchlist is a
 * separate user action handled outside this panel.
 */
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- WatchlistPanel
```

Expected: 4 tests pass (3 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/game/arena/WatchlistPanel.tsx packages/frontend/tests/WatchlistPanel.test.tsx
git commit -m "feat(frontend): + ADD action in WatchlistPanel header

Opens the global cmd+k search overlay. Persisting a chosen symbol
into the active watchlist is intentionally out of scope here — the
affordance is for symbol discovery."
```

---

## Task 3: Wire `SymbolSearchOverlay` to `SelectedSymbolContext` when in-game

**Files:**
- Modify: `packages/frontend/src/components/search/SymbolSearchOverlay.tsx`
- Modify: `packages/frontend/tests/SymbolSearchOverlay.test.tsx`

Phase 3a had the overlay always navigate to `/symbols/:symbol`. In a game, that pulls the user out of the arena. Switch behavior:
- Inside `/games/:gameId`: try to `setSelectedSymbol(symbol)` from the context (if available), then `close()`. Stay on the arena.
- Outside a game: keep the existing `navigate('/symbols/:symbol')` behavior.

The wrinkle: `useSetSelectedSymbol()` throws if there's no provider. The overlay mounts at `AppShell`, OUTSIDE any provider. We can't call the hook unconditionally. Solution: introduce a "loose" context-aware setter that returns `null` outside a provider, and route based on its presence.

- [ ] **Step 1: Add a loose setter to `SelectedSymbolContext`**

Modify `packages/frontend/src/contexts/SelectedSymbolContext.tsx`. Add at the bottom:

```tsx
/**
 * Returns the setter when called inside a SelectedSymbolProvider, or `null`
 * when called outside. Use this from components that live above the provider
 * in the tree (e.g. AppShell-level singletons) and need to update the
 * selected symbol when one happens to be available.
 */
export function useMaybeSetSelectedSymbol(): SymbolWriter | null {
  return useContext(WriterContext) ?? null;
}
```

This is safe: the existing `WriterContext` default is `undefined`; the existing `useSetSelectedSymbol` throws on `undefined`, but `useMaybeSetSelectedSymbol` just returns `null`.

Add a test for it. Append to `packages/frontend/tests/SelectedSymbolContext.test.tsx`:

```tsx
import { useMaybeSetSelectedSymbol } from '@/contexts/SelectedSymbolContext';

function MaybeWriter({ next, onResult }: { next: string; onResult: (had: boolean) => void }) {
  const setSymbol = useMaybeSetSelectedSymbol();
  return (
    <button
      type="button"
      onClick={() => {
        onResult(setSymbol !== null);
        setSymbol?.(next);
      }}
      data-testid="maybe-writer"
    >
      maybe-set
    </button>
  );
}

it('useMaybeSetSelectedSymbol returns the setter inside the provider', async () => {
  const user = userEvent.setup();
  const onResult = vi.fn();
  render(
    <SelectedSymbolProvider>
      <Reader />
      <MaybeWriter next="MSFT" onResult={onResult} />
    </SelectedSymbolProvider>,
  );
  await user.click(screen.getByTestId('maybe-writer'));
  expect(onResult).toHaveBeenCalledWith(true);
  expect(screen.getByTestId('reader')).toHaveTextContent('MSFT');
});

it('useMaybeSetSelectedSymbol returns null outside the provider', async () => {
  const user = userEvent.setup();
  const onResult = vi.fn();
  render(<MaybeWriter next="MSFT" onResult={onResult} />);
  await user.click(screen.getByTestId('maybe-writer'));
  expect(onResult).toHaveBeenCalledWith(false);
});
```

- [ ] **Step 2: Update the overlay to use it**

Replace `packages/frontend/src/components/search/SymbolSearchOverlay.tsx`:

```tsx
import { useNavigate, useParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SymbolSearch } from './SymbolSearch';
import { useCommandKStore } from '@/stores/commandKStore';
import { useGame } from '@/api/games';
import { useMaybeSetSelectedSymbol } from '@/contexts/SelectedSymbolContext';

/**
 * Modal wrapper around {@link SymbolSearch} opened by cmd+k. Mounted once
 * at AppShell level. When inside `/games/:gameId` AND the arena has
 * mounted a SelectedSymbolProvider, picking a result writes the symbol
 * into that context and closes — the user stays in the arena. Outside a
 * game (or before the arena mounts), falls back to navigating to
 * `/symbols/:symbol`.
 */
export function SymbolSearchOverlay() {
  const open = useCommandKStore((s) => s.open);
  const close = useCommandKStore((s) => s.close);
  const navigate = useNavigate();
  const params = useParams();
  const game = useGame(params.gameId ?? '');
  const setSelectedSymbol = useMaybeSetSelectedSymbol();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogTitle className="sr-only">Search symbol</DialogTitle>
        <SymbolSearch
          autoFocus
          placeholder="Search symbol..."
          onSelect={(symbol) => {
            close();
            if (params.gameId && setSelectedSymbol) {
              setSelectedSymbol(symbol);
              return;
            }
            navigate(`/symbols/${symbol}`);
          }}
        />
        <div className="mt-2 flex justify-between text-[10px] text-muted">
          <span>Click to select · Esc to close</span>
          {params.gameId && game.data ? <span>In: {game.data.name}</span> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Update the overlay test**

Append to `packages/frontend/tests/SymbolSearchOverlay.test.tsx` (the existing tests cover the out-of-game navigation; add one for the in-game context-write path):

```tsx
import { SelectedSymbolProvider, useSelectedSymbol } from '@/contexts/SelectedSymbolContext';

function SelectedReader() {
  const s = useSelectedSymbol();
  return <div data-testid="selected">{s ?? '(none)'}</div>;
}

it('writes to SelectedSymbolContext (instead of navigating) when inside a game with a provider', async () => {
  const user = userEvent.setup();
  useCommandKStore.getState().open$();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/games/g1']}>
        <Routes>
          <Route
            path="/games/:gameId"
            element={
              <SelectedSymbolProvider>
                <SymbolSearchOverlay />
                <SelectedReader />
                <LocationProbe />
              </SelectedSymbolProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.type(screen.getByRole('searchbox'), 'AA');
  const row = await screen.findByText('AAPL');
  await user.click(row);
  expect(useCommandKStore.getState().open).toBe(false);
  expect(screen.getByTestId('selected')).toHaveTextContent('AAPL');
  // Stayed on /games/g1, did NOT navigate to /symbols/AAPL.
  expect(screen.getByTestId('location')).toHaveTextContent('/games/g1');
});
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- SymbolSearchOverlay SelectedSymbolContext
```

Expected: existing tests still pass + 2 new context tests + 1 new overlay test.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/contexts/SelectedSymbolContext.tsx packages/frontend/tests/SelectedSymbolContext.test.tsx packages/frontend/src/components/search/SymbolSearchOverlay.tsx packages/frontend/tests/SymbolSearchOverlay.test.tsx
git commit -m "feat(frontend): cmd+k overlay writes context when inside an arena

Adds useMaybeSetSelectedSymbol — returns null outside the provider
(safe at AppShell level), returns the setter inside. SymbolSearchOverlay
picks between context-write and navigation based on its availability,
so cmd+k inside a game keeps the user in the arena."
```

---

## Task 4: Fix `TickerTape` in-game click to write to `SelectedSymbolContext`

**Files:**
- Modify: `packages/frontend/src/components/shell/TickerTape.tsx`
- Modify: `packages/frontend/tests/TickerTape.test.tsx`

Phase 2 left the in-game branch as a non-clickable `<span>`. Switch it to write to the loose context setter. Outside a game, keep the existing `Link to /symbols/:symbol`.

- [ ] **Step 1: Write the failing test**

Append to `packages/frontend/tests/TickerTape.test.tsx`:

```tsx
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { SelectedSymbolProvider, useSelectedSymbol } from '@/contexts/SelectedSymbolContext';

function SelectedReader() {
  const s = useSelectedSymbol();
  return <div data-testid="selected">{s ?? '(none)'}</div>;
}

it('writes to SelectedSymbolContext when clicked in-game', async () => {
  const user = userEvent.setup();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(TICKER_TAPE_QUERY_KEY, {
    symbols: ['AAPL'],
    updatedAt: '2026-05-15T14:00:00Z',
  });
  qc.setQueryData<IndexQuote[]>(INDICES_QUERY_KEY, [
    { symbol: 'AAPL', last: 189.42, changeAbs: 1.57, changePct: 0.84 },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/games/g1']}>
        <Routes>
          <Route
            path="/games/:gameId"
            element={
              <SelectedSymbolProvider>
                <TickerTape />
                <SelectedReader />
              </SelectedSymbolProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Click the first AAPL item in the marquee.
  const items = screen.getAllByText('AAPL');
  await user.click(items[0]!);
  expect(screen.getByTestId('selected')).toHaveTextContent('AAPL');
});
```

The existing TickerTape test imports already include `MemoryRouter` and the React Query helpers — the new test reuses them.

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- TickerTape
```

Expected: new test fails because the in-game `<span>` isn't clickable.

- [ ] **Step 3: Update `TickerTape`**

Modify `packages/frontend/src/components/shell/TickerTape.tsx`. Replace the in-game branch (currently a plain `<span>`) with a `<button>` that calls the loose setter. Full file:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useTickerTapeSymbols } from '@/hooks/useTickerTapeSymbols';
import { INDICES_QUERY_KEY } from '@/hooks/useIndicesSocket';
import { useMaybeSetSelectedSymbol } from '@/contexts/SelectedSymbolContext';
import type { IndexQuote } from '@markettrader/shared';

/**
 * Sticky bottom chrome row: a left-scrolling marquee of server-configured
 * symbols + their latest quotes. Outside a game, clicking a symbol
 * navigates to `/symbols/:symbol`. Inside a game with the arena mounted,
 * clicking writes the symbol into SelectedSymbolContext so the center
 * column updates in place.
 */
export function TickerTape() {
  const symbols = useTickerTapeSymbols();
  const quotes = useQuery<IndexQuote[]>({
    queryKey: INDICES_QUERY_KEY,
    queryFn: () => [],
    enabled: false,
    initialData: [],
  });
  const params = useParams();
  const setSelectedSymbol = useMaybeSetSelectedSymbol();
  const inGame = !!params.gameId && !!setSelectedSymbol;

  if (symbols.length === 0) return null;

  const quoteBySymbol = new Map(quotes.data?.map((q) => [q.symbol, q]));
  const items = symbols.map((s) => ({ symbol: s, quote: quoteBySymbol.get(s) }));
  const looped = [...items, ...items];

  return (
    <div
      data-testid="ticker-tape"
      className="h-6 border-t border-hairline-strong bg-bg/95 overflow-hidden"
    >
      <div
        data-testid="ticker-tape-marquee"
        className="flex h-full items-center gap-6 whitespace-nowrap animate-marquee px-4 text-[11px] font-mono"
      >
        {looped.map((it, idx) => {
          const change = it.quote?.changePct ?? 0;
          const last = it.quote?.last;
          const inner = (
            <span className="flex items-baseline gap-1">
              <span className="text-text">{it.symbol}</span>
              {last !== undefined ? (
                <>
                  <span className="text-muted">
                    {new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(last)}
                  </span>
                  <span className={change >= 0 ? 'text-gain' : 'text-loss'}>
                    {change >= 0 ? '+' : '−'}{Math.abs(change).toFixed(2)}%
                  </span>
                </>
              ) : null}
            </span>
          );
          const key = `${it.symbol}-${idx}`;
          return inGame ? (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedSymbol!(it.symbol)}
              className="hover:text-accent"
            >
              {inner}
            </button>
          ) : (
            <Link key={key} to={`/symbols/${it.symbol}`} className="hover:text-accent">
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- TickerTape
```

Expected: all existing tests + new in-game test pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/shell/TickerTape.tsx packages/frontend/tests/TickerTape.test.tsx
git commit -m "feat(frontend): TickerTape in-game click writes to SelectedSymbolContext

Inside an arena, clicking a tape symbol updates the page's selected
symbol instead of being a dead non-clickable span. Outside a game,
the link behavior is unchanged."
```

---

## Task 5: Rewrite `GameDetailPage` — happy path

**Files:**
- Modify: `packages/frontend/src/pages/GameDetailPage.tsx`
- Create: `packages/frontend/tests/GameDetailPage.test.tsx`

The biggest change. The new page composes the panels in a three-pane grid, wraps everything in `SelectedSymbolProvider`, and threads data + callbacks through. Tests cover:
- Layout renders all 9 panels.
- Holdings row click updates `QuoteHeader`.
- BUY/SELL opens `TradeOrderDialog`.
- Loading / 404 / join states still work.

- [ ] **Step 1: Read the existing page**

```bash
cat packages/frontend/src/pages/GameDetailPage.tsx
```

Identify the data flow you need to preserve:
- `useGame(gameId)` + `usePortfolio(gameId)` + `useGameSocket(gameId, symbols)` + `useWatchlists()` + `useWatchlistUiStore`.
- 404 → `JoinGameCard`.
- `QuoteInfoDialog` and `TradeOrderDialog` modals at the bottom.

You'll keep all of that.

- [ ] **Step 2: Write the failing integration test**

Create `packages/frontend/tests/GameDetailPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import type React from 'react';

// Mocks for every API hook the page consumes.
vi.mock('@/api/games', async () => {
  const actual = await vi.importActual<typeof import('@/api/games')>('@/api/games');
  return {
    ...actual,
    useGame: (id: string) => ({
      data: id
        ? {
            id,
            name: 'Friday Night Bloodbath',
            status: 'active',
            startDate: '2026-05-12T00:00:00Z',
            endDate: '2026-05-25T23:59:59Z',
            startingBalance: 100000,
            leaderboard: [
              { playerId: 'u2', username: 'tristan', rank: 1, totalValue: 118902, cashBalance: 12402 },
              { playerId: 'u3', username: 'marcus', rank: 2, totalValue: 95000, cashBalance: 1000 },
            ],
            createdBy: 'u2',
            allowShortSelling: false,
            allowLimitOrders: false,
            allowStopOrders: false,
            allowBracketOrders: false,
            allowGTC: false,
          }
        : undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }),
  };
});

vi.mock('@/api/trades', () => ({
  usePortfolio: () => ({
    data: {
      cashBalance: 12402,
      totalValue: 118902,
      reservedValue: 0,
      holdings: [
        {
          symbol: 'AAPL',
          quantity: 120,
          avgCostBasis: 175,
          currentPrice: 189.42,
          marketValue: 22730.4,
          unrealizedPnL: 1730.4,
          unrealizedPnLPercent: 8.24,
        },
        {
          symbol: 'NVDA',
          quantity: 40,
          avgCostBasis: 950,
          currentPrice: 1178.3,
          marketValue: 47132,
          unrealizedPnL: 9132,
          unrealizedPnLPercent: 24.03,
        },
      ],
    },
    isLoading: false,
  }),
  useTradeHistory: () => ({ data: [] }),
  useWorkingOrders: () => ({ data: [] }),
  usePendingTrades: () => ({ data: [] }),
}));

vi.mock('@/api/watchlists', () => ({
  useWatchlists: () => ({ data: [{ id: 'w1', name: 'Tech', symbols: ['TSLA', 'MSFT'] }] }),
}));

vi.mock('@/hooks/useGameSocket', () => ({
  useGameSocket: () => undefined,
}));

vi.mock('@/components/StockChart', () => ({
  StockChart: ({ symbols }: { symbols: string[] }) => (
    <div data-testid="stockchart">chart-{symbols.join(',') || 'none'}</div>
  ),
}));

import { GameDetailPage } from '@/pages/GameDetailPage';

function wrap(initialPath = '/games/g1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/games/:gameId" element={<GameDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('GameDetailPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: 't',
      user: { id: 'u2', username: 'tristan', groups: [] },
    });
  });

  it('renders all nine arena panels', () => {
    render(wrap());
    expect(screen.getByText(/leaderboard/i)).toBeInTheDocument();
    expect(screen.getByText(/your portfolio/i)).toBeInTheDocument();
    expect(screen.getByText(/quote/i)).toBeInTheDocument();
    expect(screen.getByText(/chart/i)).toBeInTheDocument();
    expect(screen.getByText(/holdings/i)).toBeInTheDocument();
    expect(screen.getByText(/watchlist/i)).toBeInTheDocument();
    expect(screen.getByText(/activity/i)).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('seeds the SelectedSymbolContext with the first holding', () => {
    render(wrap());
    // QuoteHeader shows the selected symbol — AAPL is first holding.
    const stockchart = screen.getByTestId('stockchart');
    expect(stockchart).toHaveTextContent('chart-AAPL');
  });

  it('updates the chart when a holding row is clicked', async () => {
    const user = userEvent.setup();
    render(wrap());
    expect(screen.getByTestId('stockchart')).toHaveTextContent('chart-AAPL');
    await user.click(screen.getByText('NVDA'));
    expect(screen.getByTestId('stockchart')).toHaveTextContent('chart-NVDA');
  });

  it('marks the current user row in the leaderboard', () => {
    render(wrap());
    const meRow = screen.getByText('tristan').closest('li');
    expect(meRow?.getAttribute('data-current-user')).toBe('true');
  });
});
```

- [ ] **Step 3: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- GameDetailPage
```

Expected: most assertions fail (the old layout doesn't render the new panel labels).

- [ ] **Step 4: Rewrite `GameDetailPage`**

Replace `packages/frontend/src/pages/GameDetailPage.tsx` with:

```tsx
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useGame } from '@/api/games';
import { usePortfolio, useTradeHistory } from '@/api/trades';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useLiveStore } from '@/stores/liveStore';
import { useWatchlists } from '@/api/watchlists';
import { useWatchlistUiStore } from '@/stores/watchlistUiStore';
import { useStockQuote } from '@/api/stocks';
import { useAuthStore } from '@/stores/authStore';
import { SelectedSymbolProvider, useSelectedSymbol, useSetSelectedSymbol } from '@/contexts/SelectedSymbolContext';
import {
  LeaderboardPanel,
  PortfolioPanel,
  QuoteHeader,
  ChartPanel,
  OhlcStrip,
  HoldingsPanel,
  WatchlistPanel,
  ActivityPanel,
  SymbolSearchPanel,
} from '@/components/game/arena';
import { JoinGameCard } from '@/components/game/arena/JoinGameCard';
import { TradeOrderDialog } from '@/components/TradeOrderDialog';
import { QuoteInfoDialog } from '@/components/QuoteInfoDialog';
import { useQuoteDialogStore } from '@/stores/quoteDialogStore';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import type { TradeDirection } from '@markettrader/shared';
import type { ActivityEvent } from '@/components/game/arena';

/**
 * Game-detail "arena" page: three-pane grid composed of nine panels with a
 * single SelectedSymbolContext driving the center column. Holdings, watchlist,
 * search, and the ticker tape all write to the context; QuoteHeader and
 * ChartPanel read from it.
 */
export function GameDetailPage() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const game = useGame(gameId);
  const portfolio = usePortfolio(gameId);
  const watchlists = useWatchlists();
  const selectedWatchlistId = useWatchlistUiStore((s) => s.selectedWatchlistId);
  const tradeHistory = useTradeHistory(gameId);

  const heldSymbols = useMemo(
    () => portfolio.data?.holdings.map((h) => h.symbol) ?? [],
    [portfolio.data],
  );

  const watchlistSymbols = useMemo(() => {
    const lists = watchlists.data ?? [];
    const active = lists.find((l) => l.id === selectedWatchlistId) ?? lists[0];
    return active?.symbols ?? [];
  }, [watchlists.data, selectedWatchlistId]);

  const subscribedSymbols = useMemo(
    () => [...new Set([...heldSymbols, ...watchlistSymbols])],
    [heldSymbols, watchlistSymbols],
  );
  useGameSocket(gameId, subscribedSymbols);

  const initialSymbol = heldSymbols[0] ?? null;

  // 404 → join prompt
  if (game.isError && game.error instanceof ApiError && game.error.status === 404) {
    return <JoinGameCard gameId={gameId} onJoined={() => game.refetch()} />;
  }

  if (game.isLoading || !game.data) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <Skeleton className="h-7 w-48" />
      </main>
    );
  }

  return (
    <SelectedSymbolProvider initial={initialSymbol}>
      <ArenaBody
        gameId={gameId}
        gameData={game.data}
        portfolioData={portfolio.data}
        watchlistSymbols={watchlistSymbols}
        tradeHistory={tradeHistory.data ?? []}
      />
    </SelectedSymbolProvider>
  );
}

interface ArenaBodyProps {
  gameId: string;
  gameData: NonNullable<ReturnType<typeof useGame>['data']>;
  portfolioData: ReturnType<typeof usePortfolio>['data'];
  watchlistSymbols: string[];
  tradeHistory: NonNullable<ReturnType<typeof useTradeHistory>['data']>;
}

function ArenaBody({ gameId, gameData, portfolioData, watchlistSymbols, tradeHistory }: ArenaBodyProps) {
  const setSelectedSymbol = useSetSelectedSymbol();
  const selectedSymbol = useSelectedSymbol();
  const livePrices = useLiveStore((s) => s.pricesBySymbol);
  const user = useAuthStore((s) => s.user);
  const quoteDialog = useQuoteDialogStore();
  const [tradeDialog, setTradeDialog] = useState<{ open: boolean; direction?: TradeDirection }>({ open: false });

  // Watchlist quote rows: read from the live store, falling back to undefined.
  const watchlistRows = watchlistSymbols.map((symbol) => {
    const tick = livePrices[symbol];
    return {
      symbol,
      last: tick?.price,
      changePct: tick?.changePercent,
    };
  });

  // Holdings rows: enrich with the live price when available.
  const holdingRows =
    portfolioData?.holdings.map((h) => {
      const tick = livePrices[h.symbol];
      const price = tick?.price ?? h.currentPrice;
      return {
        symbol: h.symbol,
        name: h.symbol, // The server doesn't return company names with holdings; placeholder until 3c+
        quantity: h.quantity,
        avgCost: h.avgCostBasis,
        marketValue: price * h.quantity,
        pnlPct:
          h.avgCostBasis > 0 ? ((price - h.avgCostBasis) / h.avgCostBasis) * 100 : 0,
      };
    }) ?? [];

  // Selected-symbol quote: pull from live store when present, else fetch fresh.
  const liveTick = selectedSymbol ? livePrices[selectedSymbol] : undefined;
  const freshQuote = useStockQuote(selectedSymbol ?? '', { enabled: !!selectedSymbol && !liveTick });
  const quoteData = liveTick
    ? {
        last: liveTick.price,
        changeAbs: liveTick.change ?? 0,
        changePct: liveTick.changePercent ?? 0,
      }
    : freshQuote.data
      ? {
          last: freshQuote.data.price,
          changeAbs: freshQuote.data.change,
          changePct: freshQuote.data.changePercent,
        }
      : undefined;

  // Trade history → activity feed events.
  const activityEvents: ActivityEvent[] = tradeHistory
    .filter((t) => t.status === 'executed' && t.executedAt)
    .slice(0, 25)
    .map((t) => ({
      at: t.executedAt!,
      player: user?.username ?? '—', // The history endpoint only returns this user's trades for now
      direction: t.direction,
      quantity: t.quantity,
      symbol: t.symbol,
      price: t.executedPrice ?? 0,
    }));

  const myPortfolioValue = portfolioData?.totalValue ?? gameData.startingBalance;
  const myCash = portfolioData?.cashBalance ?? 0;
  const myPnlPct =
    gameData.startingBalance > 0
      ? ((myPortfolioValue - gameData.startingBalance) / gameData.startingBalance) * 100
      : 0;
  // Day P&L isn't computed by the server; approximate as 0 until we have day-open snapshots.
  const myDayPnl = 0;

  return (
    <main className="mx-auto grid w-full max-w-[1600px] grid-cols-1 gap-2 p-3 lg:grid-cols-[280px_1fr_300px]">
      {/* Left column */}
      <aside className="flex flex-col gap-2">
        <LeaderboardPanel entries={gameData.leaderboard ?? []} startingBalance={gameData.startingBalance} />
        <PortfolioPanel value={myPortfolioValue} pnlPct={myPnlPct} cash={myCash} dayPnl={myDayPnl} />
      </aside>

      {/* Center column */}
      <section className="flex flex-col gap-2">
        <QuoteHeader
          symbol={selectedSymbol}
          last={quoteData?.last}
          changeAbs={quoteData?.changeAbs}
          changePct={quoteData?.changePct}
          onTrade={selectedSymbol ? (direction) => setTradeDialog({ open: true, direction }) : undefined}
        />
        <ChartPanel symbol={selectedSymbol} />
        <OhlcStrip />
        <HoldingsPanel rows={holdingRows} onSelect={setSelectedSymbol} />
      </section>

      {/* Right column */}
      <aside className="flex flex-col gap-2">
        <SymbolSearchPanel onSelect={setSelectedSymbol} />
        <WatchlistPanel rows={watchlistRows} onSelect={setSelectedSymbol} />
        <ActivityPanel events={activityEvents} />
      </aside>

      {/* Modals */}
      <QuoteInfoDialog
        open={quoteDialog.open}
        symbol={quoteDialog.symbol}
        onOpenChange={(open) => {
          if (!open) quoteDialog.closeQuote();
        }}
        onTradeClick={(s) => quoteDialog.openTradeOrder(s)}
      />
      <TradeOrderDialog
        open={tradeDialog.open}
        initialSymbol={selectedSymbol ?? undefined}
        initialDirection={tradeDialog.direction}
        gameId={gameId}
        allowShortSelling={gameData.allowShortSelling ?? false}
        allowLimitOrders={gameData.allowLimitOrders ?? false}
        allowStopOrders={gameData.allowStopOrders ?? false}
        allowBracketOrders={gameData.allowBracketOrders ?? false}
        allowGTC={gameData.allowGTC ?? false}
        onOpenChange={(open) => {
          if (!open) setTradeDialog({ open: false });
        }}
        onSeeQuote={(s) => {
          setTradeDialog({ open: false });
          quoteDialog.openQuote(s);
        }}
      />
    </main>
  );
}
```

Note on `initialDirection`: confirm by reading `packages/frontend/src/components/TradeOrderDialog.tsx`. If it doesn't accept that prop, drop the line — the user can pick direction inside the dialog. The phase-3c implementer should check the actual prop names.

- [ ] **Step 5: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- GameDetailPage
```

Expected: 4 tests pass.

Expect existing tests to also be affected because legacy components are still in place — the deletions happen in Task 6. Run the full suite to confirm nothing else broke:

```bash
pnpm --filter @markettrader/frontend test
```

If any test in `SymbolSearchCard.test.tsx` breaks because the page no longer mounts it, leave it — Task 6 deletes that test along with the component. Don't fix legacy tests; just confirm `GameDetailPage.test.tsx` passes and the count makes sense.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/pages/GameDetailPage.tsx packages/frontend/tests/GameDetailPage.test.tsx
git commit -m "feat(frontend): GameDetailPage three-pane arena layout

Replaces the card-stack layout with a three-pane CSS grid composing
the nine phase-3b arena panels. SelectedSymbolProvider wraps the
body; holdings/watchlist/search/ticker-tape clicks all write to the
context, QuoteHeader and ChartPanel read from it. Existing API hooks
preserved; legacy panel components remain in the tree but are no
longer mounted (deletion in the next commit)."
```

---

## Task 6: Delete the orphaned legacy components

**Files (deleted):**
- `packages/frontend/src/components/SymbolSearchCard.tsx`
- `packages/frontend/tests/SymbolSearchCard.test.tsx`
- `packages/frontend/src/components/game/YourProfileCard.tsx`
- `packages/frontend/src/components/game/AboutThisGameCard.tsx`
- `packages/frontend/src/components/game/GameLeaderboardCard.tsx`
- `packages/frontend/src/components/game/HoldingsSidebar.tsx`
- `packages/frontend/src/components/TradeActivityCard.tsx`
- `packages/frontend/src/components/Leaderboard.tsx`

- [ ] **Step 1: Confirm no remaining imports**

```bash
grep -RIn 'SymbolSearchCard\|YourProfileCard\|AboutThisGameCard\|GameLeaderboardCard\|HoldingsSidebar\|TradeActivityCard\|from .@/components/Leaderboard' packages/frontend/src packages/frontend/tests
```

Expected: no hits in `src/` (only the files themselves). If there are hits, fix the importing file first.

The `Leaderboard.tsx` component lives at `components/Leaderboard.tsx`. Confirm nothing imports it; if a test does, delete the test too.

- [ ] **Step 2: Delete the files**

```bash
git rm packages/frontend/src/components/SymbolSearchCard.tsx
git rm packages/frontend/tests/SymbolSearchCard.test.tsx
git rm packages/frontend/src/components/game/YourProfileCard.tsx
git rm packages/frontend/src/components/game/AboutThisGameCard.tsx
git rm packages/frontend/src/components/game/GameLeaderboardCard.tsx
git rm packages/frontend/src/components/game/HoldingsSidebar.tsx
git rm packages/frontend/src/components/TradeActivityCard.tsx
git rm packages/frontend/src/components/Leaderboard.tsx
```

- [ ] **Step 3: Verify**

```bash
pnpm --filter @markettrader/frontend typecheck
pnpm --filter @markettrader/frontend test
pnpm --filter @markettrader/frontend lint
```

Expected: all PASS. Count drops by SymbolSearchCard's tests (3) since that test file is gone.

- [ ] **Step 4: Commit**

```bash
git add -u packages/frontend/src/components packages/frontend/tests
git commit -m "chore(frontend): delete legacy game-detail components

Replaced by the arena panels in phase 3b/3c:
- SymbolSearchCard → SymbolSearchPanel + cmd+k overlay
- YourProfileCard → PortfolioPanel
- AboutThisGameCard → AboutGameModal (from status strip)
- GameLeaderboardCard → LeaderboardPanel
- HoldingsSidebar → HoldingsPanel + WatchlistPanel
- TradeActivityCard → ActivityPanel
- Leaderboard (unused) → removed"
```

---

## Task 7: Restore the live store wire-up that may have regressed

**Files:**
- Inspect: `packages/frontend/src/pages/GameDetailPage.tsx`

The new page reads `useLiveStore((s) => s.pricesBySymbol)`. Confirm the live store IS populated by `useGameSocket`. Read `packages/frontend/src/hooks/useGameSocket.ts` to verify. If `useGameSocket` only triggers React Query invalidations and doesn't fill `pricesBySymbol`, this is a real gap — the watchlist/holdings would never get live prices.

- [ ] **Step 1: Read `useGameSocket`**

```bash
cat packages/frontend/src/hooks/useGameSocket.ts
```

Confirm it writes price ticks into `useLiveStore.setState` somewhere. If it does, no change needed.

- [ ] **Step 2: If it doesn't, fix**

If `useGameSocket` doesn't write to the live store, you may need to either:
(a) Add the write to `useGameSocket`, or
(b) Use the React Query cache instead of the live store.

Most likely the live store IS already wired (the existing `HoldingsSidebar` reads from it). Confirm by inspecting and skip if so.

This task is a guard against a hidden integration bug; no commit required unless a fix was needed. If a fix WAS needed, commit it with a descriptive message.

---

## Task 8: Responsive collapse — tab strip on narrow viewports

**Files:**
- Modify: `packages/frontend/src/pages/GameDetailPage.tsx`

The spec says:
- `≥1280px`: three-column grid (default).
- `900–1279px`: right column collapses into a tab strip at the top of the center column (Watchlist / Activity / Search).
- `<900px`: both side columns collapse into one tab strip (Leaderboard / Portfolio / Watchlist / Activity / Search). Center always the dominant pane.

For phase 3c we implement the simplest responsive behavior: on `<lg` viewports (Tailwind's `lg` is 1024px) the grid stacks single-column. This is already what `grid-cols-1 lg:grid-cols-[280px_1fr_300px]` does — verify in the browser at narrow widths.

A full tab-strip collapse is meaningful design work — defer to a follow-up phase if necessary. For phase 3c:

- [ ] **Step 1: Confirm the simple stack works**

Open dev server (if available) and resize. At narrow widths the panels should stack in order: left col → center col → right col. That's acceptable for v1.

If you can't run the dev server in this environment, skip the manual check; the Tailwind grid syntax is correct.

- [ ] **Step 2: Commit nothing**

No code change for this task — it's a validation step. If the simple stack proved insufficient and required a real tab strip, that would be a follow-up phase, not part of 3c.

---

## Task 9: Full-suite verification

- [ ] **Step 1: Run everything**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm --filter @markettrader/frontend build
```

Expected: all PASS. Server tests unchanged at 237/237. Frontend tests should be roughly 126 (phase 3b end) + 4 (GameDetailPage) + 2 (JoinGameCard) + 1 (WatchlistPanel) + 2 (SelectedSymbolContext) + 1 (overlay) + 1 (TickerTape) − 3 (deleted SymbolSearchCard tests) = 134 total.

Exact count may differ slightly based on what other tests reference the deleted components. The important thing is all tests pass; the count is informational.

---

## Task 10: Final cross-cutting review and merge to `new-ui`

After verification, dispatch the final-review subagent and address any blockers. Then use the `finishing-a-development-branch` skill to merge into `new-ui`.

---

## What's NOT in this phase

- Full responsive tab-strip collapse (spec §4.2 medium/narrow breakpoints) — deferred to a follow-up phase if the simple stack proves insufficient.
- Real day-P&L computation for `PortfolioPanel` — needs server-side day-open snapshot infrastructure.
- Real `name` field on holdings (currently rendered as symbol again) — needs an extra server-side join. Phase 4+ will revisit.
- Real OHLC values for the OHLC strip — needs a chart-bar fetch that the current Stock provider doesn't expose. Renders dashes for v1.
- Activity feed showing OTHER players' trades — the current trade-history endpoint is per-user. Real cross-player activity needs a new endpoint or WS broadcast. Phase 4+.

---

## Self-Review

**1. Spec coverage** (§4.2):
- Three-pane grid ✓ Task 5
- Shared panel chrome ✓ (every panel uses Panel/PanelHeader/PanelBody from phase 1)
- LeaderboardPanel pinned current user ✓ phase 3b + Task 5 wiring
- PortfolioPanel 2×2 grid ✓ phase 3b + Task 5 wiring
- QuoteHeader sticky ✓ phase 3b + Task 5 wiring (CSS-wise sticky is via the grid; for v1 the panel just sits at the top of the center column)
- ChartPanel ✓ phase 3b + Task 5 wiring
- OHLC strip ✓ phase 3b + Task 5 wiring (renders dashes; real values deferred)
- HoldingsPanel click → context ✓ Task 5
- SymbolSearchPanel + cmd+k ✓ Task 5 + phase 3a (overlay) + Task 3 (in-game context write)
- WatchlistPanel + ADD ✓ Task 2
- ActivityPanel ✓ phase 3b + Task 5 wiring
- Removed components: YourProfileCard, AboutThisGameCard, SymbolSearchCard ✓ Task 6
- Interaction model: every clickable symbol writes context ✓ Tasks 3, 4, 5
- Responsive: simple stack at <lg ✓ Task 8 (full tab-strip collapse deferred)

**2. Placeholder scan:** none. Every step has runnable code. Deferred items in "What's NOT in this phase" are explicit, not TBDs in the code path.

**3. Type / API consistency:**
- `SelectedSymbolProvider` / `useSelectedSymbol` / `useSetSelectedSymbol` / new `useMaybeSetSelectedSymbol` — all from `@/contexts/SelectedSymbolContext`.
- `HoldingRow`, `WatchlistRow`, `ActivityEvent`, `LeaderboardEntry` — re-used from phase 3b's barrel.
- `TradeDirection` from `@markettrader/shared`.
- `usePortfolio`, `useTradeHistory`, `useGameSocket`, `useWatchlists` — existing hooks, unchanged signatures.

**4. Ambiguity check:** the deferred `TradeOrderDialog.initialDirection` prop is flagged as "verify by reading TradeOrderDialog.tsx; drop the prop if it doesn't exist" so the implementer doesn't paste a non-existent prop.
