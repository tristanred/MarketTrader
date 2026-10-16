---
'@markettrader/frontend': patch
'@markettrader/server': patch
'@markettrader/shared': patch
---

Security: upgrade fastify, @fastify/jwt and yahoo-finance2, and refresh vulnerable transitive dependencies flagged by Dependabot. `TRUST_PROXY` no longer accepts a hop count: Fastify 5.12.7 treats a numeric `trustProxy` as trusting nothing, so the server now refuses one at boot. Use `loopback`, `uniquelocal`, or the proxy's address instead.
