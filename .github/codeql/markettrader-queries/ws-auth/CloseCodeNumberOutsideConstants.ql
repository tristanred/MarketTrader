/**
 * @name WebSocket close code number outside its constants file
 * @description The numbers 1008 and 4400 may only appear in ws/close-codes.ts (server) and lib/wsAuth.ts (frontend); anywhere else they are a hand-copied close code that can drift from the constant the other side branches on.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/close-code-number-outside-constants
 * @tags maintainability
 *       correctness
 * @precision high
 */

import javascript
import lib.MarketTrader

from NumberLiteral n
where
  n.getValue() = ["1008", "4400"] and
  MarketTrader::isAppSrc(n.getFile()) and
  not MarketTrader::serverFile(n.getFile(), "ws/close-codes.ts") and
  not MarketTrader::frontendFile(n.getFile(), "lib/wsAuth.ts")
select n,
  "WebSocket close code " + n.getValue() +
    " is spelled out here; import WS_POLICY_CLOSE_CODE / WS_INVALID_FRAME_CLOSE_CODE from ws/close-codes.ts or lib/wsAuth.ts instead."
