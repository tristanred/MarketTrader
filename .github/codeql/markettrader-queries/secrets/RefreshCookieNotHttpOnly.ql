/**
 * @name Refresh-token cookie set without httpOnly: true
 * @description The refreshToken cookie must be set with an options literal containing httpOnly: true, so script (and any XSS) can never read the 7-day credential.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/refresh-cookie-not-httponly
 * @tags security
 *       external/cwe/cwe-1004
 * @precision high
 */

import javascript
import lib.MarketTrader

from DataFlow::MethodCallNode setCookie
where
  MarketTrader::isServerSrc(setCookie.getFile()) and
  setCookie.getMethodName() = "setCookie" and
  // Resolves a constant cookie name (`const NAME = 'refreshToken'`) as well as a literal.
  setCookie.getArgument(0).mayHaveStringValue("refreshToken") and
  not exists(DataFlow::ObjectLiteralNode opts |
    opts = setCookie.getArgument(2).getALocalSource() and
    opts.getAPropertyWrite("httpOnly").getRhs().asExpr().(BooleanLiteral).getValue() = "true"
  )
select setCookie,
  "The refreshToken cookie must be set with an options literal containing 'httpOnly: true'."
