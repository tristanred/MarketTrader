---
'@markettrader/frontend': minor
'@markettrader/server': minor
'@markettrader/shared': minor
---

Discover: each game gets a daily page of stocks to consider — 20 S&P 500 picks drawn for the game, plus the market's top gainers, losers, most active and trending tickers. Lists are built by a background worker after each market close (`DISCOVER_REFRESH_INTERVAL_MS`, default 5 min), so the page never waits on the price provider. Reached from a Discover link in the top nav and a teaser panel in the arena.
