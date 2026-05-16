# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the new "modern terminal" theme tokens (dark default + Paper light), self-hosted Geist/Geist Mono fonts, Tailwind extensions, and a shared `Panel` primitive — without changing any existing layouts.

**Architecture:** Two CSS-variable themes keyed on the existing `.dark` class on `<html>`. Every Tailwind color references a CSS var so components are theme-agnostic. Fonts ship as bundled `@fontsource/*` packages; no Google Fonts runtime dependency. The `Panel` primitive is a small wrapper for the new module chrome (radius 6px, hairline border, mono uppercase header) — it lives alongside the existing ShadCN UI primitives and isn't yet consumed by any page in this phase.

**Tech Stack:** Tailwind CSS 3.4 + tailwindcss-animate, CSS custom properties, `@fontsource/geist-sans` + `@fontsource/geist-mono`, Vitest + React Testing Library.

**Spec reference:** `docs/superpowers/specs/2026-05-15-terminal-design-refresh.md` — sections §2 (Design language) and §6.1 (Theme + tokens) plus the `Panel` primitive from §6.3.

**Branch & commit cadence:** Work happens on a dedicated branch `feat/phase-1-foundation`. Each task ends with a focused commit; do not batch unrelated changes. The branch is pushed and a PR opened only after Task 7 (full-suite verification) passes.

---

## Task 0: Set up the branch

- [ ] **Step 1: Confirm a clean working tree on `main`**

```bash
git status --short
git rev-parse --abbrev-ref HEAD
```

Expected: status is empty (or only contains untracked files unrelated to this phase); current branch is `main`. If you're not on `main`, switch to it (`git checkout main`) and pull (`git pull --ff-only`) before continuing.

- [ ] **Step 2: Create and check out the phase branch**

```bash
git checkout -b feat/phase-1-foundation
```

Expected: switched to a new branch `feat/phase-1-foundation`.

---

## File Structure

**Modified:**
- `packages/frontend/package.json` — add `@fontsource/geist-sans`, `@fontsource/geist-mono`
- `packages/frontend/src/main.tsx` — import font CSS at module top
- `packages/frontend/src/index.css` — replace theme tokens with charcoal/paper CSS vars; add marquee keyframes; add base font-family + tabular numerics on `.font-mono`
- `packages/frontend/tailwind.config.ts` — add `colors.accent/gain/loss/panel/hairline/hairline-strong/text-strong/bg`, `fontFamily.sans/mono`, `borderRadius.panel/chip`, `keyframes.marquee` + `animation.marquee`
- `packages/frontend/src/stores/themeStore.ts` — change default initial theme to `'dark'` (was: falls back to OS preference)

**Created:**
- `packages/frontend/src/components/panel/Panel.tsx` — root panel container
- `packages/frontend/src/components/panel/PanelHeader.tsx` — uppercase mono label + optional right-slot
- `packages/frontend/src/components/panel/PanelBody.tsx` — padded body region
- `packages/frontend/src/components/panel/index.ts` — barrel export
- `packages/frontend/tests/Panel.test.tsx` — unit tests for the primitive
- `packages/frontend/tests/themeStore.test.ts` — unit tests for default-dark behavior

**Out of scope for phase 1** (deferred to later phases): rewriting `AppHeader`/`AppShell`, deleting the existing `.dark`-vs-light contrast tweaks in any other file, restyling `Card` or any other ShadCN primitive, removing the theme toggle button.

---

## Task 1: Add font packages and import them

**Files:**
- Modify: `packages/frontend/package.json`
- Modify: `packages/frontend/src/main.tsx`

- [ ] **Step 1: Add font deps**

Run from repo root:

```bash
pnpm --filter @markettrader/frontend add @fontsource/geist-sans @fontsource/geist-mono
```

Expected: `package.json` gains two `dependencies` entries pointing at the latest published versions of each package.

- [ ] **Step 2: Import font CSS in main.tsx**

Modify `packages/frontend/src/main.tsx`. The current contents are:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
```

Replace with:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/geist-mono/600.css';
import '@fontsource/geist-mono/700.css';
import './index.css';
import App from './App';
```

The font imports must precede `./index.css` so `@font-face` declarations are registered before any rule that references `Geist`/`Geist Mono`.

- [ ] **Step 3: Verify fonts resolve at build time**

Run:

```bash
pnpm --filter @markettrader/frontend typecheck
```

