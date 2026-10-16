/**
 * @name Invalid-frame close code used outside a message listener
 * @description WS_INVALID_FRAME_CLOSE_CODE (4400) answers a rejected inbound frame and may only be passed as a close code from inside a socket 'message' listener; credential decisions must use WS_POLICY_CLOSE_CODE so the client refreshes its token.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/invalid-frame-code-outside-message-listener
 * @tags correctness
 * @precision high
 */

import javascript
import lib.MarketTrader
import WsAuthLib

from DataFlow::CallNode call, VarAccess code
where
  MarketTrader::isServerSrc(call.getFile()) and
  code = call.getAnArgument().asExpr().getUnderlyingValue() and
  code.getName() = "WS_INVALID_FRAME_CLOSE_CODE" and
  not exists(WsAuth::ListenerAttach l |
    l.getEvent() = "message" and
    WsAuth::nestedIn(call.getContainer(), l.getCallback().getFunction())
  )
select call,
  "WS_INVALID_FRAME_CLOSE_CODE is passed here outside a socket 'message' listener; it is reserved for rejecting an inbound frame — use WS_POLICY_CLOSE_CODE for credential decisions."
