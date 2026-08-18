---
'@markettrader/server': patch
'@markettrader/frontend': patch
---

Stop trusting client-supplied proxy headers, which made every per-IP rate limit
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
