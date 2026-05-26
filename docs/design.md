# MarketTrader — Evolving Design Document

This document describes the current design intent for MarketTrader. It is updated as features are designed or changed. For the full initial spec, see `docs/superpowers/specs/2026-05-08-markettrader-design.md`. For the rationale behind technology choices, see `docs/technical-decisions.md`.

---

## Product Vision

MarketTrader lets groups of friends run virtual stock trading tournaments. Players join a time-bounded "game", start with the same virtual cash, and compete to build the most valuable portfolio by trading real stocks at real market prices. A live leaderboard tracks rankings throughout the game.

Target audience: small friend groups (2–20 players), casual investors, people learning markets in a low-stakes way.

---

## Core User Flows

### 1. Register and log in
User picks a username and password. JWT token returned. No email required (MVP).

### 2. Create a game
- Set a name, start date, end date, and starting balance (e.g. $100,000)
- Game status: `pending` until start date, `active` during the trading window, `ended` after end date
- Share the game ID/link with friends

### 3. Join a game
- Any registered user can join any game by ID before it starts (or while active, with caveat: balance starts fresh even if game has been running)

### 4. Trade
- Search for a stock ticker (e.g. "AAPL")
- Enter quantity, choose Buy or Sell
- Server fetches current price, validates (enough cash to buy, enough shares to sell), executes immediately
- Balance and portfolio updated atomically

### 5. Monitor portfolio
- View current holdings with unrealized P&L
- View trade history
- See leaderboard ranking in real-time

### 6. Game ends
- Status flips to `ended` at `endDate`
- Final leaderboard snapshot is preserved
- No more trades accepted

---

## Entities (current version: MVP)

See the spec for full schema. Summary:

| Entity | Purpose |
|---|---|
| `User` | Account (username + password) |
| `Game` | A tournament with rules (dates, starting balance) |
| `GamePlayer` | A user's participation in a game + their cash balance |
| `Portfolio` | Current stock holdings per player per game |
| `Trade` | Immutable log of every buy/sell executed |
| `StockPriceCache` | Short-lived cache of fetched stock prices |

---

## System Boundaries

```
Browser (React SPA)
    │
    ├── REST (JSON) ────────────→ Fastify Server
    │                                   │
    └── WebSocket ──────────────────────┤
                                        ├── PostgreSQL / SQLite (Drizzle)
                                        └── Stock Price Provider (pluggable)
                                                ├── Yahoo Finance (default)
                                                ├── Alpaca Markets
                                                └── Polygon.io
```

---

## Key Business Rules

1. **Trade execution is immediate.** Orders fill instantly at the last fetched price. No order book, no bid/ask spread (MVP).
2. **No short selling.** Players can only sell shares they own.
3. **No fractional shares.** Quantity must be a positive integer.
4. **Cash balance must cover the purchase.** `quantity × price ≤ cashBalance` must hold at execution time.
5. **Trades only accepted while game is `active`.** Rejected with 409 if the game is `pending` or `ended`.
6. **Portfolio value** = `cashBalance + Σ(quantity × currentPrice)` for all holdings.
7. **Leaderboard rank** = descending order of portfolio value.

---

## Real-Time Behavior

The server maintains a set of "watched symbols" per active game (union of all symbols any player holds). A price polling loop (configurable interval, default 5s) fetches prices for all watched symbols and broadcasts `price_update` events to all connected clients in that game's WebSocket channel.

After each trade, the server rebroadcasts a `leaderboard_update` event recalculated with the latest prices.

---

## Feature Roadmap (post-MVP)

These are candidates for future design cycles. None are committed.

- **Game invite codes** — a shareable token instead of a raw UUID
- **Limit orders** — place an order at a target price, fill when market crosses it
- **Short selling** — borrow shares to sell, buy back later
- **Admin tools** — game creator can remove players, extend game end date
- **Game templates** — preset configurations (e.g., "30-day $10k challenge")
- **Notifications** — push/email when a trade executes or when you move up/down the leaderboard
- **Historical price charts** — candlestick chart for each symbol the player holds

---

## Open Questions

| Question | Status |
|---|---|
| Should games be public (discoverable) or private (join by ID only)? | Deferred to post-MVP |
| What happens to stock price cache when market is closed? | Use last known price, mark as "stale" |
| Should there be a rate limit on trades per player per game? | Not in MVP |

---

## Known Gaps

### Resting / pending-market sell realized P&L

For limit/stop sell orders that fill via the trigger worker — and for pending
market sells that settle via the market-hours worker — the portfolio row is
decremented at *placement* (when the order is queued), not at fill. By the time
`executeTrade` (or `settlePendingTrades`) finalises the fill, the cost basis is
already gone. Consequence:

- `ExecuteTradeResult.realizedPnl`, `realizedPnlPct`, `holdDurationMs`, and
  `fullyClosed` are zero/false for these fills.
- The trade-emit helper (`services/trade-emit.ts`) suppresses
  `position.closed` for resting/pending sells (`isResting: true` at the call
  site). The `holdings.changed` event still fires with accurate
  `distinctSymbols` / `topConcentrationRatio` / `cashRatio`.
- Achievements that subscribe to `position.closed` (Moonshot, Ten-Bagger, Bag
  Holder, Catastrophe, Paper Hands, Diamond Hands, First Blood, etc.) will NOT
  fire on resting or pending-market sell fills.

Acceptable for now; revisit by capturing the cost basis at placement time
(e.g. snapshot `avgCostBasis` onto the working/pending `trades` row) once
resting orders become more common.
