# Phase 3a — Arena Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land three small, decoupled foundations that phase 3b/3c depend on: a `SelectedSymbolContext` shared across arena panels, a global `cmd+k` symbol-search overlay that less-technical users can also reach via a visible search panel, and a day-counter helper that replaces the `DAY 1 / 1` placeholder in `StatusStrip`.

**Architecture:** Three independent units shipped behind the existing `GameDetailPage`. `SelectedSymbolContext` is a small React context provider that lives where the arena will land. `SymbolSearch` is a single component with two rendering modes (pinned + overlay) wired to a shared global hotkey hook. `getDayCounter(startDate, endDate, now)` is a pure helper consumed by `AppShell`. Nothing in this phase visibly redesigns the arena — that comes in 3b/3c.

**Tech Stack:** React 19 + Context, Radix Dialog (already on board), keyboard-event listener at window level, Vitest + React Testing Library.

**Spec reference:** `docs/superpowers/specs/2026-05-15-terminal-design-refresh.md` — §4.2 (`SelectedSymbolContext`, `SymbolSearchPanel`/`SymbolSearchOverlay`/`useCommandK` from §6.3), §3.2 (`DAY n / N` cluster — the real values that replace the phase-2 placeholder).

**Branch & commit cadence:** Work happens on `feat/phase-3a-arena-foundation` (already created from `new-ui`). Each task ends with a focused commit. Merge into `new-ui` after Task 6.

---

## Task 0: Confirm branch state

- [ ] **Step 1: Verify current branch and clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status --short
```

Expected: branch is `feat/phase-3a-arena-foundation`, status is clean.

- [ ] **Step 2: Verify phase 2 deliverables present**

```bash
ls packages/frontend/src/components/shell/
ls packages/server/src/ws/global-live-route.ts
```

Expected: `StatusStrip.tsx`, `TickerTape.tsx`, `AboutGameModal.tsx`, `index.ts` in the shell dir; the global-live-route file exists. If missing, you're on the wrong branch.

---

## File Structure

**Created (frontend):**
- `packages/frontend/src/contexts/SelectedSymbolContext.tsx` — context + provider + hook pair.
- `packages/frontend/src/lib/gameDay.ts` — pure `getDayCounter` helper.
- `packages/frontend/src/components/search/SymbolSearch.tsx` — the unified search component with `mode: 'pinned' | 'overlay'`. Wraps the existing typeahead logic, restyled with terminal chrome.
- `packages/frontend/src/components/search/SymbolSearchOverlay.tsx` — modal wrapper opened by `cmd+k`.
- `packages/frontend/src/components/search/index.ts` — barrel export.
- `packages/frontend/src/hooks/useCommandK.ts` — global keyboard listener that toggles overlay open.
- `packages/frontend/src/stores/commandKStore.ts` — Zustand store holding the overlay open state (so any component can open it, not just the overlay itself).
- `packages/frontend/tests/SelectedSymbolContext.test.tsx`
- `packages/frontend/tests/gameDay.test.ts`
- `packages/frontend/tests/SymbolSearch.test.tsx`
- `packages/frontend/tests/useCommandK.test.tsx`
- `packages/frontend/tests/commandKStore.test.ts`

**Modified (frontend):**
- `packages/frontend/src/components/AppShell.tsx` — render the `<SymbolSearchOverlay />` once at app shell level; mount `useCommandK()`; compute `dayCurrent/dayTotal` from `getDayCounter` so the status-strip placeholder goes away.
- `packages/frontend/src/components/shell/StatusStrip.tsx` — no logic change; the new values just flow through the existing `gameContext` prop.

**Untouched in this phase** (will be touched in 3b/3c):
- `packages/frontend/src/pages/GameDetailPage.tsx` — `SelectedSymbolContext` provider goes into the page in 3c, not here. Phase 3a only defines the context API and tests it standalone.
- `packages/frontend/src/components/SymbolSearchCard.tsx` — kept; gets deleted in 3c when the arena panels replace it.

---

## Task 1: `getDayCounter` helper — TDD

**Files:**
- Create: `packages/frontend/src/lib/gameDay.ts`
- Create: `packages/frontend/tests/gameDay.test.ts`

The helper converts a game's `startDate`, `endDate`, and a reference `now` into a `{ dayCurrent, dayTotal }` pair for display. Day 1 is the calendar day of `startDate`; days are counted inclusively.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/gameDay.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getDayCounter } from '@/lib/gameDay';

describe('getDayCounter', () => {
  it('returns day 1 / N at the moment a game starts', () => {
    const result = getDayCounter(
      '2026-05-12T13:30:00Z',
      '2026-05-25T20:00:00Z',
      new Date('2026-05-12T13:30:00Z'),
    );
    expect(result.dayCurrent).toBe(1);
    expect(result.dayTotal).toBe(14);
  });

  it('returns day 4 / 14 four days into a fourteen-day game', () => {
    const result = getDayCounter(
      '2026-05-12T00:00:00Z',
      '2026-05-25T23:59:59Z',
      new Date('2026-05-15T18:00:00Z'),
    );
    expect(result.dayCurrent).toBe(4);
    expect(result.dayTotal).toBe(14);
  });

  it('caps dayCurrent at dayTotal once the game has ended', () => {
    const result = getDayCounter(
      '2026-05-12T00:00:00Z',
      '2026-05-25T23:59:59Z',
      new Date('2026-06-01T00:00:00Z'),
    );
    expect(result.dayCurrent).toBe(14);
    expect(result.dayTotal).toBe(14);
  });

  it('returns day 1 / N if `now` is before the game starts', () => {
    const result = getDayCounter(
      '2026-05-12T00:00:00Z',
      '2026-05-25T00:00:00Z',
      new Date('2026-05-10T00:00:00Z'),
    );
    expect(result.dayCurrent).toBe(1);
    expect(result.dayTotal).toBe(14);
  });

  it('uses UTC day boundaries so timezone-quirky users still see the same counter', () => {
    // Pacific midnight on May 15 is 07:00 UTC May 15 — same UTC day as
    // start day + 3 since start.
    const result = getDayCounter(
      '2026-05-12T00:00:00Z',
      '2026-05-25T00:00:00Z',
      new Date('2026-05-15T07:00:00Z'),
    );
    expect(result.dayCurrent).toBe(4);
  });

  it('handles a one-day game', () => {
    const result = getDayCounter(
      '2026-05-12T00:00:00Z',
      '2026-05-12T23:59:59Z',
      new Date('2026-05-12T12:00:00Z'),
    );
    expect(result.dayCurrent).toBe(1);
    expect(result.dayTotal).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test, verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- gameDay.test
```

