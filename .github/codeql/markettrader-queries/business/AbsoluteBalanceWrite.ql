/**
 * @name Absolute cash or share-count write
 * @description gamePlayers.cashBalance and portfolios.quantity must be updated relative to the stored value (a sql`` expression), because an absolute value computed from an earlier read loses concurrent updates under READ COMMITTED.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/absolute-balance-write
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader
import business.BusinessLib

/**
 * Admin routes whose whole purpose is an absolute write:
 * - `PATCH /admin/players/:playerId/cash` sets the balance to an operator-chosen value;
 * - `POST /admin/games/:id/reset` restores every player to `startingBalance`
 *   in the same transaction that deletes all their trades and holdings.
 * Neither derives the new value from an earlier read, so there is no update to lose.
 * The exemption is tied to the value as well as the route (the operator's value
 * straight from `request.body`, resp. a `startingBalance`), so any other
 * absolute write added to those handlers is still flagged.
 */
predicate intentionalAbsoluteWrite(Business::DrizzleWrite w, DataFlow::Node value) {
  exists(MarketTrader::RouteRegistration r | r = Business::enclosingRoute(w.asExpr()) |
    r.getMethodName() = "patch" and
    r.getPath() = "/admin/players/:playerId/cash" and
    fromRequestBody(value)
    or
    r.getMethodName() = "post" and
    r.getPath() = "/admin/games/:id/reset" and
    exists(PropAccess p | p.getParent*() = value.asExpr() | p.getPropertyName() = "startingBalance")
  )
}

/** Holds if `v` is `request.body.x`, or a variable destructured from `request.body`. */
predicate fromRequestBody(DataFlow::Node v) {
  exists(MarketTrader::RequestInput b, DataFlow::PropRead pr |
    b.getKind() = "body" and
    pr = v.getALocalSource() and
    b.(DataFlow::SourceNode).flowsTo(pr.getBase())
  )
}

from Business::DrizzleWrite w, string column, DataFlow::Node value
where
  MarketTrader::isServerSrc(w.getFile()) and
  w.getOp() = "update" and
  (
    w.getTable() = "gamePlayers" and column = "cashBalance"
    or
    w.getTable() = "portfolios" and column = "quantity"
  ) and
  value = Business::payloadValue(w, column) and
  not Business::isSqlTemplate(value.asExpr()) and
  not intentionalAbsoluteWrite(w, value)
select value,
  "Absolute write to " + w.getTable() + "." + column +
    ": a value computed from an earlier read overwrites concurrent changes. Write it relative to the column, e.g. sql`${" +
    w.getTable() + "." + column + "} + ${delta}`, with a guard predicate in the where clause."
