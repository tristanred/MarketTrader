# Seed Game History — Design Spec

**Date:** 2026-05-20
**Status:** Draft → ready for plan

## Context

Manual testing of leaderboard, portfolio, and trade-history features currently requires either (a) playing trades by hand or (b) running the Playwright e2e fixtures, which create one player and a handful of trades. Neither produces a populated game with multiple players and a long trade history dating back to the start of the game.

This spec introduces a CLI utility that seeds an existing **active** game with a randomized roster of synthetic players, each with a randomized buy/sell history priced from real historical market data. The result is a realistic dataset for visual testing of leaderboards, portfolio breakdowns, trade history pages, and admin views.

## Goals

- Operator-driven, one-shot CLI invocation. Not a server feature.
- Pick from the active games already in the database.
- Use real historical prices so cost bases and equity curves look plausible.
- Reuse the existing service-layer logic (`executeTrade`) so seeded data is indistinguishable from real trades.

## Non-goals

- Generating limit/stop/bracket/working orders. Only plain `market` buys and sells.
- Seeding multiple games per run.
- HTTP/API-based seeding. This script writes directly via Drizzle.
- Backfilling watchlists or admin audit log.

## Layout

```
tools/
  seed-game-history/
    package.json
    tsconfig.json
    src/
      index.ts            # entry: orchestrate the run
      select-game.ts      # list active games + readline prompt
      seed-players.ts     # create N users + enroll in game
      seed-trades.ts      # per-player trade-sequence generator + writer
      historical-prices.ts# fetch + cache daily bars per symbol
      symbols.ts          # hardcoded blue-chip symbol pool
      rng.ts              # random helpers (int range, pick, gaussian)
```

`pnpm-workspace.yaml` is extended to include `tools/*` so the new package can import from `@markettrader/server` and `@markettrader/shared`.

Run command (added to the root `package.json` for convenience):

```
pnpm seed:history
# → pnpm --filter @markettrader/tools-seed-game-history start
```

## Service-layer change

`packages/server/src/services/trade.ts` — `ExecuteTradeParams` gains one optional field:

```typescript
/**
 * Optional override for the trade's executed timestamp. Used only by the
 * seed-game-history tool to backdate synthetic trades. MUST NOT be forwarded
 * from any HTTP request body — route handlers construct ExecuteTradeParams
 * explicitly and never spread untrusted input into it.
 */
executedAt?: string;
```

When set, the value replaces `new Date().toISOString()` inside the transaction. Default behaviour is unchanged.

**Spoof-safety check (part of plan):** grep `executeTrade(` call sites in `packages/server/src/routes/**` and confirm none spread `request.body` into the params object. Current call sites construct the object field-by-field (trading route, pending-trade service, working-order service) — safe by construction. Plan re-verifies this before adding the field.

## Run flow

1. **Bootstrap.** Load `../../.env` (same pattern as `packages/server`), import `db` and `schema` from `@markettrader/server`.
2. **Pick game.** Query `games` where `status='active'`. For each candidate, call `recomputeGameStatus` to guard against stale `status` values. Print a numbered list:
   ```
   1) Spring Showdown    2026-04-01 → 2026-06-01   (a1b2c3…)
   2) Office League      2026-05-10 → 2026-07-10   (d4e5f6…)
   Pick a game [1-2]:
   ```
   Read stdin via Node's `readline/promises`.
3. **Roll counts.**
   - `playerCount = randInt(5, 20)` inclusive
   - per-player `tradeCount = randInt(10, 60)` inclusive
4. **Pre-fetch prices.** For every symbol in the hardcoded pool, call `provider.getHistory(symbol, range)` once. `range` is chosen as the smallest `StockHistoryRange` enum value that covers `[game.startDate, now]` (`1mo`/`3mo`/`6mo`/`1y`/`5y`). Bars are stored as `Map<symbol, Array<{ time, close }>>`. Bar resolution is daily — all trades on a given calendar day for a symbol share that day's close.
5. **Create players.** Hash the constant `SEED_USER_PASSWORD = 'seedseed'` once with argon2, reuse the hash for every insert. Usernames: `seed_<game-shortid>_<n>_<rand4>` to keep them unique across runs and recognizable in the UI. Insert one `users` row and one `gamePlayers` row each, with `cashBalance = game.startingBalance`.
6. **Seed trades per player.**
   - Generate `tradeCount` random ISO timestamps uniformly in `[game.startDate, now]`, sort ascending.
   - Walk the timestamps. At each step, build constrained-random params:
     - Decide direction: `sell` only if the player holds any symbol; otherwise `buy`. Bias toward `buy` ~60% of the time when both are available.
     - Pick symbol: random from pool for `buy`, random held symbol for `sell`.
     - Pick quantity: random integer in `[1, min(maxAffordable, 50)]` for `buy` and `[1, currentHolding]` for `sell`.
     - Look up price: latest bar with `time ≤ trade timestamp` for that symbol. If no bar exists yet (timestamp before earliest bar) → skip this trade.
   - Call `executeTrade(db, { ..., executedAt: tradeTimestamp })`.
   - Catch `TradeError` → log at debug level and continue (cash drift between generation and validation is expected occasionally). Re-throw everything else.
