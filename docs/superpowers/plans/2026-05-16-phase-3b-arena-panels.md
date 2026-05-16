# Phase 3b — Arena Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the nine arena panel components as standalone units, each TDD'd in isolation. Compose them via `GameDetailPage` in phase 3c.

**Architecture:** Each panel is a self-contained React component living under `packages/frontend/src/components/game/arena/`, wrapped in the shared `Panel` primitive from phase 1. Most read from existing API hooks and the new `SelectedSymbolContext` from phase 3a. No `GameDetailPage` changes here — the existing card-stack layout keeps rendering until 3c.

**Tech Stack:** React 19, Tailwind 3.4 (using phase-1 tokens + phase-1 `Panel` primitive), React Query v5, Zustand, Vitest + RTL.

**Spec reference:** `docs/superpowers/specs/2026-05-15-terminal-design-refresh.md` §4.2 — Left column (`LeaderboardPanel`, `PortfolioPanel`), Center column (`QuoteHeader`, `ChartPanel`, OHLC strip, `HoldingsPanel`), Right column (`SymbolSearchPanel`, `WatchlistPanel`, `ActivityPanel`).

**Branch & commit cadence:** Work happens on `feat/phase-3b-arena-panels` (already created from `new-ui`). One panel = one TDD task = one commit. Merge into `new-ui` after Task 10 (final verification).

---

## Task 0: Confirm branch state

- [ ] **Step 1: Verify current branch and clean tree**

```bash
git rev-parse --abbrev-ref HEAD
git status --short
```

Expected: branch is `feat/phase-3b-arena-panels`, status is clean. If you're on a different branch, switch (`git checkout feat/phase-3b-arena-panels`).

- [ ] **Step 2: Verify phase 3a deliverables present**

```bash
ls packages/frontend/src/contexts/SelectedSymbolContext.tsx
ls packages/frontend/src/lib/gameDay.ts
ls packages/frontend/src/components/search/SymbolSearch.tsx
```

Expected: all three files exist. If missing, you're on the wrong branch.

---

## File Structure

**Created (frontend):**
- `packages/frontend/src/components/game/arena/LeaderboardPanel.tsx`
- `packages/frontend/src/components/game/arena/PortfolioPanel.tsx`
- `packages/frontend/src/components/game/arena/QuoteHeader.tsx`
- `packages/frontend/src/components/game/arena/ChartPanel.tsx`
- `packages/frontend/src/components/game/arena/OhlcStrip.tsx`
- `packages/frontend/src/components/game/arena/HoldingsPanel.tsx`
- `packages/frontend/src/components/game/arena/SymbolSearchPanel.tsx`
- `packages/frontend/src/components/game/arena/WatchlistPanel.tsx`
- `packages/frontend/src/components/game/arena/ActivityPanel.tsx`
- `packages/frontend/src/components/game/arena/index.ts` — barrel
- A test file in `packages/frontend/tests/` for each panel.

**Untouched** (changed in 3c, not here):
- `packages/frontend/src/pages/GameDetailPage.tsx` — keeps current card-stack.
- All existing `components/game/*.tsx` files — kept; deleted in 3c.
- `packages/frontend/src/components/AppShell.tsx` — already correct from 3a.

---

## Shared Conventions

Every panel:
- Wraps content in `<Panel>` + `<PanelHeader>` + `<PanelBody>` from phase 1.
- Mono uppercase label in `PanelHeader`.
- Tabular numerics via the `font-mono` class from phase 1.
- P&L colors: positive uses `text-gain`, negative uses `text-loss`. Never the accent.
- Symbol chips: `text-accent font-mono` with `hover:bg-hairline` if clickable.
- Compact density: panel body padding from phase 1 default (`px-2.5 py-2`).
- Each panel accepts the data it needs as props OR reads from a context/hook — both are fine; pick what fits each panel.

Test setup helper (used by most panel tests) — declared inline in each test or extracted if you prefer:

```tsx
function wrap(ui: React.ReactElement, qcSetup?: (qc: QueryClient) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qcSetup?.(qc);
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}
```

---

## Task 1: LeaderboardPanel

**Files:**
- Create: `packages/frontend/src/components/game/arena/LeaderboardPanel.tsx`
- Create: `packages/frontend/tests/LeaderboardPanel.test.tsx`

Columns: rank · player · value · P&L%. Current user's row marked with a 2px accent left border + `bg-accent/8` tint.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';
import { LeaderboardPanel } from '@/components/game/arena/LeaderboardPanel';
import { useAuthStore } from '@/stores/authStore';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

const ENTRIES = [
  { playerId: 'u1', username: 'marcus', rank: 1, totalValue: 128430.55, cashBalance: 4210 },
  { playerId: 'u2', username: 'tristan', rank: 2, totalValue: 118902.14, cashBalance: 12402 },
  { playerId: 'u3', username: 'jules', rank: 3, totalValue: 96210.00, cashBalance: 8100 },
];

