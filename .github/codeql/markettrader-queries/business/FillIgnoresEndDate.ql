/**
 * @name Fill path trusts games.status without endDate
 * @description games.status only moves to 'ended' when recomputeGameStatus runs, so a worker that fills or settles orders for games filtered by status='active' must also bound games.endDate (or recompute first), or it trades past the competition deadline.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/fill-ignores-end-date
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader
import business.BusinessLib

/** `eq(games.status, 'active')`. */
class ActiveGameFilter extends DataFlow::CallNode {
  ActiveGameFilter() {
    this.getCalleeName() = "eq" and
    exists(PropAccess p | p = this.getArgument(0).asExpr().getUnderlyingValue() |
      p.getPropertyName() = "status" and
      Business::namesTable(p.getBase(), "games")
    ) and
    this.getArgument(1).getStringValue() = "active"
  }
}

/**
 * Holds if `f` fills or settles orders: it calls `executeTrade`, or writes
 * `status: 'executed'` to a trade row itself.
 */
predicate isFillPath(Function f) {
  exists(DataFlow::CallNode c |
    c.getCalleeName() = "executeTrade" and f = Business::enclosingContainer(c.asExpr())
  )
  or
  exists(Business::DrizzleWrite w |
    w.getTable() = "trades" and
    Business::payloadValue(w, "status").getStringValue() = "executed" and
    f = Business::enclosingContainer(w.asExpr())
  )
}

/** Holds if `f` brings statuses up to date before trusting them. */
predicate recomputesStatus(Function f) {
  exists(DataFlow::CallNode c |
    c.getCalleeName() = ["recomputeGameStatus", "recomputeMany"] and
    f = Business::enclosingContainer(c.asExpr())
  )
}

/** The argument of the `.where(...)` call that `filter` sits in. */
Expr whereArgument(ActiveGameFilter filter) {
  exists(DataFlow::MethodCallNode whereCall |
    whereCall.getMethodName() = "where" and
    result = whereCall.getArgument(0).asExpr() and
    filter.asExpr().getParent*() = result
  )
}

/** Holds if `e` mentions `games.endDate`. */
predicate boundsEndDate(Expr e) {
  exists(PropAccess p | p.getParent*() = e |
    p.getPropertyName() = "endDate" and Business::namesTable(p.getBase(), "games")
  )
}

from ActiveGameFilter filter, Function f
where
  MarketTrader::isServerSrc(filter.getFile()) and
  f = Business::scopeFunction(filter.asExpr()) and
  isFillPath(f) and
  not recomputesStatus(f) and
  not boundsEndDate(whereArgument(filter))
select filter,
  "$@ selects orders to fill by games.status = 'active' alone, and this path never recomputes game status, so orders keep filling after endDate until some request happens to recompute it. Add gt(games.endDate, nowIso) to this where clause (recomputeGameStatus treats now >= endDate as ended), or call recomputeGameStatus first.",
  f, Business::functionLabel(f)
