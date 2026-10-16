/**
 * @name Open order inserted without the per-player cap
 * @description Every insert of a 'working' or 'pending' trade must sit behind the MAX_OPEN_ORDERS_PER_PLAYER check, or a player can queue unbounded resting rows that the workers and price poller re-process every tick.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/open-order-cap-missing
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader
import business.BusinessLib

/** Holds if `f` (or a function nested in it) reads `MAX_OPEN_ORDERS_PER_PLAYER`. */
predicate readsCap(Function f) {
  exists(VarAccess v | v.getName() = "MAX_OPEN_ORDERS_PER_PLAYER" | f = Business::enclosingContainer(v))
}

/** Holds if `f` enforces the cap itself or calls a function that does. */
predicate enforcesCap(Function f) {
  readsCap(f)
  or
  exists(DataFlow::CallNode c, Function callee |
    f = Business::enclosingContainer(c.asExpr()) and
    callee = c.getACallee() and
    readsCap(callee)
  )
}

/** Holds if `f` is called from a function in its own file that enforces the cap. */
predicate guardedBySameFileCaller(Function f) {
  exists(DataFlow::CallNode c, Function caller |
    c.getACallee() = f and
    caller = Business::scopeFunction(c.asExpr()) and
    caller.getFile() = f.getFile() and
    enforcesCap(caller)
  )
}

/**
 * Holds if the `status` written by `ins` may be `status`: a literal, a branch
 * of a conditional, or a local constant.
 */
predicate mayInsertStatus(Business::DrizzleWrite ins, string status) {
  status = ["working", "pending"] and
  exists(DataFlow::Node v, StringLiteral s | v = Business::payloadValue(ins, "status") |
    (s.getParent*() = v.asExpr() or s.getParent*() = v.getALocalSource().asExpr()) and
    s.getValue() = status
  )
}

from Business::DrizzleWrite ins, string status, Function f
where
  ins.getOp() = "insert" and
  ins.getTable() = "trades" and
  MarketTrader::isServerSrc(ins.getFile()) and
  status = min(string s | mayInsertStatus(ins, s) | s) and
  f = Business::scopeFunction(ins.asExpr()) and
  not enforcesCap(f) and
  not guardedBySameFileCaller(f)
select ins,
  "This inserts a '" + status + "' trade, but $@ never checks MAX_OPEN_ORDERS_PER_PLAYER. Count the player's working+pending rows inside the same transaction and refuse past the cap, as placeWorkingOrder does.",
  f, Business::functionLabel(f)
