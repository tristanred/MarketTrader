# Trade Desk Overhaul — Design

**Date:** 2026-05-14
**Branch:** `feat/trade-desk-overhaul`

## Context

The current "Trade Desk" card on `GameDetailPage` mixes three concerns in tabs (Trade / History / Chart). The inline Trade tab (`TradePanel`) is a primitive form that bypasses the rich `TradeOrderDialog` (which supports limit/stop/bracket and feature gates from game settings). Players can therefore submit market orders without ever seeing the stock info / order-ticket flow used everywhere else in the app.

This overhaul replaces the Trade tab with a prominent **Symbol Search / Trade** area at the top of the page that funnels every trade through the existing `QuoteInfoDialog → TradeOrderDialog` flow, and demotes the bottom section to a pure history/open-orders view.

## Goals

1. Remove the inline `TradePanel` (primitive trade form) — all trading flows through `TradeOrderDialog`.
2. Add a top-of-page **Symbol Search** card with autocomplete results showing live price, change, and a Trade button per row.
3. Convert the bottom card from "Trade Desk" → **Trade Activity** with two tabs: History and Open Orders. Remove the Chart tab.

## Non-Goals

- No backend changes. `GET /stocks/search` and `GET /stocks/:symbol` already exist.
- No changes to `TradeOrderDialog`, `QuoteInfoDialog`, or order semantics.
- No changes to the right-side `HoldingsSidebar`.

## UI Layout

```
┌─ Header: game name · time-until-end ───────────────────────────┐
├─ SYMBOL SEARCH / TRADE (new) ────────────────┬─ YOUR PORTFOLIO ┤
│  [ Enter Company or Symbol            🔍 ]   │  (sidebar       │
│  ┌─ dropdown (when results) ─────────────┐   │   unchanged)    │
│  │ AAPL  Apple Inc.   298.21  -0.22%  [Trade]│                 │
│  │ AAPW  Roundhill…   40.21   -0.67%  [Trade]│                 │
│  └───────────────────────────────────────┘   │                 │
├─ YOUR PROFILE ──────────────────────────────┤                  │
├─ ABOUT THIS GAME ───────────────────────────┤                  │
├─ LEADERBOARD ───────────────────────────────┤                  │
├─ TRADE ACTIVITY (renamed) ──────────────────┤                  │
│  [ History | Open Orders ]                   │                 │
└──────────────────────────────────────────────┴─────────────────┘
```

## Components

### New: `SymbolSearchCard` (`packages/frontend/src/components/SymbolSearchCard.tsx`)

A card titled "Symbol Search / Trade" containing a search input that drives a results dropdown.

- **Input**: `<Input>` with placeholder `"Enter Company or Symbol"` and a search-icon affordance. Clear (×) button when non-empty.
- **Debounce**: 250 ms (match existing `TradePanel`).
- **Data**: `useStockSearch(debouncedQuery)` (already exists in `hooks/useStocks.ts`).
- **Dropdown**: Renders below the input when query length ≥ 1 and results are loaded. Shows a "Displaying N results" header, then one row per `StockSearchResult`:
  - Left: `<SymbolButton symbol={r.symbol}>` (already opens `QuoteInfoDialog`) on top of the company name in muted text.
  - Right: price and `±change ±change%` (red/green) from a live quote.
  - Far right: `<Button>Trade</Button>` → `quoteDialog.openQuote(symbol)` (per user choice: stock info dialog first; the existing dialog already has its own Trade button feeding `TradeOrderDialog`).
- **Live price per row**: subscribe each visible result symbol via `useLiveStore` (the existing Zustand WS store) and seed initial value via `useStockQuote(symbol)`. To avoid N parallel hooks at render time, implement a small `SearchResultRow` child that owns its own `useStockQuote` + `useLiveStore` subscription; the parent just maps over results. The component unsubscribes implicitly via React Query's cache + Zustand selectors.
- **States**: loading skeleton row, empty state ("No matches"), API error toast (reuse existing error pattern from `TradePanel`).
- **Mobile**: dropdown takes full card width; results table collapses to two lines per row.

