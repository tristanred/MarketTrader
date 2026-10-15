/**
 * @name Pending trade cancelled without the cancel helper
 * @description Flipping a pending trade to 'cancelled' must release both reservations (cash for a buy, shares for a sell); only cancelPendingTrade / cancelWorkingOrder do that, so other code must call them instead of writing the status.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/direct-pending-cancel
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader
import business.BusinessLib

/**
 * The order-lifecycle services own every reservation release: the cancel
 * helpers themselves, the settlement worker's insufficient-funds cancel (buy
 * branch, refunds in place) and the OCO sibling cancel (bracket children hold
 * no reservation). Their status writes are deliberate.
 */
predicate inLifecycleService(File f) {
  MarketTrader::serverFile(f, "services/pending-trade.ts") or
  MarketTrader::serverFile(f, "services/working-order.ts")
}

/**
 * Holds if the update's where clause restricts the row to an open status:
 * a `'pending'`/`'working'` literal (`eq`, `inArray`, ...) or a raw
 * sql`... IN ('working', 'pending')` fragment, also through a local variable.
 */
predicate targetsOpenOrder(Business::DrizzleWrite w, string status) {
  status = ["pending", "working"] and
  exists(Expr cond |
    cond = w.getWhere().asExpr() or cond = w.getWhere().getALocalSource().asExpr()
  |
    exists(StringLiteral s | s.getParent*() = cond and s.getValue() = status)
    or
    exists(TemplateElement t |
      t.getParent*() = cond and t.getValue().matches("%'" + status + "'%")
    )
  )
}

from Business::DrizzleWrite w, DataFlow::Node statusWrite, string statuses
where
  MarketTrader::isServerSrc(w.getFile()) and
  not inLifecycleService(w.getFile()) and
  w.getOp() = "update" and
  w.getTable() = "trades" and
  statusWrite = Business::payloadValue(w, "status") and
  statusWrite.getStringValue() = "cancelled" and
  targetsOpenOrder(w, _) and
  statuses = strictconcat(string s | targetsOpenOrder(w, s) | s, "/" order by s)
select statusWrite,
  "This sets a '" + statuses +
    "' trade to 'cancelled' directly, so only the reservation this code remembers to undo is released (e.g. a sell's reserved shares are never restored). Call cancelPendingTrade (pending) or cancelWorkingOrder (working) instead."