Expected: FAIL with "Cannot find module '@/lib/gameDay'".

- [ ] **Step 3: Implement**

Create `packages/frontend/src/lib/gameDay.ts`:

```ts
const MS_PER_DAY = 86_400_000;

export interface DayCounter {
  /** 1-indexed day number within the game window, clamped to [1, dayTotal]. */
  dayCurrent: number;
  /** Inclusive total number of days the game spans. */
  dayTotal: number;
}

/**
 * Converts a game window plus a reference time into a 1-indexed day counter
 * for display in the status strip. Day boundaries align to UTC midnight so
 * the counter doesn't drift across timezones.
 *
 * Before the game starts, returns day 1. After it ends, returns dayTotal.
 */
export function getDayCounter(
  startIso: string,
  endIso: string,
  now: Date,
): DayCounter {
  const startMs = Date.UTC(...utcParts(startIso));
  const endMs = Date.UTC(...utcParts(endIso));
  const nowMs = Date.UTC(...utcParts(now.toISOString()));

  const dayTotal = Math.max(1, Math.floor((endMs - startMs) / MS_PER_DAY) + 1);
  const rawCurrent = Math.floor((nowMs - startMs) / MS_PER_DAY) + 1;
  const dayCurrent = Math.min(Math.max(rawCurrent, 1), dayTotal);
  return { dayCurrent, dayTotal };
}

function utcParts(iso: string): [number, number, number] {
  const d = new Date(iso);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}
```

- [ ] **Step 4: Run the test, verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- gameDay.test
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/lib/gameDay.ts packages/frontend/tests/gameDay.test.ts
git commit -m "feat(frontend): getDayCounter helper for status strip day marker

UTC-aligned day boundaries with inclusive total. Day 1 is the calendar
day of startDate; clamps below 1 (pre-start) and at dayTotal (post-end)
so the status strip never shows a confusing 0/N or 17/14."
```

---

## Task 2: Wire `getDayCounter` into `AppShell`

**Files:**
- Modify: `packages/frontend/src/components/AppShell.tsx`

Currently AppShell hardcodes `dayCurrent: 1, dayTotal: 1` with a `TODO(phase-3)` marker. Replace it with the real computation.

- [ ] **Step 1: Read the current AppShell**

```bash
cat packages/frontend/src/components/AppShell.tsx
```

Confirm the TODO line and the `game.data?.startDate / endDate` are available on the returned game object (they are — see `GameWithLeaderboard`).

- [ ] **Step 2: Replace the placeholder**

Edit `packages/frontend/src/components/AppShell.tsx` so the `ctx` definition uses `getDayCounter`:

```tsx
import { Outlet, useParams } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader';
import { StatusStrip, TickerTape } from '@/components/shell';
import { useIndicesSocket } from '@/hooks/useIndicesSocket';
import { useGame } from '@/api/games';
import { getDayCounter } from '@/lib/gameDay';