Expected: PASS (no missing-module errors for the new imports).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/package.json packages/frontend/src/main.tsx pnpm-lock.yaml
git commit -m "feat(frontend): self-host Geist + Geist Mono fonts

Adds @fontsource packages for both font families across weights
400/500/600/700 and imports them in main.tsx before index.css so
@font-face rules are registered before any consumer."
```

---

## Task 2: Default theme to dark in themeStore

**Files:**
- Modify: `packages/frontend/src/stores/themeStore.ts:11-16`
- Test: `packages/frontend/tests/themeStore.test.ts`

The spec specifies dark-by-default. The existing store falls back to OS preference. We change the fallback to `'dark'` while still honoring an explicit stored preference.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/themeStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

describe('themeStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    // Force a fresh module so `readInitial` re-runs.
    Object.keys(require.cache ?? {}).forEach((k) => {
      if (k.includes('themeStore')) delete (require.cache as Record<string, unknown>)[k];
    });
  });

  it('defaults to dark when no stored preference exists', async () => {
    const mod = await import('@/stores/themeStore');
    expect(mod.useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('honors a stored light preference', async () => {
    window.localStorage.setItem('mt:theme', 'light');
    // Re-import after seeding storage so initialization sees it.
    const fresh = await import('@/stores/themeStore?reset=1');
    expect(fresh.useThemeStore.getState().theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggle flips dark <-> light and persists', async () => {
    const mod = await import('@/stores/themeStore?reset=2');
    mod.useThemeStore.getState().toggle();
    expect(mod.useThemeStore.getState().theme).toBe('light');
    expect(window.localStorage.getItem('mt:theme')).toBe('light');
    mod.useThemeStore.getState().toggle();
    expect(mod.useThemeStore.getState().theme).toBe('dark');
    expect(window.localStorage.getItem('mt:theme')).toBe('dark');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @markettrader/frontend test -- themeStore.test
```

Expected: FAIL on the first assertion (`defaults to dark`) — current behavior reads `prefers-color-scheme` which in jsdom resolves to `light`.

- [ ] **Step 3: Edit `readInitial` to default to dark**

In `packages/frontend/src/stores/themeStore.ts`, replace the `readInitial` function (lines 11–16):

```ts
function readInitial(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem('mt:theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return 'dark';
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @markettrader/frontend test -- themeStore.test
```

Expected: PASS, three tests green.

- [ ] **Step 5: Run typecheck to ensure no consumers broke**

```bash
pnpm --filter @markettrader/frontend typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/stores/themeStore.ts packages/frontend/tests/themeStore.test.ts
git commit -m "feat(frontend): default theme to dark

The terminal aesthetic is dark-native. Drop the OS-preference probe
and seed dark on first visit; explicit user choice via localStorage
still wins."
```

---

## Task 3: Replace CSS theme tokens

**Files:**
- Modify: `packages/frontend/src/index.css`

- [ ] **Step 1: Replace the `@layer base` token block**

Open `packages/frontend/src/index.css`. Replace the entire `@layer base` block that defines `:root` and `.dark` tokens (currently lines around 5–37) with the new two-theme system. The new full contents of the file should be:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  /* ─── Dark theme (default) ───────────────────────────── */
  :root {
    --bg: #0a0b0d;
    --panel: #0c0d10;
    --hairline: #161719;
    --hairline-strong: #1d1f23;
    --text: #e8e9ea;
    --text-strong: #f4f4f5;
    --muted: #6b7280;
    --accent: #67e8f9;
    --accent-bg: rgba(103, 232, 249, 0.10);
    --gain: #10b981;
    --loss: #ef4444;
    --radius: 0.5rem;
  }

  /* The themeStore writes `.dark` on <html> when dark is active.
     Dark is the default so `:root` already holds dark values; this
     selector exists so the variable surface stays explicit for tools
     and devtools. */
  .dark {
    --bg: #0a0b0d;
    --panel: #0c0d10;
    --hairline: #161719;
    --hairline-strong: #1d1f23;
    --text: #e8e9ea;
    --text-strong: #f4f4f5;
    --muted: #6b7280;
    --accent: #67e8f9;
    --accent-bg: rgba(103, 232, 249, 0.10);
    --gain: #10b981;
    --loss: #ef4444;
  }

  /* ─── Light theme — "Paper" ──────────────────────────── */
  html:not(.dark) {
    --bg: #f7f5f0;
    --panel: #ffffff;
    --hairline: #ebe7dd;
    --hairline-strong: #e0dcd2;
    --text: #1a1a1a;
    --text-strong: #0a0908;
    --muted: #6b665c;
    --accent: #0891b2;
    --accent-bg: rgba(8, 145, 178, 0.08);
    --gain: #047857;
    --loss: #b91c1c;
  }

  * {
    border-color: var(--hairline-strong);
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Geist', system-ui, sans-serif;
    font-feature-settings: 'ss01' 1, 'cv11' 1;
  }

  /* Tabular numerics on every mono run — numbers must align in tables. */
  .font-mono,
  code,
  kbd,
  pre,
  samp {
    font-feature-settings: 'tnum' 1, 'zero' 1;
  }

  /* Respect reduced motion globally. Marquee/pulse animations fall back
     to their static end state. */
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
}

