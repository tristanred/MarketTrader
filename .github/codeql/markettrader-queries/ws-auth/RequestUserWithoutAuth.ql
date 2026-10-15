/**
 * @name request.user read outside an authenticated route
 * @description `request.user` is only populated by the `authenticate`/`requireAdmin` hooks, so it may only be read inside the handler of a route that attaches one (or by the guards themselves and the defensive error capture).
 * @kind problem
 * @problem.severity error
 * @id markettrader/request-user-without-auth
 * @tags security
 *       correctness
 *       external/cwe/cwe-306
 * @precision high
 */

import javascript
import lib.MarketTrader
import WsAuthLib

/** A read of `request.user` / `req.user`, including `const { user } = request`. */
class RequestUserRead extends WsAuth::RequestPropRead {
  RequestUserRead() { this.getPropertyName() = "user" }
}

/** Files that legitimately read `request.user` outside a route handler. */
predicate isAllowedFile(File f) {
  // The guards populate and then read it.
  MarketTrader::serverFile(f, "plugins/jwt.ts")
  or
  MarketTrader::serverFile(f, "plugins/admin-guard.ts")
  or
  // Error capture reads it defensively, typed as possibly undefined.
  MarketTrader::serverFile(f, "observability/error-capture.ts")
}

from RequestUserRead read
where
  MarketTrader::isServerSrc(read.getFile()) and
  not isAllowedFile(read.getFile()) and
  not exists(MarketTrader::RouteRegistration r |
    WsAuth::hasAuthGuard(r) and
    WsAuth::nestedIn(read.getContainer(), r.getHandler().getFunction())
  )
select read,
  "request.user is read outside the handler of a route guarded by authenticate/requireAdmin; it is unset there. Add the auth hook to the route or pass the user id in explicitly."