/**
 * Three-row layout for every authenticated page: AppHeader on top,
 * StatusStrip below it, the routed page in the middle, and the
 * TickerTape pinned at the viewport bottom. Mounts a single
 * useIndicesSocket subscription that feeds the chrome rows.
 */
export function AppShell() {
  useIndicesSocket();
  const { gameId } = useParams();
  const game = useGame(gameId ?? '');

  const ctx =
    gameId && game.data
      ? {
          gameId,
          name: game.data.name,
          ...getDayCounter(game.data.startDate, game.data.endDate, new Date()),
        }
      : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <AppHeader />
      {...(ctx ? { gameContext: ctx } : {}) /* exactOptionalPropertyTypes */}
      <StatusStrip {...(ctx ? { gameContext: ctx } : {})} />
      <main className="flex-1">
        <Outlet />
      </main>
      <TickerTape />
    </div>
  );
}
```

Note: the `{...(ctx ? { gameContext: ctx } : {})}` conditional spread carried over from phase 2's `exactOptionalPropertyTypes` workaround. Keep it. Remove the inline JSX comment that contains the spread — that's a typo, not a real expression. The intended JSX:

```tsx
return (
  <div className="flex min-h-screen flex-col bg-bg text-text">
    <AppHeader />
    <StatusStrip {...(ctx ? { gameContext: ctx } : {})} />
    <main className="flex-1">
      <Outlet />
    </main>
    <TickerTape />
  </div>
);
```

The `TODO(phase-3)` block is gone.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @markettrader/frontend test
pnpm --filter @markettrader/frontend typecheck
```

Expected: PASS (68/68 — no test changes, just removed dead TODO).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/components/AppShell.tsx
git commit -m "feat(frontend): compute real DAY n/N in status strip

AppShell now derives the day counter from game.startDate/endDate via
getDayCounter instead of hardcoding 1/1. Removes the phase-2 TODO."
```

---

## Task 3: `SelectedSymbolContext` — TDD

**Files:**
- Create: `packages/frontend/src/contexts/SelectedSymbolContext.tsx`
- Create: `packages/frontend/tests/SelectedSymbolContext.test.tsx`

The context holds the currently-selected symbol for the arena's center column. Provider + two hooks: `useSelectedSymbol()` returns the current value (string | null), `useSetSelectedSymbol()` returns the setter. Splitting reads and writes lets consumers subscribe to only what they need (the setter never changes identity, so write-only consumers don't re-render on every selection change).

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/SelectedSymbolContext.test.tsx`:

```tsx
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import {
  SelectedSymbolProvider,
  useSelectedSymbol,
  useSetSelectedSymbol,
} from '@/contexts/SelectedSymbolContext';

function Reader() {
  const symbol = useSelectedSymbol();
  return <div data-testid="reader">{symbol ?? '(none)'}</div>;
}

function Writer({ next }: { next: string }) {
  const setSymbol = useSetSelectedSymbol();
  return (
    <button type="button" onClick={() => setSymbol(next)} data-testid="writer">
      set
    </button>
  );
}

describe('SelectedSymbolContext', () => {
  it('starts with no selected symbol by default', () => {
    render(
      <SelectedSymbolProvider>
        <Reader />
      </SelectedSymbolProvider>,
    );
    expect(screen.getByTestId('reader')).toHaveTextContent('(none)');
  });

  it('honors an `initial` prop on the provider', () => {
    render(
      <SelectedSymbolProvider initial="AAPL">
        <Reader />
      </SelectedSymbolProvider>,
    );
    expect(screen.getByTestId('reader')).toHaveTextContent('AAPL');
  });

  it('propagates writes from any consumer to every reader', async () => {
    const user = userEvent.setup();
    render(
      <SelectedSymbolProvider>
        <Reader />
        <Writer next="NVDA" />
      </SelectedSymbolProvider>,
    );
    expect(screen.getByTestId('reader')).toHaveTextContent('(none)');
    await user.click(screen.getByTestId('writer'));
    expect(screen.getByTestId('reader')).toHaveTextContent('NVDA');
  });

  it('uppercases the symbol on write', async () => {
    const user = userEvent.setup();
    render(
      <SelectedSymbolProvider>
        <Reader />
        <Writer next="aapl" />
      </SelectedSymbolProvider>,
    );
    await user.click(screen.getByTestId('writer'));
    expect(screen.getByTestId('reader')).toHaveTextContent('AAPL');
  });

  it('useSelectedSymbol throws when called outside the provider', () => {
    // Suppress React's error-boundary console noise for this assertion.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Reader />)).toThrow(/SelectedSymbolProvider/i);
    spy.mockRestore();
  });
});
```