### Modified: `GameDetailPage` (`packages/frontend/src/pages/GameDetailPage.tsx`)

- Insert `<SymbolSearchCard />` as the **first card** in the `lg:col-span-2` main column, above `<YourProfileCard>`.
- Replace the existing Trade Desk `<Card>` block (lines ~132–157) with a new `<TradeActivityCard gameId={gameId} />` (see below).
- Remove `StockChart` usage from this page; remove `heldSymbols` derivation if it becomes unused.

### New: `TradeActivityCard` (`packages/frontend/src/components/TradeActivityCard.tsx`)

Replaces the inline tab block. Owns the History/Open Orders tabs.

- Card title: **"Trade Activity"**.
- Tabs (default `history`):
  - `history` → `<TradeHistoryTable gameId={gameId} />`
  - `open-orders` → `<OpenOrdersList gameId={gameId} />`
- Chart tab and `TradePanel` are gone from this card.

### Removed

- `packages/frontend/src/components/TradePanel.tsx` — delete; no remaining callers after page edit.
- Any test files exclusively covering `TradePanel` (e.g. `TradePanel.test.tsx`).
- Import of `StockChart` from `GameDetailPage.tsx` (if no other on-page usage remains).

## Data Flow

```
user types       useStockSearch (debounced 250ms)
   │                  │
   ▼                  ▼
SymbolSearchCard ──► /stocks/search?q= ──► StockSearchResult[]
                          │
                          ▼ per row
                   SearchResultRow
                     ├─ useStockQuote(symbol)   → seed price
                     ├─ useLiveStore selector   → live overrides
                     └─ [Trade] click
                              ▼
                      quoteDialog.openQuote(symbol)
                              ▼
                      QuoteInfoDialog → TradeOrderDialog (existing)
```

## Critical Files

| File | Action |
|---|---|
| `packages/frontend/src/components/SymbolSearchCard.tsx` | **Create** |
| `packages/frontend/src/components/TradeActivityCard.tsx` | **Create** |
| `packages/frontend/src/pages/GameDetailPage.tsx` | **Modify** — add search card at top; swap Trade Desk for Trade Activity; drop StockChart usage |
| `packages/frontend/src/components/TradePanel.tsx` | **Delete** |
| `packages/frontend/src/components/TradePanel.test.tsx` (if present) | **Delete** |
| `packages/frontend/src/components/SymbolSearchCard.test.tsx` | **Create** — unit test: debounce → results render → Trade click opens dialog store |
| `packages/frontend/src/components/TradeActivityCard.test.tsx` | **Create** — unit test: tab switching renders correct child |

## Reused Existing Code

- `useStockSearch`, `useStockQuote` (`packages/frontend/src/hooks/useStocks.ts`)
- `useLiveStore` (live WS price store)
- `useQuoteDialogStore.openQuote` (`packages/frontend/src/stores/quoteDialogStore.ts`)
- `SymbolButton` (already wired to open `QuoteInfoDialog`)
- `TradeHistoryTable`, `OpenOrdersList` (no changes)
- ShadCN `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Tabs`, `Input`, `Button`

## Verification

1. **Typecheck & lint:** `pnpm typecheck && pnpm lint`.
2. **Unit tests:** `pnpm --filter frontend test` — new tests for `SymbolSearchCard` and `TradeActivityCard` pass; existing tests unaffected (except removed `TradePanel.test.tsx`).
3. **E2E / manual via Playwright MCP:**
   - Start dev: `pnpm dev`.
   - Open a game's detail page.
   - Type `AAPL` in the new search box. Confirm dropdown shows ≥1 result with live price.
   - Click `Trade` on a row. Confirm `QuoteInfoDialog` opens for that symbol.
   - From the dialog, click its own Trade button → confirm `TradeOrderDialog` opens.
   - Confirm the old "Trade Desk" bottom card is now "Trade Activity" with only History and Open Orders tabs (no Trade, no Chart).
   - Confirm no inline trade-submission form is reachable from the page.
4. **Regression:** holdings sidebar, leaderboard, profile card, and trade history continue to render unchanged.
