/**
 * @name setInterval neither unref'd nor cleared on shutdown
 * @description A server setInterval outside buildApp must be unref()'d or cleared in an onClose hook or stop function in the same file, or it keeps the process alive and outlives app.close().
 * @kind problem
 * @problem.severity warning
 * @id markettrader/uncleared-set-interval
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader
import bootstrap.BootstrapLib

/** A `setInterval(...)` call in server source other than `app.ts` (covered by unpaired-background-start). */
class ServerSetInterval extends DataFlow::CallNode {
  ServerSetInterval() {
    this = DataFlow::globalVarRef("setInterval").getACall() and
    MarketTrader::isServerSrc(this.getFile()) and
    not MarketTrader::serverFile(this.getFile(), "app.ts")
  }
}

/** A handle a `setInterval` result is stored in: a local variable or a `this.<field>` of a class. */
newtype THandle =
  TLocal(Variable v) or
  TField(ClassDefinition c, string name) {
    exists(PropAccess pa | thisField(pa, c, name))
    or
    c.getAField().getName() = name
  }

/** Holds if `pa` is `this.<name>` inside a method of class `c`. */
predicate thisField(PropAccess pa, ClassDefinition c, string name) {
  pa.getBase() instanceof ThisExpr and
  pa.getPropertyName() = name and
  pa.getContainer().getEnclosingContainer*() = c.getAMethod().getBody()
}

/** Holds if `e` refers to handle `h`. */
predicate refersTo(Expr e, THandle h) {
  exists(Variable v | h = TLocal(v) and e.(VarAccess).getVariable() = v)
  or
  exists(ClassDefinition c, string name | h = TField(c, name) and thisField(e, c, name))
}

/** The handle `si` is stored in. */
THandle storedIn(ServerSetInterval si) {
  exists(VariableDeclarator d |
    d.getInit().getUnderlyingValue() = si.asExpr() and
    result = TLocal(d.getBindingPattern().(VarDecl).getVariable())
  )
  or
  exists(AssignExpr a |
    a.getRhs().getUnderlyingValue() = si.asExpr() and
    refersTo(a.getLhs(), result)
  )
  or
  // `private timer = setInterval(...)`: a class field initialiser.
  exists(FieldDeclaration fd, ClassDefinition c |
    fd.getInit().getUnderlyingValue() = si.asExpr() and
    fd = c.getAField() and
    not fd.isStatic() and
    result = TField(c, fd.getName())
  )
}

/** Holds if `si` is the direct receiver of `.unref()`: `setInterval(...).unref()`. */
predicate unrefChained(ServerSetInterval si) {
  exists(DataFlow::MethodCallNode unref |
    unref.getMethodName() = "unref" and
    unref.getReceiver().asExpr().getUnderlyingValue() = si.asExpr()
  )
}

/** A function in which a clearInterval counts as releasing the timer on shutdown. */
predicate isShutdownFunction(Function f) {
  f instanceof Bootstrap::OnCloseHook
  or
  exists(MethodDeclaration m | m.getName() = Bootstrap::releaseMethod() and m.getBody() = f)
  or
  exists(Property p | p.getName() = Bootstrap::releaseMethod() and p.getInit() = f)
  or
  // `function stop() {...}` or `const stopTicking = () => ...`.
  f.getName().regexpMatch("(" + concat(Bootstrap::releaseMethod(), "|") + ")([A-Z]\\w*)?")
  or
  exists(VariableDeclarator d |
    d.getInit().getUnderlyingValue() = f and
    d.getBindingPattern()
        .(VarDecl)
        .getName()
        .regexpMatch("(" + concat(Bootstrap::releaseMethod(), "|") + ")([A-Z]\\w*)?")
  )
}

predicate isReleased(THandle h) {
  exists(DataFlow::CallNode clear, Function f |
    clear = DataFlow::globalVarRef("clearInterval").getACall() and
    refersTo(clear.getArgument(0).asExpr(), h) and
    isShutdownFunction(f) and
    Bootstrap::containerWithin(clear.getContainer(), f)
  )
  or
  exists(DataFlow::MethodCallNode unref |
    unref.getMethodName() = "unref" and
    refersTo(unref.getReceiver().asExpr(), h)
  )
}

from ServerSetInterval si, string msg
where
  not exists(storedIn(si)) and
  not unrefChained(si) and
  msg = "setInterval(...) result is discarded, so it can never be cleared; store it and unref() it or clear it in an onClose hook/stop()."
  or
  exists(THandle h | h = storedIn(si) |
    not isReleased(h) and
    msg = "setInterval(...) is neither unref()'d nor cleared in an onClose hook/stop() in this file."
  )
select si, msg