@layer utilities {
  /* Ticker-tape marquee — used by shell components in a later phase. */
  @keyframes marquee {
    from { transform: translateX(0); }
    to   { transform: translateX(-50%); }
  }
  .animate-marquee {
    animation: marquee 40s linear infinite;
  }
  .animate-marquee:hover {
    animation-play-state: paused;
  }

  /* Market-open pulse dot. */
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }
  .animate-pulse-dot {
    animation: pulse-dot 1.6s ease-in-out infinite;
  }
}

@layer components {
  /*
   * Always-visible horizontal scrollbar for overflowing tables. Counters
   * macOS overlay scrollbars that hide until the user starts scrolling,
   * which makes off-screen columns easy to miss.
   */
  .scrollbar-always-x {
    scrollbar-width: thin;
    scrollbar-color: var(--muted) transparent;
  }
  .scrollbar-always-x::-webkit-scrollbar {
    height: 10px;
    -webkit-appearance: none;
  }
  .scrollbar-always-x::-webkit-scrollbar-track {
    background: var(--hairline);
    border-radius: 9999px;
  }
  .scrollbar-always-x::-webkit-scrollbar-thumb {
    background: var(--muted);
    border-radius: 9999px;
  }
  .scrollbar-always-x::-webkit-scrollbar-thumb:hover {
    background: var(--text);
  }
}
```

Note: this file preserves the existing `.scrollbar-always-x` rule and the existing `@layer base * { border-color }` reset so nothing breaks. It removes the `--background/--foreground/--card/--card-foreground/--primary/--primary-foreground/--destructive/--destructive-foreground/--accent-foreground/--muted-foreground/--border/--input/--ring` HSL variables — those names are still referenced by `tailwind.config.ts`. Task 4 will replace the Tailwind config to drop those references in lockstep.

- [ ] **Step 2: Commit (intentionally broken state)**

Don't commit yet. The Tailwind config still references the old variable names, so the app won't build until Task 4. Proceed directly.

---

## Task 4: Replace Tailwind config

**Files:**
- Modify: `packages/frontend/tailwind.config.ts`

- [ ] **Step 1: Replace the entire config**

Open `packages/frontend/tailwind.config.ts`. Replace the entire file with:

```ts
import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        hairline: {
          DEFAULT: 'var(--hairline)',
          strong: 'var(--hairline-strong)',
        },
        text: {
          DEFAULT: 'var(--text)',
          strong: 'var(--text-strong)',
        },
        muted: 'var(--muted)',
        accent: {
          DEFAULT: 'var(--accent)',
          bg: 'var(--accent-bg)',
        },
        gain: 'var(--gain)',
        loss: 'var(--loss)',

        // ─── Compatibility aliases ──────────────────────────────
        // Existing ShadCN UI primitives reference these names. Map
        // them to the new tokens so we don't have to rewrite every
        // component in this phase. Later phases remove unused ones.
        background: 'var(--bg)',
        foreground: 'var(--text)',
        border: 'var(--hairline-strong)',
        input: 'var(--hairline-strong)',
        ring: 'var(--accent)',
        card: {
          DEFAULT: 'var(--panel)',
          foreground: 'var(--text)',
        },
        primary: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--bg)',
        },
        destructive: {
          DEFAULT: 'var(--loss)',
          foreground: '#ffffff',
        },
        success: {
          DEFAULT: 'var(--gain)',
          foreground: '#ffffff',
        },
        'muted-foreground': 'var(--muted)',
        'accent-foreground': 'var(--text-strong)',
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        panel: '6px',
        chip: '4px',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