describe('LeaderboardPanel', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: 't',
      user: { id: 'u2', username: 'tristan', groups: [] },
    });
  });

  it('renders each entry with rank, username, value, and P&L%', () => {
    render(wrap(<LeaderboardPanel entries={ENTRIES} startingBalance={100000} />));
    expect(screen.getByText('marcus')).toBeInTheDocument();
    expect(screen.getByText('tristan')).toBeInTheDocument();
    expect(screen.getByText('jules')).toBeInTheDocument();
    expect(screen.getByText('+28.43%')).toBeInTheDocument();
    expect(screen.getByText('+18.90%')).toBeInTheDocument();
    expect(screen.getByText(/−3\.79%/)).toBeInTheDocument(); // unicode minus
  });

  it('marks the current user row with data-current-user', () => {
    render(wrap(<LeaderboardPanel entries={ENTRIES} startingBalance={100000} />));
    const rows = screen.getAllByRole('listitem');
    const me = rows.find((r) => r.getAttribute('data-current-user') === 'true');
    expect(me).toBeDefined();
    expect(me!.textContent).toContain('tristan');
  });

  it('renders a LIVE indicator in the header', () => {
    render(wrap(<LeaderboardPanel entries={ENTRIES} startingBalance={100000} />));
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('renders an empty state when there are no entries', () => {
    render(wrap(<LeaderboardPanel entries={[]} startingBalance={100000} />));
    expect(screen.getByText(/no players/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- LeaderboardPanel
```

- [ ] **Step 3: Implement**

```tsx
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';

export interface LeaderboardEntry {
  playerId: string;
  username: string;
  rank: number;
  totalValue: number;
  cashBalance: number;
}

export interface LeaderboardPanelProps {
  entries: LeaderboardEntry[];
  startingBalance: number;
  className?: string;
}

/**
 * Left-column arena panel showing all players ranked by portfolio value.
 * The current user's row is marked with `data-current-user` and a 2px
 * accent left border so it stays findable as ranks shift.
 */
export function LeaderboardPanel({ entries, startingBalance, className }: LeaderboardPanelProps) {
  const userId = useAuthStore((s) => s.user?.id);

  return (
    <Panel className={className}>
      <PanelHeader
        right={
          <span className="rounded-chip bg-accent-bg px-1.5 py-0.5 text-[9px] tracking-[0.14em] text-accent">
            ● LIVE
          </span>
        }
      >
        Leaderboard
      </PanelHeader>
      <PanelBody>
        {entries.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted">No players yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {entries.map((e) => {
              const pnl = startingBalance > 0
                ? ((e.totalValue - startingBalance) / startingBalance) * 100
                : 0;
              const isMe = e.playerId === userId;
              return (
                <li
                  key={e.playerId}
                  data-current-user={isMe ? 'true' : undefined}
                  className={cn(
                    'grid grid-cols-[24px_1fr_auto_auto] items-baseline gap-3 py-1 text-xs',
                    isMe && 'relative pl-2 bg-accent-bg/40 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-accent',
                  )}
                >
                  <span className="font-mono text-[10px] text-muted">
                    {String(e.rank).padStart(2, '0')}
                  </span>
                  <span className={cn('font-medium', isMe ? 'text-text-strong' : 'text-text')}>
                    {e.username}
                  </span>
                  <span className="font-mono text-text">{formatUsd(e.totalValue)}</span>
                  <span className={cn('font-mono', pnl >= 0 ? 'text-gain' : 'text-loss')}>
                    {formatPnl(pnl)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function formatUsd(n: number): string {
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)}`;
}
function formatPnl(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- LeaderboardPanel
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/game/arena/LeaderboardPanel.tsx packages/frontend/tests/LeaderboardPanel.test.tsx
git commit -m "feat(frontend): LeaderboardPanel arena module

Left-column panel: rank · player · value · P&L%. Current user row
marked with data-current-user attribute, 2px accent left border, and
accent-bg tint so it stays findable as ranks shift. Phase 3c wires
it into GameDetailPage."
```

---

## Task 2: PortfolioPanel

**Files:**
- Create: `packages/frontend/src/components/game/arena/PortfolioPanel.tsx`
- Create: `packages/frontend/tests/PortfolioPanel.test.tsx`

2×2 stat grid: Value · P&L% · Cash · Day.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PortfolioPanel } from '@/components/game/arena/PortfolioPanel';

describe('PortfolioPanel', () => {
  it('renders all four stats with values', () => {
    render(
      <PortfolioPanel
        value={118902.14}
        pnlPct={18.9}
        cash={12402}
        dayPnl={1204.18}
      />,
    );
    expect(screen.getByText('$118,902.14')).toBeInTheDocument();
    expect(screen.getByText('+18.90%')).toBeInTheDocument();
    expect(screen.getByText('$12,402.00')).toBeInTheDocument();
    expect(screen.getByText('+$1,204.18')).toBeInTheDocument();
  });

  it('uses gain color when P&L is positive', () => {
    render(<PortfolioPanel value={100} pnlPct={5} cash={0} dayPnl={1} />);
    expect(screen.getByText('+5.00%').className).toMatch(/text-gain/);
    expect(screen.getByText('+$1.00').className).toMatch(/text-gain/);
  });

  it('uses loss color when P&L is negative', () => {
    render(<PortfolioPanel value={100} pnlPct={-5} cash={0} dayPnl={-1} />);
    expect(screen.getByText('−5.00%').className).toMatch(/text-loss/);
    expect(screen.getByText('−$1.00').className).toMatch(/text-loss/);
  });

  it('renders the panel header label "Your portfolio"', () => {
    render(<PortfolioPanel value={100} pnlPct={0} cash={0} dayPnl={0} />);
    expect(screen.getByText(/your portfolio/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- PortfolioPanel
```

- [ ] **Step 3: Implement**

```tsx
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { cn } from '@/lib/utils';

export interface PortfolioPanelProps {
  value: number;
  pnlPct: number;
  cash: number;
  dayPnl: number;
  className?: string;
}

/** Left-column compact 2×2 stat grid: portfolio value / P&L / cash / day P&L. */
export function PortfolioPanel({ value, pnlPct, cash, dayPnl, className }: PortfolioPanelProps) {
  return (
    <Panel className={className}>
      <PanelHeader>Your portfolio</PanelHeader>
      <PanelBody>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Stat label="Value" value={formatUsd(value)} />
          <Stat label="P&L" value={formatPct(pnlPct)} tone={pnlPct >= 0 ? 'gain' : 'loss'} />
          <Stat label="Cash" value={formatUsd(cash)} dim />
          <Stat label="Day" value={formatDayPnl(dayPnl)} tone={dayPnl >= 0 ? 'gain' : 'loss'} />
        </div>
      </PanelBody>
    </Panel>
  );
}

function Stat({
  label,
  value,
  tone,
  dim,
}: {
  label: string;
  value: string;
  tone?: 'gain' | 'loss';
  dim?: boolean;
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.16em] text-muted">{label}</div>
      <div
        className={cn(
          'font-mono text-sm font-semibold',
          tone === 'gain' && 'text-gain',
          tone === 'loss' && 'text-loss',
          dim && 'text-muted',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
function formatPct(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
function formatDayPnl(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- PortfolioPanel
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/game/arena/PortfolioPanel.tsx packages/frontend/tests/PortfolioPanel.test.tsx
git commit -m "feat(frontend): PortfolioPanel arena module

Left-column 2x2 stat grid: Value, P&L%, Cash, Day. P&L and Day tinted
gain/loss; Cash dimmed since it's reference-only. All numbers mono."
```

---

## Task 3: QuoteHeader

**Files:**
- Create: `packages/frontend/src/components/game/arena/QuoteHeader.tsx`
- Create: `packages/frontend/tests/QuoteHeader.test.tsx`

`[SYM big mono] [LAST big mono] [Δabs Δ%] [BUY] [SELL]`. BUY = solid accent (`bg-accent text-bg`). SELL = outlined loss (`border-loss text-loss`). Both call `onTrade(direction)` so the parent (3c GameDetailPage) opens the TradeOrderDialog.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QuoteHeader } from '@/components/game/arena/QuoteHeader';

describe('QuoteHeader', () => {
  it('renders the symbol, last price, and percent change', () => {
    render(<QuoteHeader symbol="AAPL" last={189.42} changeAbs={1.57} changePct={0.84} />);
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('189.42')).toBeInTheDocument();
    expect(screen.getByText('+0.84%')).toBeInTheDocument();
  });

  it('shows BUY and SELL buttons that call onTrade with direction', async () => {
    const user = userEvent.setup();
    const onTrade = vi.fn();
    render(<QuoteHeader symbol="AAPL" last={189} changeAbs={0} changePct={0} onTrade={onTrade} />);
    await user.click(screen.getByRole('button', { name: /buy/i }));
    expect(onTrade).toHaveBeenLastCalledWith('buy');
    await user.click(screen.getByRole('button', { name: /sell/i }));
    expect(onTrade).toHaveBeenLastCalledWith('sell');
  });

  it('shows an empty-state when no symbol is selected', () => {
    render(<QuoteHeader symbol={null} />);
    expect(screen.getByText(/select a symbol/i)).toBeInTheDocument();
  });

  it('disables the BUY/SELL buttons when onTrade is not provided', () => {
    render(<QuoteHeader symbol="AAPL" last={1} changeAbs={0} changePct={0} />);
    expect(screen.getByRole('button', { name: /buy/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /sell/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- QuoteHeader
```

- [ ] **Step 3: Implement**

```tsx
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { cn } from '@/lib/utils';
import type { TradeDirection } from '@markettrader/shared';

export interface QuoteHeaderProps {
  symbol: string | null;
  last?: number;
  changeAbs?: number;
  changePct?: number;
  onTrade?: (direction: TradeDirection) => void;
  className?: string;
}

/**
 * Center-column quote strip: big symbol + price + delta + BUY/SELL.
 * When no symbol is selected, renders an empty-state hint instead of
 * faking numbers. `onTrade` is optional — buttons disable if absent so
 * the panel still renders cleanly during loading.
 */
export function QuoteHeader({ symbol, last, changeAbs, changePct, onTrade, className }: QuoteHeaderProps) {
  if (!symbol) {
    return (
      <Panel className={className}>
        <PanelHeader>Quote</PanelHeader>
        <PanelBody>
          <p className="py-3 text-center text-xs text-muted">Select a symbol to see its quote.</p>
        </PanelBody>
      </Panel>
    );
  }

  const pos = (changePct ?? 0) >= 0;

  return (
    <Panel className={className}>
      <PanelHeader>Quote · {symbol}</PanelHeader>
      <PanelBody>
        <div className="grid grid-cols-[auto_auto_1fr_auto_auto] items-baseline gap-4">
          <span className="font-mono text-lg font-bold tracking-tight text-text-strong">{symbol}</span>
          {last !== undefined ? (
            <span className="font-mono text-xl font-semibold tracking-tight text-text-strong">
              {new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(last)}
            </span>
          ) : null}
          {changePct !== undefined ? (
            <span className={cn('font-mono text-xs', pos ? 'text-gain' : 'text-loss')}>
              {pos ? '+' : '−'}{Math.abs(changeAbs ?? 0).toFixed(2)} ({pos ? '+' : '−'}{Math.abs(changePct).toFixed(2)}%)
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onTrade?.('buy')}
            disabled={!onTrade}
            className="rounded-chip bg-accent px-3 py-1 font-mono text-xs font-bold tracking-[0.1em] text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            BUY
          </button>
          <button
            type="button"
            onClick={() => onTrade?.('sell')}
            disabled={!onTrade}
            className="rounded-chip border border-loss px-3 py-1 font-mono text-xs font-bold tracking-[0.1em] text-loss hover:bg-loss/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            SELL
          </button>
        </div>
      </PanelBody>
    </Panel>
  );
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- QuoteHeader
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/game/arena/QuoteHeader.tsx packages/frontend/tests/QuoteHeader.test.tsx
git commit -m "feat(frontend): QuoteHeader arena module

Center-column sticky quote strip: symbol + last + delta + BUY/SELL.
Empty-state when no symbol is selected. Buttons disable when onTrade
isn't supplied so the panel renders cleanly during loading."
```

---

## Task 4: OhlcStrip

**Files:**
- Create: `packages/frontend/src/components/game/arena/OhlcStrip.tsx`
- Create: `packages/frontend/tests/OhlcStrip.test.tsx`

`O <open>   H <high>   L <low>   V <volume>`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { OhlcStrip } from '@/components/game/arena/OhlcStrip';

describe('OhlcStrip', () => {
  it('renders O / H / L / V values', () => {
    render(<OhlcStrip open={188.2} high={190.12} low={187.85} volume={42_300_000} />);
    expect(screen.getByText(/O/)).toBeInTheDocument();
    expect(screen.getByText('188.20')).toBeInTheDocument();
    expect(screen.getByText('190.12')).toBeInTheDocument();
    expect(screen.getByText('187.85')).toBeInTheDocument();
    expect(screen.getByText('42.30M')).toBeInTheDocument();
  });

  it('renders dashes when values are undefined', () => {
    render(<OhlcStrip />);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- OhlcStrip
```

- [ ] **Step 3: Implement**

```tsx
import { cn } from '@/lib/utils';

export interface OhlcStripProps {
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  className?: string;
}

/**
 * Compact mono strip below the chart showing open/high/low/volume for
 * the currently-selected symbol. Renders dashes for any field whose
 * value is undefined (e.g. loading state).
 */
export function OhlcStrip({ open, high, low, volume, className }: OhlcStripProps) {
  return (
    <div className={cn('flex gap-4 px-2.5 py-1.5 font-mono text-[10px] text-muted', className)}>
      <Item label="O" value={fmt(open)} />
      <Item label="H" value={fmt(high)} />
      <Item label="L" value={fmt(low)} />
      <Item label="V" value={fmtVolume(volume)} />
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-muted">{label}</span>{' '}
      <span className="text-text">{value}</span>
    </span>
  );
}

function fmt(n?: number): string {
  if (n === undefined) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtVolume(n?: number): string {
  if (n === undefined) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- OhlcStrip
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/game/arena/OhlcStrip.tsx packages/frontend/tests/OhlcStrip.test.tsx
git commit -m "feat(frontend): OhlcStrip arena module

Compact mono row of O/H/L/V values that sits below the chart. Renders
dashes for undefined fields so it stays stable during loading. Volume
formatted in compact notation (K/M/B)."
```

---

## Task 5: ChartPanel

**Files:**
- Create: `packages/frontend/src/components/game/arena/ChartPanel.tsx`
- Create: `packages/frontend/tests/ChartPanel.test.tsx`

Wraps the existing `StockChart` in panel chrome. Accepts a `symbol` prop. Renders a placeholder when no symbol is provided. Does NOT restyle the chart's internals here — that's a bigger task; phase 3c can revisit chart colors if needed.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type React from 'react';

vi.mock('@/components/StockChart', () => ({
  StockChart: ({ symbols }: { symbols: string[] }) => (
    <div data-testid="stockchart">chart for {symbols.join(',') || '(none)'}</div>
  ),
}));

import { ChartPanel } from '@/components/game/arena/ChartPanel';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

describe('ChartPanel', () => {
  it('renders the StockChart with the given symbol when present', () => {
    render(wrap(<ChartPanel symbol="AAPL" />));
    expect(screen.getByTestId('stockchart')).toHaveTextContent('AAPL');
  });

  it('renders an empty-state when symbol is null', () => {
    render(wrap(<ChartPanel symbol={null} />));
    expect(screen.queryByTestId('stockchart')).toBeNull();
    expect(screen.getByText(/select a symbol/i)).toBeInTheDocument();
  });

  it('renders a panel header "Chart"', () => {
    render(wrap(<ChartPanel symbol="AAPL" />));
    expect(screen.getByText(/chart/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- ChartPanel
```

- [ ] **Step 3: Implement**

```tsx
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { StockChart } from '@/components/StockChart';

export interface ChartPanelProps {
  symbol: string | null;
  className?: string;
}

/**
 * Center-column chart wrapper. Phase 3b ships the chrome only — the
 * underlying StockChart keeps its current visual style. Phase 3c can
 * revisit chart colors if needed.
 */
export function ChartPanel({ symbol, className }: ChartPanelProps) {
  return (
    <Panel className={className}>
      <PanelHeader>Chart{symbol ? ` · ${symbol}` : ''}</PanelHeader>
      <PanelBody>
        {symbol ? (
          <StockChart symbols={[symbol]} />
        ) : (
          <p className="py-6 text-center text-xs text-muted">Select a symbol to see its chart.</p>
        )}
      </PanelBody>
    </Panel>
  );
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- ChartPanel
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/game/arena/ChartPanel.tsx packages/frontend/tests/ChartPanel.test.tsx
git commit -m "feat(frontend): ChartPanel arena module

Wraps the existing StockChart in panel chrome. Empty-state when no
symbol is selected. Chart internals (colors, axis style) deliberately
unchanged — phase 3c can revisit if needed."
```

---

## Task 6: HoldingsPanel

**Files:**
- Create: `packages/frontend/src/components/game/arena/HoldingsPanel.tsx`
- Create: `packages/frontend/tests/HoldingsPanel.test.tsx`

Columns: symbol · qty · avg cost · market value · P&L%. Each row click calls `onSelect(symbol)` (the GameDetailPage in 3c wires this to `SelectedSymbolContext`).

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { HoldingsPanel, type HoldingRow } from '@/components/game/arena/HoldingsPanel';

const ROWS: HoldingRow[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', quantity: 120, avgCost: 175, marketValue: 22730.4, pnlPct: 8.24 },
  { symbol: 'NVDA', name: 'Nvidia', quantity: 40, avgCost: 950, marketValue: 47132, pnlPct: 24.03 },
];

describe('HoldingsPanel', () => {
  it('renders one row per holding with all columns', () => {
    render(<HoldingsPanel rows={ROWS} />);
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('NVDA')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('+8.24%')).toBeInTheDocument();
    expect(screen.getByText('+24.03%')).toBeInTheDocument();
  });

  it('calls onSelect with the chosen symbol on row click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<HoldingsPanel rows={ROWS} onSelect={onSelect} />);
    await user.click(screen.getByText('NVDA'));
    expect(onSelect).toHaveBeenCalledWith('NVDA');
  });

  it('renders an empty state when there are no holdings', () => {
    render(<HoldingsPanel rows={[]} />);
    expect(screen.getByText(/no holdings/i)).toBeInTheDocument();
  });

  it('uses loss color for negative P&L', () => {
    render(<HoldingsPanel rows={[{ ...ROWS[0]!, pnlPct: -3.5 }]} />);
    expect(screen.getByText('−3.50%').className).toMatch(/text-loss/);
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- HoldingsPanel
```

- [ ] **Step 3: Implement**

```tsx
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { cn } from '@/lib/utils';

export interface HoldingRow {
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number;
  marketValue: number;
  pnlPct: number;
}

export interface HoldingsPanelProps {
  rows: HoldingRow[];
  onSelect?: (symbol: string) => void;
  className?: string;
}

/**
 * Center-column holdings table. Click a row → onSelect(symbol). The arena
 * (phase 3c) wires onSelect to SelectedSymbolContext so the chart and quote
 * header update in place.
 */
export function HoldingsPanel({ rows, onSelect, className }: HoldingsPanelProps) {
  return (
    <Panel className={className}>
      <PanelHeader>Holdings · {rows.length} positions</PanelHeader>
      <PanelBody>
        {rows.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted">No holdings yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-hairline text-[9px] uppercase tracking-[0.16em] text-muted">
                <th className="py-1 text-left font-medium">Symbol</th>
                <th className="text-right font-medium">Qty</th>
                <th className="text-right font-medium">Avg Cost</th>
                <th className="text-right font-medium">Value</th>
                <th className="text-right font-medium">P&L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.symbol}
                  onClick={onSelect ? () => onSelect(r.symbol) : undefined}
                  className={cn(
                    'border-b border-hairline last:border-0',
                    onSelect && 'cursor-pointer hover:bg-hairline',
                  )}
                >
                  <td className="py-1 font-mono text-accent">{r.symbol}</td>
                  <td className="text-right font-mono">{r.quantity}</td>
                  <td className="text-right font-mono text-muted">{fmt(r.avgCost)}</td>
                  <td className="text-right font-mono">{fmt(r.marketValue)}</td>
                  <td className={cn('text-right font-mono', r.pnlPct >= 0 ? 'text-gain' : 'text-loss')}>
                    {fmtPct(r.pnlPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelBody>
    </Panel>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- HoldingsPanel
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/game/arena/HoldingsPanel.tsx packages/frontend/tests/HoldingsPanel.test.tsx
git commit -m "feat(frontend): HoldingsPanel arena module

Center-column holdings table — clickable rows fire onSelect(symbol)
so the arena's quote header + chart update in place when wired by
phase 3c."
```

---

## Task 7: SymbolSearchPanel

**Files:**
- Create: `packages/frontend/src/components/game/arena/SymbolSearchPanel.tsx`
- Create: `packages/frontend/tests/SymbolSearchPanel.test.tsx`

Right-column pinned search input — wraps the phase-3a `SymbolSearch` in panel chrome, shows the `⌘K` hint. Calls `onSelect(symbol)` on result click. Clicking the pinned bar itself ALSO opens the cmd+k overlay (so less-technical users can reach the same overlay).

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useCommandKStore } from '@/stores/commandKStore';
import type React from 'react';

vi.mock('@/api/stocks', () => ({
  useStockSearch: () => ({ data: [], isLoading: false, error: null }),
}));

import { SymbolSearchPanel } from '@/components/game/arena/SymbolSearchPanel';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

describe('SymbolSearchPanel', () => {
  beforeEach(() => {
    useCommandKStore.getState().close();
  });

  it('renders the search input with the ⌘K hint', () => {
    render(wrap(<SymbolSearchPanel onSelect={() => {}} />));
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.getByText('⌘K')).toBeInTheDocument();
  });

  it('opens the cmd+k overlay when the input is focused', async () => {
    const user = userEvent.setup();
    render(wrap(<SymbolSearchPanel onSelect={() => {}} />));
    await user.click(screen.getByRole('searchbox'));
    expect(useCommandKStore.getState().open).toBe(true);
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- SymbolSearchPanel
```

- [ ] **Step 3: Implement**

```tsx
import { Panel, PanelBody } from '@/components/panel';
import { SymbolSearch } from '@/components/search';
import { useCommandKStore } from '@/stores/commandKStore';

export interface SymbolSearchPanelProps {
  onSelect: (symbol: string) => void;
  className?: string;
}

/**
 * Right-column pinned search input. The visible affordance — clicking or
 * focusing it opens the same global cmd+k overlay so non-power users have
 * a discoverable path to the typeahead. Direct `onSelect` calls from the
 * inline list still flow when the user just types into the panel.
 */
export function SymbolSearchPanel({ onSelect, className }: SymbolSearchPanelProps) {
  const openOverlay = useCommandKStore((s) => s.open$);

  return (
    <Panel className={className}>
      <PanelBody>
        <div onClick={openOverlay} onFocus={openOverlay}>
          <SymbolSearch
            placeholder="▸ Search symbol..."
            hintKbd
            onSelect={onSelect}
          />
        </div>
      </PanelBody>
    </Panel>
  );
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- SymbolSearchPanel
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/game/arena/SymbolSearchPanel.tsx packages/frontend/tests/SymbolSearchPanel.test.tsx
git commit -m "feat(frontend): SymbolSearchPanel arena module

Right-column pinned search input. Focusing/clicking the panel opens
the same global cmd+k overlay — discoverability for users who don't
know the keyboard shortcut."
```

---

## Task 8: WatchlistPanel

**Files:**
- Create: `packages/frontend/src/components/game/arena/WatchlistPanel.tsx`
- Create: `packages/frontend/tests/WatchlistPanel.test.tsx`

Right-column compact list of watchlist symbol chips. Each row: `<symbol> <last> <day%>`. Click → `onSelect(symbol)`. Existing watchlist API lives at `packages/frontend/src/api/watchlists.ts`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { WatchlistPanel, type WatchlistRow } from '@/components/game/arena/WatchlistPanel';

const ROWS: WatchlistRow[] = [
  { symbol: 'AAPL', last: 189.42, changePct: 0.84 },
  { symbol: 'NVDA', last: 1178.3, changePct: 2.41 },
  { symbol: 'TSLA', last: 241.05, changePct: -1.12 },
];

describe('WatchlistPanel', () => {
  it('renders each row with symbol, last, and change %', () => {
    render(<WatchlistPanel rows={ROWS} />);
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('189.42')).toBeInTheDocument();
    expect(screen.getByText('+0.84%')).toBeInTheDocument();
    expect(screen.getByText('−1.12%')).toBeInTheDocument();
  });

  it('calls onSelect with the chosen symbol on row click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<WatchlistPanel rows={ROWS} onSelect={onSelect} />);
    await user.click(screen.getByText('TSLA'));
    expect(onSelect).toHaveBeenCalledWith('TSLA');
  });

  it('renders an empty state when no rows', () => {
    render(<WatchlistPanel rows={[]} />);
    expect(screen.getByText(/empty/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- WatchlistPanel
```

- [ ] **Step 3: Implement**

```tsx
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { cn } from '@/lib/utils';

export interface WatchlistRow {
  symbol: string;
  last?: number;
  changePct?: number;
}

export interface WatchlistPanelProps {
  rows: WatchlistRow[];
  onSelect?: (symbol: string) => void;
  className?: string;
}

/**
 * Right-column compact watchlist. Each clickable row drives the arena's
 * SelectedSymbolContext (wired by phase 3c). The "+ ADD" action lives in
 * the panel header and is reserved for phase 3c.
 */
export function WatchlistPanel({ rows, onSelect, className }: WatchlistPanelProps) {
  return (
    <Panel className={className}>
      <PanelHeader>Watchlist</PanelHeader>
      <PanelBody>
        {rows.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted">Watchlist is empty.</p>
        ) : (
          <ul className="space-y-0.5">
            {rows.map((r) => (
              <li key={r.symbol}>
                <button
                  type="button"
                  onClick={onSelect ? () => onSelect(r.symbol) : undefined}
                  disabled={!onSelect}
                  className={cn(
                    'grid w-full grid-cols-[1fr_auto_auto] items-baseline gap-2 py-1 text-xs',
                    onSelect && 'cursor-pointer hover:bg-hairline',
                    !onSelect && 'cursor-default',
                  )}
                >
                  <span className="font-mono text-accent text-left">{r.symbol}</span>
                  <span className="font-mono text-text">{r.last !== undefined ? fmt(r.last) : '—'}</span>
                  <span
                    className={cn(
                      'font-mono',
                      r.changePct === undefined && 'text-muted',
                      r.changePct !== undefined && r.changePct >= 0 && 'text-gain',
                      r.changePct !== undefined && r.changePct < 0 && 'text-loss',
                    )}
                  >
                    {r.changePct === undefined ? '—' : fmtPct(r.changePct)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- WatchlistPanel
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/game/arena/WatchlistPanel.tsx packages/frontend/tests/WatchlistPanel.test.tsx
git commit -m "feat(frontend): WatchlistPanel arena module

Right-column compact list of watchlist quotes. Click → onSelect.
Empty state when watchlist has no entries. The +ADD affordance is
phase 3c (needs the editor flow)."
```

---

## Task 9: ActivityPanel

**Files:**
- Create: `packages/frontend/src/components/game/arena/ActivityPanel.tsx`
- Create: `packages/frontend/tests/ActivityPanel.test.tsx`

Terminal-style trade-activity feed: `HH:MM · <player> BUY|SELL N SYM @ price`. Player names in accent, BUY in gain, SELL in loss. Receives an `events` array prop (the GameDetailPage in 3c wires it from the existing trade-activity WS message).

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ActivityPanel, type ActivityEvent } from '@/components/game/arena/ActivityPanel';

const EVENTS: ActivityEvent[] = [
  { at: '2026-05-15T18:21:00Z', player: 'marcus', direction: 'buy', quantity: 50, symbol: 'NVDA', price: 1178.3 },
  { at: '2026-05-15T18:18:00Z', player: 'jules', direction: 'sell', quantity: 20, symbol: 'TSLA', price: 241.05 },
];

describe('ActivityPanel', () => {
  it('renders each event with HH:MM, player, direction, qty, symbol, and price', () => {
    render(<ActivityPanel events={EVENTS} />);
    expect(screen.getByText(/marcus/)).toBeInTheDocument();
    expect(screen.getByText(/jules/)).toBeInTheDocument();
    expect(screen.getByText(/BUY/)).toBeInTheDocument();
    expect(screen.getByText(/SELL/)).toBeInTheDocument();
    expect(screen.getByText(/NVDA/)).toBeInTheDocument();
    expect(screen.getByText(/1178\.30/)).toBeInTheDocument();
  });

  it('renders an empty state when there are no events', () => {
    render(<ActivityPanel events={[]} />);
    expect(screen.getByText(/no activity/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify FAIL**

```bash
pnpm --filter @markettrader/frontend test -- ActivityPanel
```

- [ ] **Step 3: Implement**

```tsx
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import type { TradeDirection } from '@markettrader/shared';
import { cn } from '@/lib/utils';

export interface ActivityEvent {
  at: string;
  player: string;
  direction: TradeDirection;
  quantity: number;
  symbol: string;
  price: number;
}

export interface ActivityPanelProps {
  events: ActivityEvent[];
  className?: string;
}

/**
 * Right-column terminal-style scrolling feed of trade events in the
 * current game. Player names in accent, BUY in gain, SELL in loss.
 * Times rendered in the user's local timezone as HH:MM.
 */
export function ActivityPanel({ events, className }: ActivityPanelProps) {
  return (
    <Panel className={className}>
      <PanelHeader>Activity</PanelHeader>
      <PanelBody>
        {events.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted">No activity yet.</p>
        ) : (
          <ul className="space-y-1 font-mono text-[11px]">
            {events.map((e, idx) => (
              <li
                key={`${e.at}-${idx}`}
                className="grid grid-cols-[auto_1fr] gap-2 border-b border-hairline pb-1 last:border-0 last:pb-0"
              >
                <span className="text-muted">{formatTime(e.at)}</span>
                <span className="text-text">
                  <span className="text-accent">{e.player}</span>{' '}
                  <span className={cn(e.direction === 'buy' ? 'text-gain' : 'text-loss')}>
                    {e.direction.toUpperCase()}
                  </span>{' '}
                  {e.quantity} {e.symbol} @ {e.price.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Verify PASS**

```bash
pnpm --filter @markettrader/frontend test -- ActivityPanel
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/game/arena/ActivityPanel.tsx packages/frontend/tests/ActivityPanel.test.tsx
git commit -m "feat(frontend): ActivityPanel arena module

Right-column terminal-style trade activity feed. Player names in
accent, BUY in gain, SELL in loss. Phase 3c wires the events prop to
the existing trade-activity WS broadcasts."
```

---

## Task 10: Barrel export + Full-suite verification

**Files:**
- Create: `packages/frontend/src/components/game/arena/index.ts`

- [ ] **Step 1: Create the barrel**

```ts
export { LeaderboardPanel, type LeaderboardEntry, type LeaderboardPanelProps } from './LeaderboardPanel';
export { PortfolioPanel, type PortfolioPanelProps } from './PortfolioPanel';
export { QuoteHeader, type QuoteHeaderProps } from './QuoteHeader';
export { OhlcStrip, type OhlcStripProps } from './OhlcStrip';
export { ChartPanel, type ChartPanelProps } from './ChartPanel';
export { HoldingsPanel, type HoldingRow, type HoldingsPanelProps } from './HoldingsPanel';
export { SymbolSearchPanel, type SymbolSearchPanelProps } from './SymbolSearchPanel';
export { WatchlistPanel, type WatchlistRow, type WatchlistPanelProps } from './WatchlistPanel';
export { ActivityPanel, type ActivityEvent, type ActivityPanelProps } from './ActivityPanel';
```

- [ ] **Step 2: Full workspace verification**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm --filter @markettrader/frontend build
```

Expected: all PASS. Frontend test count should grow by 28 (4+4+4+2+3+4+2+3+2) → 125 total.

- [ ] **Step 3: Commit the barrel**

```bash
git add packages/frontend/src/components/game/arena/index.ts
git commit -m "feat(frontend): arena barrel — phase 3b panels complete

Nine standalone panels — LeaderboardPanel, PortfolioPanel,
QuoteHeader, OhlcStrip, ChartPanel, HoldingsPanel, SymbolSearchPanel,
WatchlistPanel, ActivityPanel — all TDD'd in isolation. Phase 3c
composes them in the new GameDetailPage."
```

---

## What's NOT in this phase

Phase 3c picks these up:
- `GameDetailPage` rewrite to the three-pane grid + responsive collapse.
- `SelectedSymbolProvider` mounted at the page level + wiring all the `onSelect` callbacks to it.
- Deletion of `YourProfileCard`, `AboutThisGameCard`, `SymbolSearchCard`, `Leaderboard.tsx`, `GameLeaderboardCard.tsx`, `HoldingsSidebar.tsx`.
- Wiring the ticker tape's in-game click into `SelectedSymbolContext`.
- The "+ ADD" action in `WatchlistPanel`.
- Real data flow into `OhlcStrip` (the StockProvider's quote endpoint doesn't currently expose O/H/L/V — defer; pass undefined for now).

---

## Self-Review

**1. Spec coverage** — every panel listed in spec §4.2 has a task:
- `LeaderboardPanel` ✓ Task 1
- `PortfolioPanel` ✓ Task 2
- `QuoteHeader` ✓ Task 3
- `ChartPanel` ✓ Task 5
- OHLC strip ✓ Task 4
- `HoldingsPanel` ✓ Task 6
- `SymbolSearchPanel` ✓ Task 7
- `WatchlistPanel` ✓ Task 8
- `ActivityPanel` ✓ Task 9

**2. Placeholder scan**: none. Every step has runnable code, every test asserts concrete behavior, every command has an expected outcome.

**3. Type / API consistency**:
- `LeaderboardEntry`, `HoldingRow`, `WatchlistRow`, `ActivityEvent` are each exported alongside their components and referenced consistently in tests.
- `onSelect: (symbol: string) => void` signature is consistent across `HoldingsPanel`, `WatchlistPanel`, `SymbolSearchPanel`.
- `onTrade: (direction: TradeDirection) => void` signature uses the shared `TradeDirection` type from `@markettrader/shared`.
- `Panel`/`PanelHeader`/`PanelBody` imports use `@/components/panel` barrel from phase 1 — consistent across all 9 panels.

**4. Ambiguity check**: the deliberate decision to leave `StockChart`'s internals untouched in Task 5 (`ChartPanel`) is called out explicitly so a phase 3c implementer doesn't think it was forgotten.
