/**
 * @name Span not ended on every path
 * @description A startActiveSpan callback must wrap its work in try/catch/finally that records the exception and sets ERROR status in catch and calls span.end() in finally, and a startSpan result must be ended in the same function, or spans leak and failures are invisible.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/span-not-ended
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader

/** A call `span.<name>(...)` on the variable `span`, made directly within `container`. */
predicate spanCall(Variable span, string name, StmtContainer container, AstNode within) {
  exists(DataFlow::MethodCallNode c |
    c.getMethodName() = name and
    c.getReceiver().asExpr().(VarAccess).getVariable() = span and
    c.getContainer() = container and
    c.asExpr().getParent+() = within
  )
}

/** Holds if `cb`'s body has the try/catch/finally shape around span `span`. */
predicate wellFormed(Function cb, Variable span) {
  exists(TryStmt t | t.getContainer() = cb |
    spanCall(span, "end", cb, t.getFinally()) and
    spanCall(span, "recordException", cb, t.getACatchClause()) and
    spanCall(span, "setStatus", cb, t.getACatchClause())
  )
}

from DataFlow::MethodCallNode call, string msg
where
  MarketTrader::isAppSrc(call.getFile()) and
  (
    call.getMethodName() = "startActiveSpan" and
    exists(DataFlow::FunctionNode cb, Function f |
      cb = call.getLastArgument().getALocalSource() and
      f = cb.getFunction()
    |
      not exists(f.getParameter(0).(SimpleParameter).getVariable()) and
      msg = "startActiveSpan callback takes no span parameter, so it cannot end the span; accept `span` and end it in a finally block."
      or
      exists(Variable span | span = f.getParameter(0).(SimpleParameter).getVariable() |
        not wellFormed(f, span) and
        msg =
          "startActiveSpan callback must use try { ... } catch { " + span.getName() +
            ".recordException(...); " + span.getName() + ".setStatus(ERROR); throw } finally { " +
            span.getName() + ".end() }."
      )
    )
    or
    call.getMethodName() = "startSpan" and
    not exists(DataFlow::MethodCallNode end |
      end = call.getAMethodCall("end") and
      end.getContainer() = call.getContainer()
    ) and
    msg = "Span from startSpan(...) is never ended in this function; call .end() in a finally block."
  )
select call, msg
