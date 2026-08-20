---
"@markettrader/frontend": patch
"@markettrader/server": patch
---

Fix the WebSocket reconnect loop that produced ~15k reconnects/day per browser session.

Both socket hooks now share `ReconnectController`: exponential backoff with jitter, a 30s ceiling, and a 10-attempt cap. The attempt counter clears only after a connection has stayed open for 30s, so a socket that opens and immediately drops no longer resets to a 1s delay on every cycle. `useIndicesSocket` had no backoff at all and reconnected on a flat 5s timer.

When a socket spends its attempt budget it stops instead of looping forever; the `LIVE` pill in the status strip becomes a retry button, and the connection also re-tests itself when the browser comes back online or the tab returns to the foreground.

Server-side, `startWsHeartbeat` pings every connected client every `WS_HEARTBEAT_INTERVAL_MS` (default 30s) and terminates clients that missed the previous ping, so idle sockets are not silently reaped by an intermediary.