The last test uses `vi` (the global from `vitest`). The import is `import { describe, it, expect, vi } from 'vitest'` — add `vi` to the named imports.

Fix the imports at the top of the test:

```ts
import { describe, it, expect, vi } from 'vitest';
```

- [ ] **Step 2: Run the test, verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- SelectedSymbolContext
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/frontend/src/contexts/SelectedSymbolContext.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

type SymbolReader = string | null;
type SymbolWriter = (next: string | null) => void;

const ReaderContext = createContext<SymbolReader | typeof MISSING>(undefined as never);
const WriterContext = createContext<SymbolWriter | typeof MISSING>(undefined as never);

const MISSING = Symbol('SelectedSymbolContext-missing');

export interface SelectedSymbolProviderProps {
  initial?: string | null;
  children: ReactNode;
}

/**
 * Shared state for the currently-selected symbol in the arena's center
 * column. Reads and writes are split into two contexts so write-only
 * consumers (e.g. clickable symbol chips) don't re-render on every
 * selection change.
 */
export function SelectedSymbolProvider({ initial = null, children }: SelectedSymbolProviderProps) {
  const [symbol, setSymbol] = useState<SymbolReader>(initial ? initial.toUpperCase() : null);
  const set = useCallback<SymbolWriter>((next) => {
    setSymbol(next === null ? null : next.toUpperCase());
  }, []);
  const writer = useMemo(() => set, [set]);
  return (
    <WriterContext.Provider value={writer}>
      <ReaderContext.Provider value={symbol}>{children}</ReaderContext.Provider>
    </WriterContext.Provider>
  );
}

/** Returns the currently-selected symbol (uppercase) or `null`. */
export function useSelectedSymbol(): SymbolReader {
  const value = useContext(ReaderContext);
  if (value === MISSING) {
    throw new Error('useSelectedSymbol must be used inside a SelectedSymbolProvider');
  }
  return value as SymbolReader;
}

/** Returns a stable setter for the selected symbol. */
export function useSetSelectedSymbol(): SymbolWriter {
  const value = useContext(WriterContext);
  if (value === MISSING) {
    throw new Error('useSetSelectedSymbol must be used inside a SelectedSymbolProvider');
  }
  return value as SymbolWriter;
}
```

- [ ] **Step 4: Run the test, verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- SelectedSymbolContext
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/contexts/SelectedSymbolContext.tsx packages/frontend/tests/SelectedSymbolContext.test.tsx
git commit -m "feat(frontend): SelectedSymbolContext for arena center column

Provider + split reader/writer hooks. Symbol is uppercased on write so
every chip click normalizes to a canonical form. Throws explicitly when
used outside the provider so misuse fails loud."
```

---

## Task 4: `commandKStore` + `useCommandK` — TDD

**Files:**
- Create: `packages/frontend/src/stores/commandKStore.ts`
- Create: `packages/frontend/src/hooks/useCommandK.ts`
- Create: `packages/frontend/tests/commandKStore.test.ts`
- Create: `packages/frontend/tests/useCommandK.test.tsx`

The store holds `open: boolean` + actions to set/toggle it. Splitting the store from the hook lets the pinned search component open the overlay programmatically (not just via keyboard), and lets the overlay close itself after a result is picked.

- [ ] **Step 1: Write the failing store test**

Create `packages/frontend/tests/commandKStore.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { useCommandKStore } from '@/stores/commandKStore';

describe('useCommandKStore', () => {
  beforeEach(() => {
    useCommandKStore.getState().close();
  });

  it('starts closed', () => {
    expect(useCommandKStore.getState().open).toBe(false);
  });

  it('open() sets open=true', () => {
    useCommandKStore.getState().open$();
    expect(useCommandKStore.getState().open).toBe(true);
  });

  it('close() sets open=false', () => {
    useCommandKStore.getState().open$();
    useCommandKStore.getState().close();
    expect(useCommandKStore.getState().open).toBe(false);
  });

  it('toggle() flips the state', () => {
    useCommandKStore.getState().toggle();
    expect(useCommandKStore.getState().open).toBe(true);
    useCommandKStore.getState().toggle();
    expect(useCommandKStore.getState().open).toBe(false);
  });
});
```

