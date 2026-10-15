/**
 * @name Admin audit row not written in the mutation's transaction
 * @description recordAdminAction must run on the same transaction handle as the admin mutation it records, so the audit row and the change commit or roll back together.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/audit-outside-mutation-transaction
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader
import business.BusinessLib

/**
 * Holds if `f`, or something it calls, writes to the database. The provider
 * layer is excluded: its writes are the quote cache, not admin-visible state.
 */
predicate mutates(Function f) {
  not f.getFile().getRelativePath().matches("%packages/server/src/providers/%") and
  exists(Business::DrizzleWrite w | f = Business::enclosingContainer(w.asExpr()))
  or
  not f.getFile().getRelativePath().matches("%packages/server/src/providers/%") and
  exists(DataFlow::CallNode c | f = Business::enclosingContainer(c.asExpr()) |
    mutates(c.getACallee())
  )
}

/** Holds if `n` lies inside the function `f` (at any nesting depth). */
bindingset[f]
predicate within(AstNode n, Function f) { f = Business::enclosingContainer(n) }

/**
 * Holds if the transaction callback `cb` does nothing but audit: no Drizzle
 * write in it, and no call other than the audit that receives the handle.
 */
predicate auditOnly(Function cb, Business::TxParam p) {
  p.getCallbackFunction() = cb and
  not exists(Business::DrizzleWrite w | within(w.asExpr(), cb)) and
  not exists(DataFlow::InvokeNode call |
    within(call.asExpr(), cb) and
    not call instanceof Business::AuditCall and
    p.flowsTo(call.getAnArgument())
  )
}

/** A mutation in `handler` that is not inside `cb`. */
DataFlow::Node mutationOutside(Function handler, Function cb) {
  within(result.asExpr(), handler) and
  not within(result.asExpr(), cb) and
  (
    result instanceof Business::DrizzleWrite
    or
    exists(DataFlow::CallNode c | c = result | mutates(c.getACallee())) and
    not exists(DataFlow::MethodCallNode t | t = result and t.getMethodName() = "transaction")
  )
}

from Business::AuditCall audit, string msg, DataFlow::Node related, string relatedLabel
where
  MarketTrader::isServerSrc(audit.getFile()) and
  (
    Business::mayRunOutsideTx(audit.getArgument(0)) and
    msg =
      "recordAdminAction is given $@, which is not (on every call path) a transaction handle, so the audit row commits separately from the change it records. Perform the mutation and this call inside one db.transaction and pass its tx." and
    related = audit.getArgument(0) and
    relatedLabel = audit.getArgument(0).toString()
    or
    exists(Business::TxParam p, Function cb, Function handler |
      p.flowsTo(audit.getArgument(0)) and
      cb = p.getCallbackFunction() and
      auditOnly(cb, p) and
      handler = Business::enclosingRoute(audit.asExpr()).getHandler().getFunction() and
      related = min(DataFlow::Node m | m = mutationOutside(handler, cb) | m order by m.getStartLine(), m.getStartColumn()) and
      relatedLabel = "the mutation" and
      msg =
        "This transaction only writes the audit row; $@ commits in a different transaction, so a failure between them leaves an unaudited change (or an audit of a change that never happened). Move this call into the mutation's transaction."
    )
  )
select audit, msg, related, relatedLabel
