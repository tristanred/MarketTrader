/**
 * @name WebSocket message listener not wrapped in try/catch
 * @description A socket 'message' listener's body must be a single try/catch (after optional call-free declarations), because an exception thrown there escapes Fastify's error handler and can crash the process.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/ws-message-handler-unguarded
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader
import WsAuthLib

/** A declaration statement whose initializers make no call and await nothing. */
predicate isInertDeclaration(Stmt s) {
  s instanceof DeclStmt and
  not exists(InvokeExpr c | c.getParent+() = s) and
  not exists(AwaitExpr a | a.getParent+() = s)
}

/** Holds if `body` is optional inert declarations followed by exactly one try/catch. */
predicate isGuardedBody(BlockStmt body) {
  exists(int n, TryStmt t |
    n = body.getNumStmt() and
    t = body.getStmt(n - 1) and
    exists(t.getACatchClause()) and
    forall(int i | i in [0 .. n - 2] | isInertDeclaration(body.getStmt(i)))
  )
}

from WsAuth::ListenerAttach l, Function cb
where
  MarketTrader::isServerSrc(l.getFile()) and
  l.getEvent() = "message" and
  cb = l.getCallback().getFunction() and
  not isGuardedBody(cb.getBody())
select l,
  "The 'message' listener body is not wrapped in try/catch; wrap it so a malformed frame cannot throw out of the socket callback."
