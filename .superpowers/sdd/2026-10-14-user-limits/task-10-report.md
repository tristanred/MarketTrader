
# Task 10 report

Implemented per brief: limits/rate.ts (rateLimitFor, withPrivilegedIp, rateDenialLabel), registerRateLimit onExceeded, app.ts wiring + authRoutes(db, loginThrottle, limits), per-user configs on trades/cancels/by-code, withPrivilegedIp on auth/stocks/watchlists per-IP configs.

Ruling 10 applied in rate-routes.test.ts: account aged 365 days before the probation:false assertion; LIMIT_REGISTRATIONS_PER_IP_PER_DAY: 1000 added to runtimeConfig.

Tests: rate.test.ts + rate-routes.test.ts 14/14. Full `pnpm test` (server 1068, frontend 385), typecheck, lint all clean.

TDD evidence: deviation - implementation was written before the first test run, so no RED output was captured; GREEN only.

Concerns: none. Import order in auth.ts/stocks.ts puts the new limits imports first (lint passes).
