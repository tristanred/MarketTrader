---
'@markettrader/server': patch
'@markettrader/frontend': patch
---

Clear all open Dependabot advisories. Refreshes the lockfile and raises dependency
floors so the fixes stick, upgrades `@fastify/swagger-ui` to v6 (the only route to a
patched `@fastify/static`), and unpins the exact-version `vite` override that was
holding the frontend on a vulnerable 6.4.2.
