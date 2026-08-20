# @markettrader/frontend

## 1.1.1

### Patch Changes

- a49dc4e: Fix the WebSocket reconnect loop that produced ~15k reconnects/day per browser session.

  Both socket hooks now share `ReconnectController`: exponential backoff with jitter, a 30s ceiling, and a 10-attempt cap. The attempt counter clears only after a connection has stayed open for 30s, so a socket that opens and immediately drops no longer resets to a 1s delay on every cycle. `useIndicesSocket` had no backoff at all and reconnected on a flat 5s timer.

  When a socket spends its attempt budget it stops instead of looping forever; the `LIVE` pill in the status strip becomes a retry button, and the connection also re-tests itself when the browser comes back online or the tab returns to the foreground.

  Server-side, `startWsHeartbeat` pings every connected client every `WS_HEARTBEAT_INTERVAL_MS` (default 30s) and terminates clients that missed the previous ping, so idle sockets are not silently reaped by an intermediary.

- @markettrader/shared@1.1.1

## 1.1.0

### Minor Changes

- 8dd62af: Add OpenTelemetry traces, metrics, and logs across the server and the SPA, exported over OTLP to
  an OpenTelemetry Collector. Point `OTEL_EXPORTER_OTLP_ENDPOINT` at any OTLP/HTTP collector to view
  them. Everything is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

  Instrumentation is patch-free — `@fastify/otel` as a plugin, undici via `diagnostics_channel` —
  so no `node --import` bootstrap and no systemd change (ADR-015). Adds 12 domain metrics (trades,
  provider cache and rate limiting, WebSocket clients, worker ticks, achievements, events) plus
  browser traces, Web Vitals, and uncaught-error reporting.

  Sentry is removed. Its 5xx hook read `reply.statusCode` in `onError`, where Fastify has not
  applied the status yet, so it had been reporting every thrown 4xx as a server fault; the
  replacement reads `err.statusCode` first. Until a collector is configured, errors reach the
  process logs only and nothing alerts.

### Patch Changes

- b027237: Make the SPA behave like a real app when installed to the iOS home screen.

  The page carried an `apple-touch-icon` and nothing else, so the home-screen
  launcher opened inside Safari's chrome. It now declares
  `apple-mobile-web-app-capable` / `mobile-web-app-capable`, a home-screen title,
  `color-scheme`, and a `manifest.webmanifest` with `display: standalone`. The
  viewport gained `viewport-fit=cover`, without which every
  `env(safe-area-inset-*)` reports `0px`; a `.safe-area` utility pads the shell
  and the full-height pages out of the home indicator and the landscape notch.

  `apple-mobile-web-app-status-bar-style` is deliberately absent: the usual
  `black-translucent` forces white status-bar text, which is unreadable over the
  light "Paper" theme. iOS tints the bar from `theme-color` instead, so
  `themeStore` now rewrites that meta tag on every theme change — the theme is a
  class the user toggles independently of the OS preference, so a
  `media="(prefers-color-scheme: …)"` pair of tags cannot express it.

  Touch input fixes: username and symbol-search fields no longer get
  auto-capitalised or autocorrected, quantity and price fields open the numeric
  keypad, and fields below 16px are floored at 16px on coarse pointers — under
  that size iOS zooms the page in on focus and never zooms back out. The desktop
  scale is unchanged, and pinch-zoom is left enabled.

  **Two things do not ship by deploying this.** The out-of-repo reverse proxy
  needs `.webmanifest` mapped to `application/manifest+json` (the container
  `nginx.conf` in this repo already has it), and iOS caches the install — an
  existing home-screen icon must be removed and re-added before any of this
  takes effect.

- 1a9a2d3: Stop trusting client-supplied proxy headers, which made every per-IP rate limit
  bypassable.

  The server was built with `trustProxy: true`, so `request.ip` resolved to the
  leftmost entry of the caller's own `X-Forwarded-For` — and that is the key
  `@fastify/rate-limit` buckets on. Rotating the header gave a fresh bucket per
  request, lifting every cap including the 5/min on `POST /auth/login`. The
  trusted-proxy set is now bounded by a new `TRUST_PROXY` variable (default
  `loopback`), and `true` is refused in production. Both nginx sites now overwrite
  `X-Forwarded-For` rather than prepending the client's value.

  Login additionally gained a per-account failed-attempt throttle that does not
  depend on network identity at all, tunable via `LOGIN_MAX_FAILED_ATTEMPTS`,
  `LOGIN_FAILURE_WINDOW_MS` and `LOGIN_LOCKOUT_MS`. The sign-in form reports the
  resulting 429 instead of a generic failure.

  **The reverse-proxy change is not applied by deploying.** Proxy configuration is
  maintained outside this repo and has to be updated there.

- 3473c15: Clear all open Dependabot advisories. Refreshes the lockfile and raises dependency
  floors so the fixes stick, upgrades `@fastify/swagger-ui` to v6 (the only route to a
  patched `@fastify/static`), and unpins the exact-version `vite` override that was
  holding the frontend on a vulnerable 6.4.2.
- 5c78df9: Make the first quick-fill press in the trade dialog set the share count rather
  than add to it, so `+25` on a fresh dialog gives 25 instead of 26.

  The Shares field defaults to 1 and the quick-fill buttons were unconditionally
  additive, so the placeholder default was silently folded into every order sized
  that way. The quantity state now carries a `null` "not sized yet" sentinel — the
  field still shows 1, but the first `+N` press jumps straight to N. Once the order
  has been sized by any means (a quick-fill press, typing, the slider, Max or a %
  button) the buttons go back to adding, so `+25` twice is still 50. Reopening the
  dialog, picking a different symbol, or hitting Clear restores the behaviour.

  Clamping is unchanged: a first press still cannot exceed the buying-power or
  shares-held maximum.

- 72eb2e8: Upgrade the frontend to `zod` v4 and `@hookform/resolvers` v5, fixing a build
  break. `yahoo-finance2` v4 pulled `zod@4` into the tree, pnpm hoisted it, and
  `@hookform/resolvers@3` — which declares no zod dependency at all — resolved its
  own `zod` import to that hoisted v4 copy while the app code was on v3, so every
  `zodResolver()` call failed to typecheck. Resolvers v5 declares zod as a real
  peer, so the fall-through cannot recur. Form behaviour is unchanged; the server
  stays on zod v3 for `fastify-type-provider-zod`.
- Updated dependencies [8dd62af]
  - @markettrader/shared@1.1.0

## 1.0.0

### Major Changes

- First version release.

### Patch Changes

- Updated dependencies
  - @markettrader/shared@1.0.0