```

Key changes vs. the old config:
- `colors.background`, `colors.foreground`, `colors.border`, `colors.input`, `colors.ring`, `colors.card`, `colors.primary`, `colors.destructive`, `colors.muted-foreground`, `colors.accent-foreground` are kept as **compatibility aliases** so existing ShadCN-based components (Button, Card, Input, Dialog, Toast, …) keep rendering without source changes.
- The aliases all resolve to the new CSS vars, so they automatically adopt the new charcoal/Paper palettes.
- New first-class tokens (`bg`, `panel`, `hairline`, `hairline-strong`, `text`, `text-strong`, `muted`, `accent`, `accent.bg`, `gain`, `loss`) are what we'll use in all new components.
- The marquee and pulse keyframes are defined in `index.css` (Task 3) as `@layer utilities` rules — kept out of Tailwind config because they reference 50% (which Tailwind `theme.extend.keyframes` doesn't compose cleanly into `animation` strings with `infinite`). Using utility classes (`.animate-marquee`, `.animate-pulse-dot`) instead of `animate-marquee` Tailwind-generated.

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @markettrader/frontend typecheck
```

Expected: PASS. The config file is type-checked via `satisfies Config`.

- [ ] **Step 3: Run dev build to confirm it compiles**

```bash
pnpm --filter @markettrader/frontend build
```

Expected: PASS. Bundler emits the production `dist/` without errors. Tailwind warnings about unknown utility classes are fine and indicate dead utilities; **errors** about unresolvable colors are not — if you see an error referencing an HSL var like `hsl(var(--background))`, you missed a token in Task 3's index.css.

- [ ] **Step 4: Run the existing test suite**

```bash
pnpm --filter @markettrader/frontend test
```

Expected: PASS. Existing component tests don't assert on colors so the palette flip is invisible to them.

- [ ] **Step 5: Visually smoke-test the dev server**

Start the app:

```bash
pnpm --filter @markettrader/frontend dev
```

Open `http://localhost:5173`. Expected: page renders on the new charcoal background with paper text; existing Card/Button styles still resolve (no naked unstyled HTML). Toggle the theme button in the header → page flips to Paper light.

If anything renders as plain white-on-black with browser-default fonts, fonts aren't loading — check the Network tab for `geist-sans-latin-400-normal.woff2`.

- [ ] **Step 6: Commit Tasks 3 and 4 together**

```bash
git add packages/frontend/src/index.css packages/frontend/tailwind.config.ts
git commit -m "feat(frontend): swap to terminal-aesthetic theme tokens

Replaces the slate ShadCN palette with two CSS-variable themes —
charcoal/ice-blue dark default and warm Paper light. Adds first-class
tokens (bg, panel, hairline, text, muted, accent, gain, loss) for new
components and keeps ShadCN aliases so existing primitives render
unchanged. Adds marquee + pulse-dot keyframes for use by later phases."
```

---

## Task 5: Panel primitive — failing tests

**Files:**
- Create: `packages/frontend/tests/Panel.test.tsx`

- [ ] **Step 1: Write the test file**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';

