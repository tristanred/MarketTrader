# CodeQL invariant queries

`.github/workflows/codeql.yml` runs GitHub's `security-extended` suite plus the project's own
query pack, `markettrader/invariants`. The custom queries turn rules from `CLAUDE.md` and the
business rules into checks: each one fails loudly when code drifts from an invariant that tests
don't naturally cover. Results show up in the repository's Security tab and as PR annotations.

## Layout

```
.github/codeql/
  codeql-config.yml           ← suites + paths (packages/*/src only — tests, tools, e2e are not scanned)
  codeql-workspace.yml        ← lets the test pack resolve the query pack locally
  markettrader-queries/       ← the pack (markettrader/invariants)
    lib/MarketTrader.qll      ← shared vocabulary: file scopes, log/analytics/response/span/metric sinks, routes
    <group>/<Query>.ql        ← one query per invariant; <group>/<Group>Lib.qll for group helpers
  markettrader-tests/         ← query tests (markettrader/invariants-tests)
    <group>/<Query>/          ← <Query>.qlref, <Query>.expected, fixtures at repo-shaped paths
```

Groups: `secrets` (credential and PII flows), `dataflow` (money, metrics, trade inputs),
`ws-auth` (WebSocket and route-auth structure), `business` (DB and business-rule structure),
`bootstrap` (app wiring and observability), `restrictions` ("X only in file Y").

## Severity policy

- `error` (with `@security-severity`): a credential or secret leak, an auth bypass, or a
  DOM-injection sink. All of these hold today, so any new alert at this level is a regression
  and fails the code-scanning check.
- `warning`: business-rule and structural invariants, including every invariant with a known
  violation in the code today. Warnings annotate the PR without failing the check.

Known violations are left in place on purpose; they are tracked as open alerts, not fixed in
this pass.

## Running locally

Install the CLI once with `gh extension install github/gh-codeql`, then:

```bash
gh codeql pack install .github/codeql/markettrader-queries
gh codeql pack install .github/codeql/markettrader-tests

# Query tests (what CI runs before analysis)
gh codeql test run --threads=0 .github/codeql/markettrader-tests

# Full analysis of the working tree
echo 'paths: [packages/server/src, packages/frontend/src, packages/shared/src]' > /tmp/paths.yml
gh codeql database create /tmp/mt-db --language=javascript --source-root=. --codescanning-config=/tmp/paths.yml --overwrite
gh codeql database analyze /tmp/mt-db .github/codeql/markettrader-queries --format=csv --output=/tmp/mt.csv
```

## Writing a query

- Fixtures must sit at **repo-shaped paths inside the test directory**
  (`markettrader-tests/<group>/<Query>/packages/server/src/routes/auth.ts`). The shared
  library scopes everything by path suffix, so a fixture at the test root is out of scope and
  the test silently passes with no results.
- A fixture file with no `import`/`export` is a script: its top-level `const`s are globals that
  data flow does not track. Add `export {}`.
- Read every line of a `--learn`-generated `.expected`. When a query fails to compile, `--learn`
  writes the compiler errors into `.expected` and still reports PASSED.
- Do not `extends DataFlow::PropRead` (it is abstract); use
  `extends DataFlow::Node instanceof DataFlow::PropRead`.
- Compile errors surface among many `overlay[...]` lines from `codeql/javascript-all`; filter
  them out with `grep -v 'overlay\['` to see the real error.
- Before trusting a zero-result query, drop its allowlist or guard in a scratch copy and confirm
  the legitimate sites appear. A sink that matches nothing also returns zero results.

## Catalogue

Status is as of the commit that introduced the pack. "Holds" means zero results.

### secrets

| Query id | Invariant | Status |
|---|---|---|
| `access-token-leak` | Access/refresh tokens travel only in the Authorization header, the WS subprotocol offer, the refresh cookie or the auth response — never logs, telemetry, close reasons, URLs, web storage or the `handleProtocols` echo | Holds |
| `secret-env-leak` | `JWT_SECRET`, Alpaca keys, `POSTHOG_KEY`, `DATABASE_URL` reach only their consuming client | Holds |
| `plaintext-password-leak` | Passwords reach only argon2 (and the seeded admin password only its one `console.log`) | Holds |
| `refresh-token-leak` | The refresh token is delivered only via `setCookie('refreshToken', …)` | Holds |
| `refresh-cookie-not-httponly` | The refresh cookie is set with `httpOnly: true` | Holds |
| `refresh-cookie-read-outside-auth` | Only `routes/auth.ts` reads `request.cookies.refreshToken` | Holds |
| `pii-in-telemetry` | Usernames/emails/passwords stay out of logs, analytics, span and metric attributes | 2: `routes/auth.ts` failed-login log; frontend `lib/posthog.ts` `identify` traits |
| `unbounded-input-to-log-or-map` | Request strings with no Zod length bound are not logged or used as long-lived Map keys | 4: login `username` (no `.max()`) |

### dataflow

| Query id | Invariant | Status |
|---|---|---|
| `unbounded-metric-attribute` | Metric attribute values come from a closed set | 1: `tradesRejected` `reason` from the error string |
| `decimal-column-without-number` | Postgres decimal reads go through `Number()` before math, comparisons, responses, events or audit rows | 7, all in admin routes |
| `unguarded-quote-price` | Providers return only prices checked to be positive | 2: Yahoo `getQuote`/`getQuotes` |
| `executed-at-from-request` | `executedAt` never comes from request input | Holds |

