---
'@markettrader/frontend': patch
---

Upgrade the frontend to `zod` v4 and `@hookform/resolvers` v5, fixing a build
break. `yahoo-finance2` v4 pulled `zod@4` into the tree, pnpm hoisted it, and
`@hookform/resolvers@3` — which declares no zod dependency at all — resolved its
own `zod` import to that hoisted v4 copy while the app code was on v3, so every
`zodResolver()` call failed to typecheck. Resolvers v5 declares zod as a real
peer, so the fall-through cannot recur. Form behaviour is unchanged; the server
stays on zod v3 for `fastify-type-provider-zod`.