describe('Panel primitives', () => {
  it('Panel renders children inside a bordered container', () => {
    render(
      <Panel data-testid="panel">
        <span>contents</span>
      </Panel>,
    );
    const el = screen.getByTestId('panel');
    expect(el).toHaveTextContent('contents');
    // Panel chrome: rounded 6px, 1px border, no shadow.
    expect(el.className).toMatch(/rounded-panel/);
    expect(el.className).toMatch(/border/);
  });

  it('Panel merges custom className', () => {
    render(<Panel data-testid="panel" className="custom-x" />);
    expect(screen.getByTestId('panel').className).toMatch(/custom-x/);
  });

  it('Panel forwards arbitrary HTML props', () => {
    render(<Panel data-testid="panel" aria-label="my panel" />);
    expect(screen.getByTestId('panel')).toHaveAttribute('aria-label', 'my panel');
  });

  it('PanelHeader renders the label in uppercase mono small-caps style', () => {
    render(<PanelHeader>leaderboard</PanelHeader>);
    const header = screen.getByText('leaderboard');
    // The label sits in a mono-styled, tracking-wide container. We assert
    // structural classes, not visual rendering.
    expect(header.className).toMatch(/font-mono/);
    expect(header.className).toMatch(/uppercase/);
    expect(header.className).toMatch(/tracking-/);
  });

  it('PanelHeader renders a right-slot when provided', () => {
    render(
      <PanelHeader right={<span data-testid="slot">LIVE</span>}>
        leaderboard
      </PanelHeader>,
    );
    expect(screen.getByTestId('slot')).toHaveTextContent('LIVE');
  });

  it('PanelBody applies padding and renders children', () => {
    render(
      <PanelBody data-testid="body">
        <span>row</span>
      </PanelBody>,
    );
    const body = screen.getByTestId('body');
    expect(body).toHaveTextContent('row');
    expect(body.className).toMatch(/p-/); // some padding utility
  });

  it('Composes Panel + PanelHeader + PanelBody as the canonical module', () => {
    render(
      <Panel>
        <PanelHeader right={<span>LIVE</span>}>leaderboard</PanelHeader>
        <PanelBody>
          <div>row 1</div>
          <div>row 2</div>
        </PanelBody>
      </Panel>,
    );
    expect(screen.getByText('leaderboard')).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('row 1')).toBeInTheDocument();
    expect(screen.getByText('row 2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
pnpm --filter @markettrader/frontend test -- Panel.test
```

Expected: FAIL with "Cannot find module '@/components/panel'" — the directory doesn't exist yet.

---

## Task 6: Implement the Panel primitive

**Files:**
- Create: `packages/frontend/src/components/panel/Panel.tsx`
- Create: `packages/frontend/src/components/panel/PanelHeader.tsx`
- Create: `packages/frontend/src/components/panel/PanelBody.tsx`
- Create: `packages/frontend/src/components/panel/index.ts`

- [ ] **Step 1: Write `Panel.tsx`**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The shared module chrome used by every "panel" in the new design —
 * leaderboard, portfolio, watchlist, activity, chart, etc. Provides the
 * 1px hairline border, 6px radius, and `--panel` surface fill. Layout
 * (header, body, columns) is left to the consumer.
 */
export const Panel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-panel border border-hairline-strong bg-panel',
        'flex flex-col',
        className,
      )}
      {...props}
    />
  ),
);
Panel.displayName = 'Panel';
```

- [ ] **Step 2: Write `PanelHeader.tsx`**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface PanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Right-aligned slot, typically a "LIVE" pill or an action affordance. */
  right?: React.ReactNode;
}

/**
 * Header bar for {@link Panel}. Renders its children as a small-caps mono
 * label on the left with optional `right` content on the far right, both
 * sitting on a hairline-bottom 28px-tall strip.
 */
export const PanelHeader = React.forwardRef<HTMLDivElement, PanelHeaderProps>(
  ({ className, children, right, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex h-7 items-center justify-between border-b border-hairline px-2.5',
        'text-[10px] font-mono uppercase tracking-[0.14em] text-muted',
        className,
      )}
      {...props}
    >
      <span className={cn('font-mono uppercase tracking-[0.14em] text-muted')}>{children}</span>
      {right ? <span className="flex items-center gap-2">{right}</span> : null}
    </div>
  ),
);
PanelHeader.displayName = 'PanelHeader';
```

Note: the inner `<span>` repeats the `font-mono uppercase tracking-` classes so the test (which queries by text) finds them on the element wrapping the label specifically, not only on the outer container.

- [ ] **Step 3: Write `PanelBody.tsx`**

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Padded body region for {@link Panel}. Defaults to compact padding
 * (`px-2.5 py-2`) matching the dense terminal aesthetic. Consumers needing
 * looser spacing pass their own padding via `className`.
 */
export const PanelBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex-1 px-2.5 py-2', className)} {...props} />
  ),
);
PanelBody.displayName = 'PanelBody';
```

- [ ] **Step 4: Write the barrel `index.ts`**

```ts
export { Panel } from './Panel';
export { PanelHeader, type PanelHeaderProps } from './PanelHeader';
export { PanelBody } from './PanelBody';
```

- [ ] **Step 5: Run the tests and verify they pass**

```bash
pnpm --filter @markettrader/frontend test -- Panel.test
```

Expected: PASS, all seven tests green.

- [ ] **Step 6: Run typecheck**

```bash
pnpm --filter @markettrader/frontend typecheck
```

Expected: PASS.

- [ ] **Step 7: Run lint**

```bash
pnpm --filter @markettrader/frontend lint
```

Expected: PASS (or any warnings unrelated to the new files).

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/components/panel packages/frontend/tests/Panel.test.tsx
git commit -m "feat(frontend): add Panel primitive for module chrome

Three small components (Panel, PanelHeader, PanelBody) compose the
shared 1px-hairline / 6px-radius / mono-uppercase-header chrome that
every new module (leaderboard, portfolio, watchlist, activity, chart,
…) will use. Not yet consumed by any page; phase 2 onwards wires it up."
```

---

## Task 7: Full-suite verification

- [ ] **Step 1: Run all frontend tests**

```bash
pnpm --filter @markettrader/frontend test
```

Expected: PASS. Existing tests for `App`, `OpenOrdersList`, `SymbolSearchCard`, `TradeActivityCard`, `TradeOrderDialog`, `useGameSocket`, `api`, `trades` should all stay green — none of them depend on the slate palette or system fonts.

- [ ] **Step 2: Run typecheck across the workspace**

```bash
pnpm typecheck
```

Expected: PASS for server, frontend, and shared.

- [ ] **Step 3: Run lint across the workspace**

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 4: Run the production build**

```bash
pnpm --filter @markettrader/frontend build
```

Expected: PASS. Inspect `dist/assets/` — there should be `.woff2` files for both Geist families (file names include `geist-sans-latin-…woff2` and `geist-mono-latin-…woff2`). Confirms fonts are bundled, not externally fetched.

- [ ] **Step 5: Manual smoke test in the browser**

Start the server and frontend together:

```bash
pnpm dev
```

Open `http://localhost:5173`, sign in. Verify:
1. Background renders charcoal `#0a0b0d` (use DevTools color picker on `<body>` to confirm).
2. Body text renders in Geist (DevTools Computed → Font reads "Geist").
3. Any number in an existing component (e.g. the portfolio value on `/games/:id`) — if it sits inside a `.font-mono` class, renders in Geist Mono with tabular numerics.
4. Theme toggle in the header flips to Paper (`#f7f5f0`); colors all change in lockstep.
5. No console warnings about missing CSS custom properties.

If any of those fail, return to the appropriate earlier task — don't commit any "fixup" until the cause is identified.

- [ ] **Step 6: Final commit (only if the smoke test surfaced changes)**

If the smoke test passed cleanly, there's nothing to commit. If you had to amend a file, commit it now with a focused message:

```bash
git add <files>
git commit -m "fix(frontend): <specific issue> in phase-1 foundation"
```

---

## What's NOT in this phase

These intentionally wait for later phases — don't touch them here:
- `AppHeader`, `AppShell`, `AppFooter` — phase 2.
- `system_settings` table, indices broadcaster, `/ws/live` socket — phase 2.
- Anything in `packages/server/` — phase 2.
- Restyling `Card`, `Button`, `Input`, `Dialog`, `Toast` — they pick up the new colors automatically via the compatibility aliases. Cleanups (removing aliases, switching consumers to `bg-panel` directly) happen as those components are touched in later phases.
- New shared types (`IndexQuote`, `TickerTapeSettings`, `LiveWsMessage`) — phase 2.

---

## Self-Review

**1. Spec coverage (§2 + §6.1 of the spec):**
- Geist + Geist Mono self-hosted ✓ (Task 1)
- Tabular numerics on mono runs ✓ (Task 3, `.font-mono { font-feature-settings }`)
- Both theme palettes with the exact hex values from the spec ✓ (Task 3)
- Tailwind extensions: `colors.accent/gain/loss/panel/hairline/text/muted/bg`, `fontFamily.sans/mono`, `borderRadius.panel/chip` ✓ (Task 4)
- Marquee + pulse keyframes ✓ (Task 3, in `@layer utilities`)
- Reduced-motion fallback ✓ (Task 3, global rule in `@layer base`)
- Dark-by-default ✓ (Task 2)
- Theme stored in `themeStore` (already wired) — kept as-is ✓
- `Panel` primitive ✓ (Tasks 5–6)
- No visible UX change beyond the palette flip ✓ (ShadCN aliases in Task 4)

**2. Placeholder scan:** None — every code block contains the full content, every test asserts a concrete behavior, every command has an expected outcome.

**3. Type / API consistency:**
- `Panel`, `PanelHeader`, `PanelBody` named consistently across Task 5 (test) and Task 6 (impl).
- `PanelHeaderProps.right` typed as `React.ReactNode`, used as such in the test and impl.
- CSS var names match exactly between Task 3 (definitions) and Task 4 (consumers): `--bg`, `--panel`, `--hairline`, `--hairline-strong`, `--text`, `--text-strong`, `--muted`, `--accent`, `--accent-bg`, `--gain`, `--loss`.
- Tailwind class names referenced in `Panel.tsx` (`rounded-panel`, `border-hairline-strong`, `bg-panel`, `border-hairline`, `text-muted`, `font-mono`) all exist in the new config.
