---
'@markettrader/frontend': minor
'@markettrader/server': minor
'@markettrader/shared': minor
---

Admin configuration panel at `/admin/config`: every option the server reads from its environment, with its effective value (secrets masked), where it came from, and whether it can change live. Cache TTLs, rate-limit backoff, stale-trade policy, market-hours mode, login-throttle thresholds, worker intervals, and watchlist/poller caps can be overridden from the panel; overrides apply immediately, persist across restarts, and win over the environment until reset. The pending-orders worker now runs in every market-hours mode, so limit/stop/bracket orders fill and day orders expire on servers using the default `instant` mode too.
