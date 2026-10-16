/**
 * @name WebSocket send outside a try block
 * @description Every server-side `socket.send(...)` must sit inside a try block, because a socket can close between the readyState check and the send and the throw would escape the broadcast loop.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/ws-send-outside-try
 * @tags correctness
 * @precision medium
 */

import javascript
import lib.MarketTrader

/**
 * A `.send(...)` on a plain variable or property that is not Fastify's
 * `reply`. Fastify chains (`reply.code(401).send(...)`) have a call as
 * receiver and are excluded as well.
 */
class SocketSend extends DataFlow::MethodCallNode {
  SocketSend() {
    this.getMethodName() = "send" and
    MarketTrader::isServerSrc(this.getFile()) and
    exists(Expr recv, string name |
      recv = this.getReceiver().asExpr().getUnderlyingReference() and
      not name = ["reply", "res", "response"]
    |
      name = recv.(VarAccess).getName()
      or
      name = recv.(PropAccess).getPropertyName()
    )
  }
}

/** Holds if `e` is inside the protected block of a try statement in its own function. */
predicate inTryBlock(Expr e) {
  exists(TryStmt t |
    t.getBody() = e.getParent+() and
    t.getContainer() = e.getContainer()
  )
}

from SocketSend send
where not inTryBlock(send.asExpr())
select send,
  "This socket send is not inside a try block; wrap it in try/catch so a socket closing mid-broadcast cannot throw out of the loop."
