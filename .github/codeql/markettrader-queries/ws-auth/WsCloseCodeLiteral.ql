/**
 * @name WebSocket closed with a numeric literal code
 * @description A WebSocket close code must be a named constant (WS_POLICY_CLOSE_CODE, WS_INVALID_FRAME_CLOSE_CODE, ...), because the client branches on it and the server/frontend copies must stay in step.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/ws-close-code-literal
 * @tags maintainability
 *       correctness
 * @precision high
 */

import javascript
import lib.MarketTrader

from DataFlow::MethodCallNode close, NumberLiteral code
where
  close.getMethodName() = "close" and
  code = close.getArgument(0).asExpr().getUnderlyingValue() and
  MarketTrader::isAppSrc(close.getFile())
select close,
  "Close code " + code.getValue() +
    " is a numeric literal; use the named constant from ws/close-codes.ts (server) or lib/wsAuth.ts (frontend)."
