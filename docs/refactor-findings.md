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

**B1. `/auth/refresh` (and the disabled kill-switch) — re-check `users.disabled`** — `routes/auth.ts`
_Collapses 4 findings_ (player-routes HIGH, app-plugins HIGH, admin MEDIUM, security MEDIUM). `/auth/refresh` verifies the refresh JWT and re-mints a 15-min access token but never re-reads the user, so a disabled/deleted user keeps minting tokens for up to 7 days — the admin "disable" control is nearly inert.
**Fix:** in `/auth/refresh`, after verifying the token, load the user by `payload.id`; return 401 if missing or `disabled`. Re-derive `username`/groups from the DB rather than trusting the token. (Bounds post-ban exposure to one 15-min access-token lifetime without a per-request DB hit elsewhere.)

**B2. WS upgrade accepts long-lived refresh tokens (no `type` check)** — `ws/live-route.ts`, `ws/global-live-route.ts`
_Collapses 2 findings._ Both WS routes accept any structurally valid JWT; a 7-day refresh token works as a socket credential, and the token rides in the URL query string (proxy logs, history). Independently confirmed during orientation.
**Fix:** after `verify`, reject `payload.type === 'refresh'` (close 1008) in both routes.

**B3. POST `/games/:id/trades` — move membership check before existence/status/order-type gates** — `routes/trading.ts`
Membership is checked **last**, after 404/409 branches that leak game existence, status, and which order types a game permits to non-members — contradicting the documented "return 404 so game IDs aren't enumerable" invariant honored elsewhere.
**Fix:** reorder so the membership lookup runs immediately after loading the game, returning the same 404 for non-members before any status recompute / order-type gate. Read-only reorder, well before any mutation.

**B4. Add per-route rate limit to unauthenticated `/stocks/*`** — `routes/stocks.ts`
The limiter is `global:false`; the four `/stocks/*` routes are unauthenticated, opt into no limit, and proxy the external provider. `/stocks/search?q=…` is cache-keyed by query, so varied queries reach upstream — an anon client can drive provider cost and trip the shared rate-limit backoff that trading also depends on.
**Fix:** add a modest per-route `config.rateLimit` (e.g. 60/min) keyed by IP, consistent with the existing opt-in model.

**B5. Gate Swagger UI behind non-production (or admin)** — `plugins/swagger.ts`, `app.ts`
`/docs` and the OpenAPI JSON are publicly browsable in prod (route/param/scheme enumeration).
**Fix:** skip the swagger-UI registration when `NODE_ENV === 'production'` (keep the validator/serializer compilers routes depend on).

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

- **E1. Money path (HAND-DONE, separate commit AFTER A1 is green):** extract `deductCashReservation(tx, …)` and `decrementHolding(tx, …)` tx-scoped helpers; `placeWorkingOrder` reimplements both twice across the bracket/non-bracket branches (~230-line fn). High risk — same code as the bracket bug.
- **E2.** `services/leaderboard.ts` — the open-order reservation query is unscoped by game; it pulls **every** open order platform-wide on every snapshot tick then discards non-members. Scope it to the game's players.
- **E3.** `schema.sqlite.ts` + `schema.pg.ts` — `trades` has no index beyond PK, yet every worker tick scans `status='working'`/`'pending'`. Add a `status` index and a `(gamePlayerId, status)` composite to **both** dialects + generate migrations.
- **E4.** `shared/types/player.ts` — add canonical `TradeStatus = 'pending'|'working'|'executed'|'cancelled'` (triplicated today). **CAVEAT: do NOT touch `trading.ts:93`** — its `z.enum(['executed','working','pending'])` is a deliberate API subset.
- **E5.** Frontend dedup: shared `extractApiMessage` (3 byte-identical copies; **must keep message-then-error precedence** so `toastApiError` doesn't drop a field) and a shared symbol-search input/hook (TradeOrderDialog + QuoteInfo).
- **E6.** Frontend `formatPct`/`formatUSD` — ~6 panels redefine local copies; the locals can render `−0.00%` (the shared `lib/utils.formatPct` normalizes it). **CAVEAT: glyph trap — locals use U+2212 `−`, shared uses ASCII `-`; align deliberately, don't silently change the rendered minus.**
- **E7.** Achievements DSL — extract a `readPlayerStatColumn` / `progressFromStat` helper for the ~10 byte-identical "select one stat column, guard, setProgress" definition bodies. Assess the pattern as a whole; don't rewrite 40 files.

---

## DEFERRED — seen, not actioned (and why)

These were reviewed and **deliberately left** on a mature, green codebase. Recorded here so the decision is explicit and the next reader doesn't re-litigate.

- **`executeTrade` reads cash/holding outside the write tx** (LOW/correctness, risk=high). Real inconsistency with the rest of the money path, but only fires if per-player fills interleave — and the single-worker/per-tick model + SQLite write serialization make that effectively impossible today. Touching the money path for a non-firing race is net-negative; **deferred** (documented assumption is the right move if anything).
- **Extract `useTradeOrderForm` from the 1081-line `TradeOrderDialog`** (MEDIUM/maintainability, effort=large, risk=medium). The file already factors its presentational subcomponents well; a large logic-extraction on a heavily-used, well-tested component is high-churn for modest gain. Deferred unless the file is being actively reworked.
- **Speculative-generality / cosmetic lows:** dead `editMode` flag (could delete, but trivial), JSDoc wording fixes (admin-guard "delegates", PG audit "JSONB", misplaced `why` comment), `index.ts` category comments drift, `GamePlayer` unused type, withTimezone/decimal-precision PG nits, `qs()` helper duplicated across admin clients, outside-click/Escape dropdown plumbing, ARIA combobox contract on `SymbolSearch`, keyboard-accessible `HoldingsPanel` rows. **Accessibility items (ARIA, keyboard rows)** are legitimate but are feature work, not clean-up — flagged for a dedicated a11y pass, not bundled here.
- **`flexibility` axis:** no findings actioned. Speculative abstraction on mature code is a net negative per the review guardrails.

A handful of the deferred cosmetic lows (dead `editMode` flag, the two trivially-correct JSDoc fixes) may be swept in opportunistically if a fix agent is already editing that exact file — but they are not the goal.

---

## Process note (dev ergonomics, not a code finding)

`pnpm typecheck` does not build `packages/shared` first, so a stale `shared/dist` makes the frontend typecheck fail spuriously (hit at the start of this session). Worth a `prebuild`/`predev` or topo-ordered typecheck so CI/devs don't chase phantom type errors. Recorded for a separate change.
