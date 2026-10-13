---
'@markettrader/server': minor
'@markettrader/frontend': minor
'@markettrader/shared': minor
---

PostHog: product analytics, error tracking, session replay, and log export (ADR-016).
Business events are captured server-side from the domain event bus; the browser reaches
PostHog through a same-origin `/relay` proxy and loads the SDK after first render. Server
5xx go to PostHog error tracking, and pino logs can be exported to PostHog Logs. All of it
is off unless `POSTHOG_KEY`/`POSTHOG_HOST` (server) and `VITE_POSTHOG_KEY`/`VITE_POSTHOG_HOST`
(build) are set. Deployments need a `/relay` route on the reverse proxy.