### ws-auth

| Query id | Invariant | Status |
|---|---|---|
| `ws-listener-after-await` | WS handlers attach `close`/`error`/`message` before the first `await` | 5, in both WS routes |
| `route-missing-auth` | Non-public routes attach `authenticate`/`requireAdmin` | Holds |
| `admin-route-without-require-admin` | `/admin` routes use `requireAdmin` | Holds |
| `request-user-without-auth` | `request.user` is read only behind an auth hook | Holds |
| `jwt-verify-without-type-check` | Every JWT verify result is checked against its `type` claim | Holds |
| `refresh-type-outside-auth` | Only the refresh route and the token helpers compare against `REFRESH_TOKEN_TYPE` | Holds |
| `ws-close-code-literal` | Close codes are named constants | Holds |
| `close-code-number-outside-constants` | 1008/4400 literals appear only in the two constants modules | Holds |
| `invalid-frame-code-outside-message-listener` | 4400 is sent only from a `message` listener | Holds |
| `ws-message-handler-unguarded` | `message` listener bodies are wrapped in try/catch | Holds |
| `ws-send-outside-try` | Server `socket.send` sits in a try block | Holds |
| `route-input-without-schema` | Routes reading params/body/query declare the matching schema key | 1: `GET /games/:id/live` params |

### business

| Query id | Invariant | Status |
|---|---|---|
| `absolute-balance-write` | `cashBalance`/`quantity` updates are relative `sql` expressions | 5, in admin routes |
| `balance-write-outside-transaction` | Cash/holding writes run on a transaction handle | 1: creator seat insert in `routes/games.ts` |
| `open-order-cap-missing` | Working/pending inserts sit behind `MAX_OPEN_ORDERS_PER_PLAYER` | 1: `reservePendingTrade` |
| `direct-pending-cancel` | Pending cancels go through `cancelPendingTrade` (releases cash *and* shares) | 2, in admin routes |
| `audit-outside-mutation-transaction` | `recordAdminAction` runs in the mutation's transaction | 8 |
| `fill-ignores-end-date` | Fill/settle paths bound `games.endDate` or recompute status | 2: pending settle, trigger evaluation |
| `valuation-counts-bracket-children` | Valuation skips bracket children when adding reserved sells | 2: portfolio and leaderboard |
| `unbounded-quote-fan-out` | No per-item `getQuote` loops or unbounded `Promise.all` maps | 5 |

### bootstrap

| Query id | Invariant | Status |
|---|---|---|
| `plugin-order` | `registerWebsocket`/`registerOtel` precede every route mount in `buildApp` | Holds |
| `unpaired-background-start` | Every start in `buildApp` is stopped from `onClose` | Holds |
| `uncleared-set-interval` | Other server `setInterval`s are unref'd or cleared | Holds |
| `eager-metric-instrument` | Meters and instruments are never created at module load | Holds |
| `span-not-ended` | Span callbacks end the span in `finally` and record failures in `catch` | Holds |
| `high-cardinality-span-name` | Span names carry no request input, symbols or ids | Holds |

### restrictions

| Query id | Invariant | Status |
|---|---|---|
| `jwt-sign-outside-plugin` | Tokens are minted only in `plugins/jwt.ts` | Holds |
| `password-hash-lib-confinement` | argon2 only in the three auth files; no bcrypt | Holds |
| `process-env-outside-env-module` | `process.env` is read only in `env.ts` | 1: `providers/factory.ts` `MOCK_PRICES` |
| `posthog-js-import-confinement` | `posthog-js` only in frontend `lib/posthog.ts` | Holds |
| `posthog-node-confinement` | `posthog-node`, `capture`, `captureException` only in their observability modules | Holds |
| `vite-env-read-confinement` | `VITE_POSTHOG_*`/`VITE_OTEL_*` each read in one module | Holds |
| `stock-data-library-confinement` | Market-data libraries only under `providers/` | Holds |
| `server-outbound-http-confinement` | Raw outbound HTTP only in `providers/` and `observability/` | Holds |
| `otel-import-confinement` | OTel SDK packages only in `observability/otel.ts` | Holds |
| `frontend-otel-static-import` | The frontend OTel module is only loaded with dynamic `import()` | Holds |
| `build-global-confinement` | Build-time globals only in `build-info.ts`, behind `typeof` on the server | Holds |
| `raw-sql-outside-allowlist` | No raw SQL beyond the connection PRAGMAs | Holds |
| `server-math-random` | No `Math.random` on the server | Holds |
| `frontend-dangerous-dom-api` | No HTML-injection DOM APIs; `_blank` links carry `noopener` | Holds |

## Known limits

- `jwt-verify-without-type-check` checks that a `type` comparison exists in the same function,
  not that it runs before the claims are used.
- `plugin-order` recognises route-mounting helpers by name (`registerSwagger`,
  `registerAdminGuard`); a new helper that mounts routes must be added to its list.
- `unguarded-quote-price` does not see a positivity guard hidden inside a helper function.
- `decimal-column-without-number` does not model `.returning({...})` projections or relational
  `with:` nesting (neither exists today).
- The header-redaction gap is not expressible as a query: pino's `redact` list lacks
  `sec-websocket-protocol`, which is harmless only while no serializer logs request headers.
