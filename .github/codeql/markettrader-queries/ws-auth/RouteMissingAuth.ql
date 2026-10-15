/**
 * @name REST route without an auth hook
 * @description Every REST route must attach `authenticate` or `requireAdmin` as an `onRequest`/`preHandler` hook unless it is on the explicit public allowlist; a route that forgets the hook is reachable anonymously.
 * @kind problem
 * @problem.severity error
 * @id markettrader/route-missing-auth
 * @tags security
 *       external/cwe/cwe-306
 * @precision high
 */

import javascript
import lib.MarketTrader
import WsAuthLib

/**
 * Routes that are deliberately anonymous. Each one exists because the caller
 * cannot hold an access token yet (auth flow), or because the data is public
 * and rate-limited per IP (probes, market status, stock lookups, featured
 * games on the landing page).
 */
bindingset[path]
predicate isPublicPath(string path) {
  path =
    [
      "/auth/register", "/auth/login", "/auth/logout", "/auth/refresh", "/health", "/version",
      "/market/status", "/public/featured-games", "/stocks/search", "/stocks/:symbol"
    ]
  or
  path.matches("/stocks/:symbol/%")
}

from MarketTrader::RouteRegistration r
where
  not WsAuth::hasAuthGuard(r) and
  not isPublicPath(r.getPath()) and
  // WebSocket routes authenticate the subprotocol credential on upgrade.
  not WsAuth::isWebSocketRoute(r)
select r,
  "Route " + r.getMethodName().toUpperCase() + " " + r.getPath() +
    " has no authenticate/requireAdmin hook; add `onRequest: rawApp.authenticate` (or requireAdmin), or add the path to the public allowlist in this query with a justification."
