/**
 * @name WebSocket listener attached after an await
 * @description A WebSocket route handler must attach its `close`, `error` and `message` listeners before its first `await`; `close` fires exactly once, so a listener added after a suspension point misses a peer that left during it, leaking the registry entry and dropping the client's first `subscribe`.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/ws-listener-after-await
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader
import WsAuthLib

/** A point at which the handler can suspend: `await`, `yield`, or `for await`. */
class SuspensionPoint extends ControlFlowNode {
  SuspensionPoint() {
    this instanceof AwaitExpr
    or
    this instanceof YieldExpr
    or
    isForAwait(this)
  }
}

/**
 * Holds if `f` is a `for await` loop. `ForOfStmt.isAwait()` is not populated
 * for TypeScript sources, so the `await` token after `for` is checked as well.
 */
predicate isForAwait(ForOfStmt f) {
  f.isAwait()
  or
  f.getFirstToken().getNextToken().getValue() = "await"
}

/** A suspension point directly in the body of a WebSocket route handler. */
SuspensionPoint handlerSuspension(WsAuth::WsRoute r) {
  result.getContainer() = r.getHandler().getFunction()
}

/**
 * The control-flow node at which `s` suspends. A `for await` statement is not
 * itself on the CFG, so its iterated expression stands in for it.
 */
ControlFlowNode suspendsAt(SuspensionPoint s) {
  result = s and not s instanceof ForOfStmt
  or
  result = s.(ForOfStmt).getIterationDomain()
}

/** Control-flow nodes reachable from a suspension point of a WebSocket handler. */
ControlFlowNode reachableAfter(SuspensionPoint s) {
  s = handlerSuspension(_) and result = suspendsAt(s).getASuccessor()
  or
  result = reachableAfter(s).getASuccessor()
}

from WsAuth::WsRoute r, WsAuth::ListenerAttach attach, SuspensionPoint first
where
  MarketTrader::isServerSrc(r.getFile()) and
  attach.getEvent() = ["close", "error", "message"] and
  attach.getContainer() = r.getHandler().getFunction() and
  attach.getReceiver().getALocalSource() = r.getSocketParam() and
  first =
    min(SuspensionPoint s, Location l |
      s = handlerSuspension(r) and
      attach.asExpr() = reachableAfter(s) and
      l = s.getLocation()
    |
      s order by l.getStartLine(), l.getStartColumn()
    )
select attach,
  "The '" + attach.getEvent() +
    "' listener is attached after $@; attach every close/error/message listener before the handler's first await so a peer that disconnects meanwhile is still observed.",
  first, "this await"
