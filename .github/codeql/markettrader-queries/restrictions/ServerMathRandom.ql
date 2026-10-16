/**
 * @name Math.random in server code
 * @description Server code draws randomness from node:crypto (randomBytes, randomInt,
 *              randomUUID); Math.random is predictable and must never produce passwords,
 *              join codes or tokens.
 * @kind problem
 * @problem.severity warning
 * @precision high
 * @id markettrader/server-math-random
 * @tags security
 *       external/cwe/cwe-338
 */

import javascript
import lib.MarketTrader

// The frontend is deliberately out of scope: it uses Math.random for reconnect jitter.
from DataFlow::PropRead read
where
  read = DataFlow::globalVarRef("Math").getAPropertyRead("random") and
  (MarketTrader::isServerSrc(read.getFile()) or MarketTrader::isSharedSrc(read.getFile()))
select read, "Math.random in server code; use node:crypto (randomInt, randomBytes, randomUUID)."