7. **Summary.** Print:
   ```
   Seeded "Spring Showdown" (id=a1b2c3…)
     Players created: 12
     Trades inserted: 387
     Trades skipped:  14   (no historical bar / validation rejection)
     Login password for all seeded users: seedseed
   ```

## Symbol pool

Hardcoded in `symbols.ts` — 36 large-cap US equities across tech, finance,
healthcare, consumer, energy, industrials, semis, and telecom. Wide enough
that random selection produces visibly varied portfolios.

```typescript
export const SEED_SYMBOLS = [
  // Mega-cap tech
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA',
  // Finance
  'BRK-B', 'JPM', 'V', 'MA', 'BAC',
  // Healthcare / pharma
  'LLY', 'UNH', 'JNJ', 'ABBV', 'PFE', 'TMO',
  // Consumer / retail
  'WMT', 'COST', 'PG', 'HD', 'KO', 'PEP', 'MCD', 'DIS',
  // Energy
  'XOM', 'CVX',
  // Semis / software
  'AVGO', 'AMD', 'INTC', 'ORCL', 'ADBE', 'CRM', 'NFLX',
  // Telecom
  'T',
];
```

Note: `BRK-B` uses Yahoo's hyphen convention for class-B share tickers; the
existing `YahooProvider.getHistory` accepts the same symbol format the rest
of the app uses, so no special casing required.

## Data invariants preserved

- `executeTrade` enforces positive-integer quantity, sufficient cash, sufficient shares, and weighted-average cost basis. The seed script does not bypass any of this.
- `gamePlayers.cashBalance` ends each run consistent with the inserted trade rows.
- `portfolios.quantity > 0` for every row (zero-quantity rows are deleted by `executeTrade`).
- Each `trade.status = 'executed'`, `orderType = 'market'`, `timeInForce = 'day'`, `executedAt` and `price` populated.

## Files created

- `tools/seed-game-history/package.json`
- `tools/seed-game-history/tsconfig.json`
- `tools/seed-game-history/src/index.ts`
- `tools/seed-game-history/src/select-game.ts`
- `tools/seed-game-history/src/seed-players.ts`
- `tools/seed-game-history/src/seed-trades.ts`
- `tools/seed-game-history/src/historical-prices.ts`
- `tools/seed-game-history/src/symbols.ts`
- `tools/seed-game-history/src/rng.ts`

## Files modified

- `pnpm-workspace.yaml` — add `tools/*` to `packages:` glob list.
- `package.json` (root) — add `"seed:history"` script.
- `packages/server/src/services/trade.ts` — add optional `executedAt?: string` to `ExecuteTradeParams` and use it inside `executeTrade`'s transaction.
- `packages/server/package.json` — add `"./services/trade"` export entry if not already present (verify during plan; may be unneeded if internal imports work).

## Verification

1. **Setup.**
   ```bash
   pnpm install
   pnpm --filter server dev   # ensures DB migrated and at least one active game exists
   ```
   In another terminal, create an active game via the admin API or UI.
2. **Run.**
   ```bash
   pnpm seed:history
   ```
   Select the active game from the prompt.
3. **Expected stdout.** A summary block matching the format above with non-zero player and trade counts.
4. **DB checks** (Drizzle Studio or `sqlite3 dev.db`):
   - `SELECT COUNT(*) FROM users WHERE username LIKE 'seed_%'` ≥ 5
   - `SELECT COUNT(*) FROM game_players WHERE game_id = '<id>'` matches the printed player count
   - `SELECT COUNT(*) FROM trades WHERE game_player_id IN (...)` matches the printed trade count
   - All seeded `trades.executed_at` values lie within `[game.start_date, now]`
5. **UI check.** Open the frontend, log in as one of the seeded users (`seed_<…>` / `seedseed`), and verify the trade history page, portfolio breakdown, and game leaderboard all render with the seeded data.
6. **Typecheck + lint.**
   ```bash
   pnpm typecheck
   pnpm lint
   ```
7. **Existing tests.** `pnpm test` — must still pass; the optional field on `ExecuteTradeParams` is backward compatible, so no existing test should break.

## Open questions / risks

- **Yahoo provider rate limits.** Pre-fetching 10 symbols at startup is well below any reasonable limit, but if the operator runs the script repeatedly, the `CachedProvider` 30s cache helps for `getQuote` but does not cache `getHistory`. Acceptable for a manual tool.
- **Cash drift skip-rate.** With constrained-random selection, expected skip rate is low (< 5%). If it climbs much higher in practice, revisit the quantity-sizing heuristic.
