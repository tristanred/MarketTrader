# Clean-Code & Security Review — Findings & Triage

_Branch: `refactor/clean-code-review`. Generated 2026-06-02 from a 15-agent concern-grouped analysis of the whole codebase (14 module agents + 1 cross-cutting security audit). Baseline before any change: typecheck/lint clean, 733 tests passing._

This document is the **reviewable record** of what the review found, what we chose to change, and — just as importantly — what we deliberately left alone. The codebase is mature and well-written; the bar for any change is **demonstrable value**, not checklist completeness. 64 raw findings collapse to ~12 distinct fixes once deduplicated by root cause.

---

## Severity summary (raw findings)

| Severity | Count |
|---|---|
| critical | 1 |
| high | 3 |
| medium | 19 |
| low | 41 |
| **total** | **64** |

Axes: maintainability 22, correctness 11, security 9, readability 9, clean-code 7, separation-of-concern 6.

---

## ACTION LIST (what we will change)

Ordered by execution sequence. Money-path / high-risk items are hand-done and committed in isolation; low-risk file-disjoint items are fan-out candidates.

### A. CRITICAL — money-path bug (separate deliverable, test-first, isolated commit)

**A1. Bracket child SELL leaks shares** — ✅ DONE (commit `27af4ba`). Fixed at both fill sites (trigger worker + admin force-execute) via an explicit `sharesAlreadyReserved` flag; long/short bracket round-trip regression tests added (the long case fails without the fix). — `services/trade.ts`, `services/working-order.ts`
`executeTrade` treats every resting sell (`existingTradeId != null`) as already share-decremented at placement. True for plain working/pending sells, **false for bracket TP/SL children** (only the entry reserves; children don't). When a child sell fills, the decrement is skipped → player banks the sale proceeds **and** keeps the phantom shares, inflating portfolio value and corrupting the leaderboard. The existing bracket test asserts statuses, not final portfolio quantity, so the suite stays green over the bug.
**Fix:** gate the share-decrement on whether shares were actually reserved (e.g. an explicit `sharesAlreadyReserved` flag from the call site: true for plain working + pending sells, false for bracket-child sells), not on `isResting`. **Test-first**: write a failing regression asserting `portfolios.quantity` returns to 0 after a full long-bracket round trip (entry buy fill + TP sell fill) and the symmetric short case, then fix.

### B. HIGH / MEDIUM security — deduplicated by root cause

**B1. `/auth/refresh` (and the disabled kill-switch) — re-check `users.disabled`** — ✅ DONE (commit `f6c868c`).
`routes/auth.ts`
_Collapses 4 findings_ (player-routes HIGH, app-plugins HIGH, admin MEDIUM, security MEDIUM). `/auth/refresh` verifies the refresh JWT and re-mints a 15-min access token but never re-reads the user, so a disabled/deleted user keeps minting tokens for up to 7 days — the admin "disable" control is nearly inert.
**Fix:** in `/auth/refresh`, after verifying the token, load the user by `payload.id`; return 401 if missing or `disabled`. Re-derive `username`/groups from the DB rather than trusting the token. (Bounds post-ban exposure to one 15-min access-token lifetime without a per-request DB hit elsewhere.)

**B2. WS upgrade accepts long-lived refresh tokens (no `type` check)** — ✅ DONE (commit `f0b1f3e`).
`ws/live-route.ts`, `ws/global-live-route.ts`
_Collapses 2 findings._ Both WS routes accept any structurally valid JWT; a 7-day refresh token works as a socket credential, and the token rides in the URL query string (proxy logs, history). Independently confirmed during orientation.
**Fix:** after `verify`, reject `payload.type === 'refresh'` (close 1008) in both routes.

**B3. POST `/games/:id/trades` — move membership check before existence/status/order-type gates** — ✅ DONE (commit `bff7d0a`).
`routes/trading.ts`
Membership is checked **last**, after 404/409 branches that leak game existence, status, and which order types a game permits to non-members — contradicting the documented "return 404 so game IDs aren't enumerable" invariant honored elsewhere.
**Fix:** reorder so the membership lookup runs immediately after loading the game, returning the same 404 for non-members before any status recompute / order-type gate. Read-only reorder, well before any mutation.

**B4. Add per-route rate limit to unauthenticated `/stocks/*`** — ✅ DONE (commit `bae268e`; search 30/min, lookups 120/min).
`routes/stocks.ts`
The limiter is `global:false`; the four `/stocks/*` routes are unauthenticated, opt into no limit, and proxy the external provider. `/stocks/search?q=…` is cache-keyed by query, so varied queries reach upstream — an anon client can drive provider cost and trip the shared rate-limit backoff that trading also depends on.
**Fix:** add a modest per-route `config.rateLimit` (e.g. 60/min) keyed by IP, consistent with the existing opt-in model.

**B5. Gate Swagger UI behind non-production (or admin)** — ❌ WON'T DO (deliberate decision, 2026-06-02).
`/docs` and the OpenAPI JSON are publicly browsable in prod, but this is **documentation only** — it grants no privilege; every route independently enforces JWT/`requireAdmin` regardless of where the request originates. The only effect is making the API surface easy to enumerate (reconnaissance), and the spec leaks no secrets. MarketTrader's API is a private backend for its own SPA with no third-party consumers, but the residual risk is minimal and many mature public APIs (Stripe, GitHub) keep docs public. Decision: **keep it public**, consistent with the "demonstrable value" bar — gating it is near-free but the benefit is marginal. Revisit only if the threat model changes (e.g. the API becomes a regulated/multi-tenant surface).

### C. HIGH correctness — provider

**C1. Alpaca requests omit `APCA-API-SECRET-KEY`** — `providers/alpaca.ts`, `providers/market-status/alpaca.ts`, `env.ts`
_Bundles the related MEDIUM (market-status factory doesn't validate key) and LOW (duplicated header object)._ Every authenticated Alpaca call sends only the key ID, never the secret → all upstream calls 401/403 in production. There's only one `ALPACA_API_KEY` in env; no secret. The provider is effectively non-functional behind a supported flag.
**Fix:** add `ALPACA_API_KEY_ID` + `ALPACA_API_SECRET_KEY` (keep `ALPACA_API_KEY` as ID alias for back-compat), thread both through, send both headers via one shared `alpacaAuthHeaders()` helper. Make `createMarketStatusProvider` throw on missing key like the stock factory does, and extend `validateProductionEnv`. Add a test asserting both headers are sent.

### D. Low-risk correctness quick wins (file-disjoint, fan-out OK)

- **D1.** `api/stocks.ts` — `useStockQuote` interpolates the raw symbol; siblings `encodeURIComponent`. Encode for parity (`^`/`=` tickers break otherwise).
- **D2.** `ws/indices-broadcaster.ts` — `void this.tick()` has no `.catch`; the sibling poller does. Add `.catch` to prevent a future unhandled rejection.
- **D3.** `components/game/arena/LeaderboardPanel.tsx` — "Full view" uses a raw `<a href>` → full SPA reload. Replace with react-router `Link`.
- **D4.** `env.ts` — `NODE_ENV` is a bare cast while every other enum is validated; a typo'd value silently skips production hardening. Add a `validatedNodeEnv()`.

### E. Maintainability / SoC — selected, genuine-duplication wins (fan-out OK with caveats)

- **E1.** ✅ DONE (commit `92623af`, hand-done; characterization tests `bc2b3f6` first). Extracted `deductCashReservation`/`decrementHolding` tx-scoped helpers; `placeWorkingOrder` no longer reimplements them twice. Pure refactor — all four placement error paths (2 added as missing coverage before refactoring) + both bracket round-trips green. `releaseReservation` and `pending-trade.ts` deliberately not unified (inverse op / separate finding).
- **E2.** ✅ DONE (commit `5ae7493`). `services/leaderboard.ts` reservation query scoped to the game's players (+ cross-game isolation test).
- **E3.** ✅ DONE (commit `c618140`). `status` and `(gamePlayerId, status)` indexes on `trades` in both dialects + migrations (`0016` sqlite / `0015` pg).
- **E4.** ✅ DONE (commit `567cb21`). Canonical `TradeStatus` in `shared/types/player.ts`, reused in `AdminTradeRow` + frontend admin trades query. `trading.ts:93` left untouched as required.
- **E5a.** ✅ DONE (commit `f558fe5`). Shared `lib/extractApiMessage` replacing 3 copies; kept message-then-error precedence (and unified `toastApiError` onto it — see commit for the deliberate body.message-over-body.error change).
- **E5b.** ❌ DEFERRED. Shared symbol-search input for TradeOrderDialog + QuoteInfo. A fuller component already exists (`components/search/SymbolSearch.tsx`) but the two simpler copies have *different Enter semantics* (TradeOrderDialog: Enter picks the raw typed symbol via `SYMBOL_RE`, even if not in the suggestion list, to seed the buy form; `SymbolSearch`: Enter selects the highlighted suggestion row) and a **parent-owned `searchQuery`** woven into a reset effect + form-seeding. Swapping is a behavior change, not a refactor — real surgery for pure line-count dedup. Defer until one of these components is being reworked for its own reasons.
- **E6.** ✅ DONE (commit `c7d7d8e`). Fixed the `−0.00%`/`−$0.00` bug in-place across 6 panels (+ regression test). **Dedup onto `lib/utils` deliberately NOT done** — the panels' U+2212 minus is intentional and asserted by 4 panel tests; deduping would change tested rendering. Recorded as a conscious keep-glyph decision.
- **E7.** ✅ DONE (commit `0c0099d`). Extracted `progressFromStat(column)`; 8 pure definitions → one line each, 2 guarded ones delegate after their guard. All 157 achievement tests pass.

---

## DEFERRED — seen, not actioned (and why)

These were reviewed and **deliberately left** on a mature, green codebase. Recorded here so the decision is explicit and the next reader doesn't re-litigate.

- **`executeTrade` reads cash/holding outside the write tx** (LOW/correctness, risk=high). Real inconsistency with the rest of the money path, but only fires if per-player fills interleave — and the single-worker/per-tick model + SQLite write serialization make that effectively impossible today. Touching the money path for a non-firing race is net-negative; **deferred** (documented assumption is the right move if anything).
- **Extract `useTradeOrderForm` from the 1081-line `TradeOrderDialog`** (MEDIUM/maintainability, effort=large, risk=medium). The file already factors its presentational subcomponents well; a large logic-extraction on a heavily-used, well-tested component is high-churn for modest gain. Deferred unless the file is being actively reworked.
- **Speculative-generality / cosmetic lows:** dead `editMode` flag (could delete, but trivial), JSDoc wording fixes (admin-guard "delegates", PG audit "JSONB", misplaced `why` comment), `index.ts` category comments drift, `GamePlayer` unused type, withTimezone/decimal-precision PG nits, `qs()` helper duplicated across admin clients, outside-click/Escape dropdown plumbing, ARIA combobox contract on `SymbolSearch`, keyboard-accessible `HoldingsPanel` rows. **Accessibility items (ARIA, keyboard rows)** are legitimate but are feature work, not clean-up — flagged for a dedicated a11y pass, not bundled here.
- **`flexibility` axis:** no findings actioned. Speculative abstraction on mature code is a net negative per the review guardrails.

A handful of the deferred cosmetic lows (dead `editMode` flag, the two trivially-correct JSDoc fixes) may be swept in opportunistically if a fix agent is already editing that exact file — but they are not the goal.

---

## Process notes (dev ergonomics, not code findings)

1. **Stale `shared/dist` breaks typecheck.** `pnpm typecheck` does not build `packages/shared` first, so a stale `shared/dist` makes the frontend typecheck fail spuriously (hit at the start of this session). Worth a `prebuild`/`predev` or topo-ordered typecheck so CI/devs don't chase phantom type errors.

2. **Playwright e2e full-run is flaky (PRE-EXISTING, also fails on `main`).** `pnpm --filter frontend e2e` fails 26/54 in the full run — every failure traces to the worker-scoped `adminUser` fixture (`e2e/fixtures/base.ts:197`) asserting the first-registered user is auto-promoted to admin and getting `groups=[]`. The `:memory:` server's "first user becomes admin" bootstrap only fires when no admin exists; across the full suite an earlier spec's registration already created one, so later fixture re-inits see `groups=[]`. **The same specs pass 5/5 in isolation, and clean `main` produces the identical 26-pass / 26-fail split** — verified this session by running the full suite on both branches. So it's a harness state-bleed bug, not a regression from this work. Fix direction: scope the admin bootstrap per test (reset the DB or use a dedicated admin seed) rather than relying on registration order. Recorded for a separate change — out of scope for this clean-up branch.
