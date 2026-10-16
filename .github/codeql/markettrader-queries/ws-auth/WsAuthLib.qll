/**
 * Helpers shared by the `ws-auth` queries: WebSocket routes, their listener
 * attachments, and the auth hooks on REST routes.
 */

import javascript
import lib.MarketTrader

module WsAuth {
  /**
   * The options object literal of `r`, also when it is passed through a local
   * binding (`const opts = {...}; app.get(path, opts, handler)`).
   * `RouteRegistration.getOptions()` only matches an inline literal.
   */
  DataFlow::ObjectLiteralNode optionsOf(MarketTrader::RouteRegistration r) {
    result = r.getOptions()
    or
    r.getNumArgument() >= 3 and result = r.getArgument(1).getALocalSource()
  }

  /** Holds if the route's options literal carries `websocket: true`. */
  predicate isWebSocketRoute(MarketTrader::RouteRegistration r) {
    optionsOf(r).getAPropertyWrite("websocket").getRhs().asExpr().(BooleanLiteral).getValue() =
      "true"
  }

  /** Holds if `n` is a reference to the Fastify request: a parameter or variable named `request`/`req`. */
  predicate isRequestRef(DataFlow::Node n) {
    n.asExpr().getUnderlyingReference().(VarAccess).getName() = ["request", "req"]
    or
    n.getALocalSource().(DataFlow::ParameterNode).getName() = ["request", "req"]
    or
    n.getALocalSource().asExpr().getUnderlyingReference().(VarAccess).getName() = ["request", "req"]
  }

  /**
   * A read of `request.<prop>`, including the destructuring form
   * `const { <prop> } = request`, which `MarketTrader::RequestInput` does not see.
   */
  class RequestPropRead extends DataFlow::Node instanceof DataFlow::PropRead {
    RequestPropRead() { isRequestRef(super.getBase()) }

    string getPropertyName() { result = super.getPropertyName() }
  }

  /** A route registered with `{ websocket: true }`. */
  class WsRoute extends MarketTrader::RouteRegistration {
    WsRoute() { isWebSocketRoute(this) }

    /** The handler's first parameter: the upgraded socket. */
    DataFlow::ParameterNode getSocketParam() { result = this.getHandler().getParameter(0) }
  }

  /**
   * A guard expression used as a lifecycle hook value: either the value itself
   * or, for an array literal, one of its elements.
   */
  private DataFlow::Node hookValue(MarketTrader::RouteRegistration r, string hook) {
    hook = ["onRequest", "preHandler"] and
    exists(DataFlow::Node rhs | rhs = optionsOf(r).getAPropertyWrite(hook).getRhs() |
      result = rhs
      or
      result = rhs.getALocalSource().(DataFlow::ArrayCreationNode).getAnElement()
    )
  }

  /**
   * Holds if `r` attaches the decorator named `guard` (`authenticate` or
   * `requireAdmin`) as an `onRequest` or `preHandler` hook.
   */
  predicate hasGuard(MarketTrader::RouteRegistration r, string guard) {
    guard = ["authenticate", "requireAdmin"] and
    exists(Expr ref | ref = hookValue(r, _).asExpr().getUnderlyingReference() |
      ref.(PropAccess).getPropertyName() = guard
      or
      // `const { authenticate } = rawApp; ... onRequest: authenticate`
      ref.(VarAccess).getName() = guard
    )
  }

  /** Holds if `r` has either auth guard. */
  predicate hasAuthGuard(MarketTrader::RouteRegistration r) { hasGuard(r, _) }

  /** Holds if `inner` is `outer` or is nested (at any depth) inside it. */
  predicate nestedIn(StmtContainer inner, StmtContainer outer) {
    inner = outer or nestedIn(inner.getEnclosingContainer(), outer)
  }

  /**
   * A listener attachment `<recv>.on(event, cb)` / `.once` / `.addListener`
   * whose event name is a string literal.
   */
  class ListenerAttach extends DataFlow::MethodCallNode {
    ListenerAttach() {
      this.getMethodName() = ["on", "once", "addListener", "addEventListener"] and
      exists(this.getArgument(0).getStringValue())
    }

    string getEvent() { result = this.getArgument(0).getStringValue() }

    /** The callback function, when given inline or through a local binding. */
    DataFlow::FunctionNode getCallback() { result = this.getArgument(1).getALocalSource() }
  }
}
