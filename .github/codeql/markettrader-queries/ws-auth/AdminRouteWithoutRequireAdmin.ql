/**
 * @name Admin route not guarded by requireAdmin
 * @description Every `/admin` route (and every route declared under `routes/admin/`) must use the `requireAdmin` hook; `authenticate` alone admits any signed-in player.
 * @kind problem
 * @problem.severity error
 * @id markettrader/admin-route-without-require-admin
 * @tags security
 *       external/cwe/cwe-285
 * @precision high
 */

import javascript
import lib.MarketTrader
import WsAuthLib

from MarketTrader::RouteRegistration r
where
  (
    r.getPath() = "/admin"
    or
    r.getPath().matches("/admin/%")
    or
    MarketTrader::serverFile(r.getFile(), "routes/admin/%")
  ) and
  not WsAuth::hasGuard(r, "requireAdmin")
select r,
  "Admin route " + r.getMethodName().toUpperCase() + " " + r.getPath() +
    " is not guarded by requireAdmin; use `onRequest: rawApp.requireAdmin`."