Note: `open` is a property name (the state value), but it's also a verb. Naming the action `open$` (with a trailing `$`) avoids the collision since `open` is already taken by the boolean. The hook (Task 5) will call `useCommandKStore.getState().open$()` to open the overlay. Alternative names like `show`/`reveal` are fine if the implementer prefers — pick one and use it consistently across the store and the hook.

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- commandKStore
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement the store**

Create `packages/frontend/src/stores/commandKStore.ts`:

```ts
import { create } from 'zustand';

interface CommandKState {
  /** Whether the cmd+k overlay is currently visible. */
  open: boolean;
  /** Opens the overlay. Named `open$` because `open` is the state field. */
  open$: () => void;
  /** Closes the overlay. */
  close: () => void;
  /** Flips the open state. Wired to the cmd+k / ctrl+k keyboard shortcut. */
  toggle: () => void;
}

/**
 * Zustand store backing the global cmd+k symbol-search overlay. Separated
 * from the React component so any component can open the overlay (the
 * pinned search panel does this via click) without prop-drilling.
 */
export const useCommandKStore = create<CommandKState>((set) => ({
  open: false,
  open$: () => set({ open: true }),
  close: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
```

- [ ] **Step 4: Verify store tests PASS**

```bash
pnpm --filter @markettrader/frontend test -- commandKStore
```

Expected: 4 tests pass.

- [ ] **Step 5: Write the failing useCommandK test**

Create `packages/frontend/tests/useCommandK.test.tsx`:

```tsx
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCommandK } from '@/hooks/useCommandK';
import { useCommandKStore } from '@/stores/commandKStore';

describe('useCommandK', () => {
  beforeEach(() => {
    useCommandKStore.getState().close();
  });

  function fireKey(key: string, metaKey = false, ctrlKey = false) {
    const event = new KeyboardEvent('keydown', { key, metaKey, ctrlKey });
    act(() => {
      window.dispatchEvent(event);
    });
  }

  it('toggles the overlay on cmd+k (metaKey)', () => {
    renderHook(() => useCommandK());
    fireKey('k', true, false);
    expect(useCommandKStore.getState().open).toBe(true);
    fireKey('k', true, false);
    expect(useCommandKStore.getState().open).toBe(false);
  });

  it('toggles the overlay on ctrl+k', () => {
    renderHook(() => useCommandK());
    fireKey('k', false, true);
    expect(useCommandKStore.getState().open).toBe(true);
  });

  it('ignores plain "k" without a modifier', () => {
    renderHook(() => useCommandK());
    fireKey('k', false, false);
    expect(useCommandKStore.getState().open).toBe(false);
  });

  it('closes the overlay on Escape when it is open', () => {
    renderHook(() => useCommandK());
    useCommandKStore.getState().open$();
    fireKey('Escape');
    expect(useCommandKStore.getState().open).toBe(false);
  });

  it('removes the listener on unmount', () => {
    const { unmount } = renderHook(() => useCommandK());
    unmount();
    fireKey('k', true, false);
    expect(useCommandKStore.getState().open).toBe(false);
  });
});
```

- [ ] **Step 6: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- useCommandK
```

Expected: FAIL — module missing.

- [ ] **Step 7: Implement the hook**

Create `packages/frontend/src/hooks/useCommandK.ts`:

```ts
import { useEffect } from 'react';
import { useCommandKStore } from '@/stores/commandKStore';

/**
 * Registers global keyboard shortcuts for the cmd+k overlay:
 * - `cmd+k` / `ctrl+k` toggles the overlay open/closed.
 * - `Escape` closes the overlay when it's open.
 *
 * Mounted once at AppShell level. Calls `e.preventDefault()` for both
 * shortcuts so the browser's default behavior (e.g. Chrome's address bar
 * focus on ctrl+k) doesn't fire alongside the overlay open.
 */
export function useCommandK(): void {
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      const isCommandK = e.key === 'k' && (e.metaKey || e.ctrlKey);
      if (isCommandK) {
        e.preventDefault();
        useCommandKStore.getState().toggle();
        return;
      }
      if (e.key === 'Escape' && useCommandKStore.getState().open) {
        e.preventDefault();
        useCommandKStore.getState().close();
      }
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, []);
}
```

- [ ] **Step 8: Verify hook tests PASS**

```bash
pnpm --filter @markettrader/frontend test -- useCommandK
```

Expected: 5 tests pass.

- [ ] **Step 9: Commit (store + hook together — they're the same unit conceptually)**

```bash
git add packages/frontend/src/stores/commandKStore.ts packages/frontend/src/hooks/useCommandK.ts packages/frontend/tests/commandKStore.test.ts packages/frontend/tests/useCommandK.test.tsx
git commit -m "feat(frontend): commandKStore + useCommandK hook for global ⌘K overlay

