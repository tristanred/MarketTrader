/**
 * @name Route mounted before websocket/otel plugin
 * @description In buildApp, registerWebsocket and registerOtel must run before any route is mounted, because both plugins only affect routes declared after them.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/plugin-order
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader
import bootstrap.BootstrapLib

/** A call inside `buildApp` (at any nesting of blocks/ifs, not inside nested functions). */
class BuildAppCall extends DataFlow::CallNode {
  Bootstrap::BuildApp f;

  BuildAppCall() { this.getContainer() = f }

  Bootstrap::BuildApp getBuildApp() { result = f }
}

/** A call in `buildApp` that mounts routes or route-scoped plugins. */
class RouteMountingCall extends BuildAppCall {
  RouteMountingCall() {
    exists(DataFlow::MethodCallNode m | m = this |
      m.getMethodName() = ["register", "route"] and
      // Only the Fastify instance itself, not an unrelated `registry.register(...)`.
      (
        m.getReceiver().getALocalSource().(DataFlow::CallNode).getCalleeName() = "Fastify"
        or
        m.getReceiver().asExpr().(VarAccess).getName() = "app"
      )
    )
    or
    this instanceof MarketTrader::RouteRegistration
    or
    this.getCalleeName() = ["registerSwagger", "registerAdminGuard"]
  }

  string describe() {
    result = this.getCalleeName() + "(...)" and
    not this instanceof DataFlow::MethodCallNode
    or
    exists(DataFlow::MethodCallNode m | m = this |
      result = "app." + m.getMethodName() + "(...)"
    )
  }
}

from RouteMountingCall r, string plugin
where
  plugin = ["registerWebsocket", "registerOtel"] and
  not exists(BuildAppCall p |
    p.getBuildApp() = r.getBuildApp() and
    p.getCalleeName() = plugin and
    Bootstrap::before(p.asExpr(), r.asExpr())
  )
select r,
  r.describe() + " runs before " + plugin +
    "(app) in buildApp; register " + plugin + " first so it applies to every route."
