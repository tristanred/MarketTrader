/**
 * @name Background task started in buildApp without an onClose stop
 * @description Every worker, poller, heartbeat, broadcaster/engine start or setInterval in buildApp must be stopped from an onClose hook, or app.close() leaves it running against a closed database.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/unpaired-background-start
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader
import bootstrap.BootstrapLib

/** A start function whose returned handle is what gets stopped. */
bindingset[name]
predicate isHandleStarter(string name) {
  name.regexpMatch("start\\w*Worker|startPricePoller|startWsHeartbeat")
}

/**
 * Holds if `c` is `obj.start()` / `obj.startX()` on a local variable `obj`, which is
 * stopped through `obj` itself (not a handle-returning starter called as a method).
 */
predicate isStartMethod(DataFlow::CallNode c) {
  exists(string name | name = c.(DataFlow::MethodCallNode).getMethodName() |
    name.regexpMatch("start([A-Z]\\w*)?") and
    not isHandleStarter(name)
  ) and
  c.(DataFlow::MethodCallNode).getReceiver().asExpr() instanceof VarAccess
}

/** A call in `buildApp` that starts something running in the background. */
class BackgroundStart extends DataFlow::CallNode {
  BackgroundStart() {
    this.getContainer() instanceof Bootstrap::BuildApp and
    (
      isHandleStarter(this.getCalleeName())
      or
      this = DataFlow::globalVarRef("setInterval").getACall()
      or
      isStartMethod(this)
    )
  }

  /** The variable holding the handle that stops this start. */
  Variable getHandleVar() {
    // `obj.start()` is stopped through `obj`.
    isStartMethod(this) and
    result = this.(DataFlow::MethodCallNode).getReceiver().asExpr().(VarAccess).getVariable()
    or
    not isStartMethod(this) and
    exists(VariableDeclarator d |
      Bootstrap::stripAwait(d.getInit()) = this.asExpr() and
      result = d.getBindingPattern().(VarDecl).getVariable()
    )
    or
    not isStartMethod(this) and
    exists(AssignExpr a |
      Bootstrap::stripAwait(a.getRhs()) = this.asExpr() and
      result = a.getLhs().(VarRef).getVariable()
    )
  }

  string describe() {
    isStartMethod(this) and
    result =
      this.(DataFlow::MethodCallNode).getReceiver().asExpr().(VarAccess).getName() + "." +
        this.(DataFlow::MethodCallNode).getMethodName() + "()"
    or
    not isStartMethod(this) and
    result = this.getCalleeName() + "(...)"
  }
}

/** Holds if an onClose hook in the same function releases `v`. */
predicate stoppedOnClose(Variable v, Bootstrap::BuildApp f) {
  exists(Bootstrap::OnCloseHook hook, DataFlow::CallNode stop |
    hook.getEnclosingContainer+() = f and
    Bootstrap::containerWithin(stop.getContainer(), hook)
  |
    stop.(DataFlow::MethodCallNode).getMethodName() = Bootstrap::releaseMethod() and
    stop.(DataFlow::MethodCallNode).getReceiver().asExpr().(VarAccess).getVariable() = v
    or
    stop = DataFlow::globalVarRef(["clearInterval", "clearTimeout"]).getACall() and
    stop.getArgument(0).asExpr().(VarAccess).getVariable() = v
    or
    // A returned stop function invoked directly: `stopX()`.
    stop.getCalleeNode().asExpr().(VarAccess).getVariable() = v
  )
}

from BackgroundStart s, string msg
where
  not exists(s.getHandleVar()) and
  msg =
    s.describe() +
      " discards its handle, so it can never be stopped; store it and stop it in app.addHook('onClose', ...)."
  or
  exists(Variable v | v = s.getHandleVar() |
    not stoppedOnClose(v, s.getContainer()) and
    msg =
      s.describe() + " is never stopped: add app.addHook('onClose', ...) that stops/clears '" +
        v.getName() + "'."
  )
select s, msg