Zustand store holds the open boolean + open$/close/toggle actions
(open$ disambiguates from the boolean named open). useCommandK
registers a window keydown listener that toggles on cmd+k / ctrl+k
and closes on Escape. preventDefault() blocks Chrome's address-bar
focus on ctrl+k."
```

---

## Task 5: `SymbolSearch` component + `SymbolSearchOverlay` — TDD

**Files:**
- Create: `packages/frontend/src/components/search/SymbolSearch.tsx`
- Create: `packages/frontend/src/components/search/SymbolSearchOverlay.tsx`
- Create: `packages/frontend/src/components/search/index.ts`
- Create: `packages/frontend/tests/SymbolSearch.test.tsx`

`SymbolSearch` is the typeahead body — input + result list. It accepts an `onSelect(symbol: string)` callback. Two wrappers:
- `SymbolSearchOverlay` renders it inside a Radix Dialog opened by the `commandKStore`. After a result is picked, the overlay closes and the symbol is set in `SelectedSymbolContext` (if available) or navigated to `/symbols/:symbol` (if not).
- The pinned panel (built in 3b alongside the arena) will use `SymbolSearch` directly inside a `Panel`.

In phase 3a only the overlay is built; the pinned panel lives with the rest of the arena modules in 3b.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/SymbolSearch.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SymbolSearch } from '@/components/search/SymbolSearch';
import type React from 'react';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

vi.mock('@/api/stocks', () => ({
  useStockSearch: (query: string) => ({
    data: query
      ? [
          { symbol: 'AAPL', name: 'Apple Inc.' },
          { symbol: 'NVDA', name: 'Nvidia Corp.' },
        ]
      : [],
    isLoading: false,
    error: null,
  }),
}));

describe('SymbolSearch', () => {
  it('renders an input with the configured placeholder', () => {
    render(wrap(<SymbolSearch onSelect={() => {}} placeholder="▸ Search symbol..." />));
    expect(screen.getByPlaceholderText(/Search symbol/)).toBeInTheDocument();
  });

  it('shows the ⌘K hint when hintKbd is true', () => {
    render(wrap(<SymbolSearch onSelect={() => {}} hintKbd />));
    expect(screen.getByText('⌘K')).toBeInTheDocument();
  });

  it('does not show the ⌘K hint by default', () => {
    render(wrap(<SymbolSearch onSelect={() => {}} />));
    expect(screen.queryByText('⌘K')).toBeNull();
  });

  it('renders results when the query is non-empty', async () => {
    const user = userEvent.setup();
    render(wrap(<SymbolSearch onSelect={() => {}} />));
    await user.type(screen.getByRole('searchbox'), 'AA');
    expect(await screen.findByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
  });

  it('calls onSelect with the chosen symbol when a result is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(wrap(<SymbolSearch onSelect={onSelect} />));
    await user.type(screen.getByRole('searchbox'), 'AA');
    const row = await screen.findByText('AAPL');
    await user.click(row);
    expect(onSelect).toHaveBeenCalledWith('AAPL');
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- SymbolSearch
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `SymbolSearch`**

Create `packages/frontend/src/components/search/SymbolSearch.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useStockSearch } from '@/api/stocks';
import { cn } from '@/lib/utils';

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

export interface SymbolSearchProps {
  /** Called with the canonical (uppercase) symbol when a result is chosen. */
  onSelect: (symbol: string) => void;
  /** Input placeholder. */
  placeholder?: string;
  /** When true, renders a `⌘K` keyboard hint chip on the right. */
  hintKbd?: boolean;
  /** Auto-focus the input on mount (used by the overlay). */
  autoFocus?: boolean;
  className?: string;
}

/**
 * Typeahead symbol search. Two consumers: {@link SymbolSearchOverlay}
 * (cmd+k modal) and the in-arena pinned panel (phase 3b). The component
 * itself doesn't decide what to do with the chosen symbol — that's
 * `onSelect`'s job.
 */
