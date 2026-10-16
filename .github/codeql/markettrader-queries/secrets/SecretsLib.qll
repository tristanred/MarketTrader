/**
 * Sources, sinks and helpers shared by the `secrets/` credential and PII queries.
 */

import javascript
import lib.MarketTrader

module SecretsLib {
  /**
   * Holds if `inner` is a property value or element of the object/array literal
   * that `outer` evaluates to. JS taint tracking does not taint an object literal
   * because one of its property values is tainted, so a sink argument such as
   * `log.warn({ username }, ...)` is widened to the literal's parts instead.
   */
  private predicate literalPart(DataFlow::Node outer, DataFlow::Node inner) {
    inner = outer.getALocalSource().(DataFlow::ObjectLiteralNode).getAPropertyWrite().getRhs()
    or
    inner = outer.getALocalSource().(DataFlow::ArrayCreationNode).getAnElement()
  }

  /** Holds if `n` is `root` or nested (at any depth) in a literal passed as `root`. */
  bindingset[root]
  predicate withinLiteral(DataFlow::Node root, DataFlow::Node n) { literalPart*(root, n) }

  /** A log, analytics or span argument: a value that leaves the process as telemetry. */
  class TelemetrySinkRoot extends DataFlow::Node {
    TelemetrySinkRoot() {
      this instanceof MarketTrader::LogSink or
      this instanceof MarketTrader::AnalyticsSink or
      this instanceof MarketTrader::SpanSink
    }
  }

  /** A {@link TelemetrySinkRoot} or a value nested in a literal passed to one. */
  class TelemetrySink extends DataFlow::Node {
    TelemetrySink() { exists(TelemetrySinkRoot r | withinLiteral(r, this)) }
  }

  /** The payload of `reply.send(...)` / a route handler's return, or a value nested in it. */
  class ResponseSink extends DataFlow::Node {
    ResponseSink() { exists(MarketTrader::HttpResponseSink r | withinLiteral(r, this)) }
  }

  /**
   * Holds if `pred -> succ` is a captured local variable's assigned value flowing
   * to a read of it inside a nested function. The shared capture model only
   * delivers it when the closure is invoked through a resolved call, which a
   * React `useEffect(() => ...)` body is not.
   */
  predicate capturedVariableStep(DataFlow::Node pred, DataFlow::Node succ) {
    exists(LocalVariable v |
      v.isCaptured() and
      pred.asExpr() = v.getAnAssignedExpr() and
      succ.asExpr() = v.getAnAccess() and
      succ.getContainer() != pred.getContainer()
    )
  }

  /** An argument of `new Error(...)`, `new TradeError(...)` or any other `new *Error(...)`. */
  class ErrorMessageSink extends DataFlow::Node {
    ErrorMessageSink() {
      exists(DataFlow::NewNode n |
        n.getCalleeName().matches("%Error") and
        withinLiteral(n.getAnArgument(), this)
      )
    }
  }

  /** The reason argument of `socket.close(code, reason)` or `closeSocket(socket, code, reason)`. */
  class SocketCloseReasonSink extends DataFlow::Node {
    SocketCloseReasonSink() {
      this = any(DataFlow::MethodCallNode c | c.getMethodName() = "close").getArgument(1)
      or
      this = any(DataFlow::CallNode c | c.getCalleeName() = "closeSocket").getArgument(2)
    }
  }

  /**
   * A URL under construction: any argument of `new URL(...)`, or the first
   * argument of `new WebSocket(...)` / `fetch(...)`. Query strings end up in
   * proxy access logs and browser history.
   */
  class UrlSink extends DataFlow::Node {
    UrlSink() {
      this = DataFlow::globalVarRef("URL").getAnInstantiation().getAnArgument()
      or
      this = DataFlow::globalVarRef("WebSocket").getAnInstantiation().getArgument(0)
      or
      this = DataFlow::globalVarRef("fetch").getACall().getArgument(0)
    }
  }

  /** An argument of `localStorage.setItem(...)` / `sessionStorage.setItem(...)`. */
  class WebStorageSink extends DataFlow::Node {
    WebStorageSink() {
      exists(DataFlow::MethodCallNode c |
        c.getMethodName() = "setItem" and
        (
          c.getReceiver() = DataFlow::globalVarRef(["localStorage", "sessionStorage"])
          or
          c.getReceiver().(DataFlow::PropRead).getPropertyName() = ["localStorage", "sessionStorage"]
        ) and
        this = c.getAnArgument()
      )
    }
  }

  /** A function installed as the `ws` `handleProtocols` hook (`{ handleProtocols: fn }`). */
  class HandleProtocolsFunction extends DataFlow::FunctionNode {
    HandleProtocolsFunction() {
      // getAFunctionValue, not getALocalSource: the hook is usually imported.
      exists(DataFlow::ObjectLiteralNode o |
        this = o.getAPropertyWrite("handleProtocols").getRhs().getAFunctionValue()
      )
    }
  }

  /**
   * A read of a body field: `request.body.f`, `request.body['f']`, or the
   * destructuring `const { f } = request.body`. `getField()` is `f`.
   */
  class BodyFieldRead extends DataFlow::Node instanceof DataFlow::PropRead {
    BodyFieldRead() {
      exists(MarketTrader::RequestInput body | body.getKind() = "body" |
        super.getBase() = body or super.getBase().getALocalSource() = body
      )
    }

    string getField() { result = super.getPropertyName() }
  }

  /** A call to `hash` or `verify` from `@node-rs/argon2`. */
  class Argon2Call extends DataFlow::CallNode {
    Argon2Call() {
      this = API::moduleImport("@node-rs/argon2").getMember(["hash", "verify"]).getACall()
    }
  }

  /**
   * Holds if `pred -> succ` carries a value returned from a `db.transaction(cb)`
   * callback out to the call's result. Drizzle is not modelled, so without this
   * the seeded admin credentials stop at the callback's `return`. The step starts
   * at the returned literal's property values because a literal is not tainted
   * by its parts.
   */
  predicate transactionReturnStep(DataFlow::Node pred, DataFlow::Node succ) {
    exists(DataFlow::MethodCallNode tx, DataFlow::FunctionNode cb |
      tx.getMethodName() = "transaction" and
      cb = tx.getArgument(0).getALocalSource() and
      withinLiteral(cb.getAReturn(), pred) and
      succ = tx
    )
  }
}