export function SymbolSearch({
  onSelect,
  placeholder = 'Search symbol...',
  hintKbd = false,
  autoFocus = false,
  className,
}: SymbolSearchProps) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim(), 250);
  const results = useStockSearch(debounced);
  const showList = debounced.length > 0;

  return (
    <div className={cn('w-full', className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted"
          aria-hidden
        />
        <input
          type="search"
          role="searchbox"
          aria-label="Symbol search"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 w-full rounded-chip border border-hairline-strong bg-panel pl-7 pr-12 font-mono text-xs text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          autoComplete="off"
        />
        {hintKbd ? (
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-chip border border-hairline-strong bg-bg px-1.5 py-0.5 font-mono text-[10px] text-muted">
            ⌘K
          </kbd>
        ) : null}
      </div>
      {showList ? (
        <ul className="mt-1 max-h-72 overflow-y-auto rounded-chip border border-hairline-strong bg-panel">
          {(results.data ?? []).map((r) => (
            <li key={r.symbol}>
              <button
                type="button"
                onClick={() => onSelect(r.symbol.toUpperCase())}
                className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-xs hover:bg-hairline"
              >
                <span className="font-mono text-accent">{r.symbol}</span>
                <span className="text-muted">{r.name}</span>
              </button>
            </li>
          ))}
          {(results.data?.length ?? 0) === 0 && !results.isLoading ? (
            <li className="px-2 py-1.5 text-xs text-muted">No matches.</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Implement `SymbolSearchOverlay`**

Create `packages/frontend/src/components/search/SymbolSearchOverlay.tsx`:

```tsx
import { useNavigate, useParams } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { SymbolSearch } from './SymbolSearch';
import { useCommandKStore } from '@/stores/commandKStore';

/**
 * Modal wrapper around {@link SymbolSearch} opened by cmd+k. Mounted once
 * at AppShell level. On result selection:
 *  - If we're inside `/games/:gameId`, the symbol could be set in the
 *    arena's SelectedSymbolContext — but that context only exists when the
 *    arena is mounted (phase 3b/3c). For phase 3a we navigate to
 *    `/symbols/:symbol` in both cases. Phase 3c will swap the in-game path
 *    to a context write so the user stays in the arena.
 */
export function SymbolSearchOverlay() {
  const open = useCommandKStore((s) => s.open);
  const close = useCommandKStore((s) => s.close);
  const navigate = useNavigate();
  // useParams is read at render time; safe regardless of route.
  const params = useParams();

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent className="max-w-lg">
        <SymbolSearch
          autoFocus
          placeholder="Search symbol..."
          onSelect={(symbol) => {
            close();
            navigate(`/symbols/${symbol}`);
          }}
        />
        <div className="mt-2 flex justify-between text-[10px] text-muted">
          <span>↵ to open · Esc to close</span>
          {params.gameId ? <span>In game: {params.gameId}</span> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Barrel export**

Create `packages/frontend/src/components/search/index.ts`:

```ts
export { SymbolSearch, type SymbolSearchProps } from './SymbolSearch';
export { SymbolSearchOverlay } from './SymbolSearchOverlay';
```

- [ ] **Step 6: Verify the SymbolSearch tests pass**

```bash
pnpm --filter @markettrader/frontend test -- SymbolSearch
```

Expected: 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/components/search packages/frontend/tests/SymbolSearch.test.tsx
git commit -m "feat(frontend): SymbolSearch + SymbolSearchOverlay

Reusable typeahead component with two consumers — the cmd+k overlay
(this phase) and the in-arena pinned search panel (phase 3b). Overlay
navigates to /symbols/:symbol on select for now; phase 3c swaps the
in-game path to a SelectedSymbolContext write."
```

---

## Task 6: Mount the overlay + the hotkey hook in `AppShell`

**Files:**
- Modify: `packages/frontend/src/components/AppShell.tsx`

- [ ] **Step 1: Wire `SymbolSearchOverlay` and `useCommandK` into the shell**

Edit `packages/frontend/src/components/AppShell.tsx`:

```tsx
import { Outlet, useParams } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader';
import { StatusStrip, TickerTape } from '@/components/shell';
import { SymbolSearchOverlay } from '@/components/search';
import { useIndicesSocket } from '@/hooks/useIndicesSocket';
import { useCommandK } from '@/hooks/useCommandK';
import { useGame } from '@/api/games';
import { getDayCounter } from '@/lib/gameDay';

/**
 * Three-row layout for every authenticated page: AppHeader on top,
 * StatusStrip below it, the routed page in the middle, and the
 * TickerTape pinned at the viewport bottom. Mounts a single
 * useIndicesSocket subscription and the global cmd+k hotkey + overlay.
 */
export function AppShell() {
  useIndicesSocket();
  useCommandK();
  const { gameId } = useParams();
  const game = useGame(gameId ?? '');

  const ctx =
    gameId && game.data
      ? {
          gameId,
          name: game.data.name,
          ...getDayCounter(game.data.startDate, game.data.endDate, new Date()),
        }
      : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <AppHeader />
      <StatusStrip {...(ctx ? { gameContext: ctx } : {})} />
      <main className="flex-1">
        <Outlet />
      </main>
      <TickerTape />
      <SymbolSearchOverlay />
    </div>
  );
}
```

- [ ] **Step 2: Run the full frontend suite + typecheck + lint + build**

```bash
pnpm --filter @markettrader/frontend test
pnpm typecheck
pnpm --filter @markettrader/frontend lint
pnpm --filter @markettrader/frontend build
```

Expected counts after this phase:
- 89/89 tests (was 68 + 6 gameDay + 5 SelectedSymbolContext + 4 commandKStore + 5 useCommandK + 5 SymbolSearch = 93; if Task 2 had no test changes that's 68 + 6 + 5 + 4 + 5 + 5 = 93). Adjust the expected count based on what you actually see — the important thing is all tests pass.

Build PASS, typecheck PASS, lint PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/AppShell.tsx
git commit -m "feat(frontend): mount cmd+k overlay + hotkey in AppShell

useCommandK registers the global hotkey; SymbolSearchOverlay renders
once at the shell level so cmd+k from anywhere opens it. Result
selection navigates to /symbols/:symbol; phase 3c will additionally
route into SelectedSymbolContext when the arena is mounted."
```

---

## Task 7: Full-suite verification

- [ ] **Step 1: Run the entire workspace**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm --filter @markettrader/frontend build
pnpm --filter @markettrader/server build
```

All PASS. The frontend test count should be 93/93 (68 from phase 2 + 25 new across the five new test files). Server tests unchanged at 237/237 (no server work in this phase).

- [ ] **Step 2: Manual smoke check (optional, only if running dev is permitted)**

Open http://localhost:5173 logged in, press ⌘K — overlay opens. Type "AA" → AAPL row appears. Click → navigates to `/symbols/AAPL`. Press ⌘K again → overlay opens. Press Esc → closes. Open a game → status strip's right cluster shows `DAY n / N · <Game name>` with a real day number instead of `1 / 1`.

---

## What's NOT in this phase

Deferred to phase 3b/3c:
- The arena's seven panels (Leaderboard, Portfolio, QuoteHeader, ChartPanel, Holdings, Watchlist, Activity, SymbolSearchPanel) — phase 3b.
- The `GameDetailPage` rewrite to the three-pane grid + responsive collapse — phase 3c.
- Deletion of `YourProfileCard`, `AboutThisGameCard`, `SymbolSearchCard` — phase 3c.
- Wiring the ticker tape's in-game click into `SelectedSymbolContext` — phase 3c (`TickerTape.tsx` currently does nothing on in-game clicks; phase 3c writes the symbol into the context).
- Replacing the overlay's "navigate to /symbols/:symbol" path with a context write when inside `/games/:gameId` — phase 3c.

---

## Self-Review

**1. Spec coverage:**
- `SelectedSymbolContext` (§4.2) → Task 3.
- `cmd+k` global shortcut + visible search panel (§4.2 + user request) → Task 5 (overlay) + Task 4 (hotkey). The visible panel itself lives with the arena in 3b — phase 3a only ships the overlay so the hotkey works.
- Real `DAY n/N` (§3.2) → Task 1 + Task 2.

**2. Placeholder scan:** None. Each task has full code; the deferred items in "What's NOT in this phase" are explicit, not TBDs.

**3. Type / API consistency:**
- `SelectedSymbolProvider` / `useSelectedSymbol` / `useSetSelectedSymbol` named consistently across context file, test, and overlay comments.
- `useCommandKStore` exposes `open` (boolean) + `open$` / `close` / `toggle` consistently across the store, the hook, the overlay, and both tests.
- `getDayCounter(startIso, endIso, now)` signature matches across `gameDay.ts` and `AppShell.tsx`.
- The `SymbolSearchProps` shape (`onSelect`, `placeholder`, `hintKbd`, `autoFocus`, `className`) matches between component and test.

**4. Ambiguity check:** The phase-3a→3c handoff for the overlay-vs-context decision is explicit: "phase 3c will swap the in-game path to a context write" appears in both `SymbolSearchOverlay`'s JSDoc and the final task notes.
