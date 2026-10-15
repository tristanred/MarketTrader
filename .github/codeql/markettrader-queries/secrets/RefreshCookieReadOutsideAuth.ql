/**
 * @name Refresh-token cookie read outside routes/auth.ts
 * @description Only POST /auth/refresh (routes/auth.ts) may read request.cookies.refreshToken; any other reader is a second place that accepts the 7-day credential and must re-implement its type check.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/refresh-cookie-read-outside-auth
 * @tags security
 *       external/cwe/cwe-287
 * @precision high
 */

import javascript
import lib.MarketTrader

from DataFlow::PropRead read, MarketTrader::RequestInput cookies
where
  cookies.getKind() = "cookies" and
  (read.getBase() = cookies or read.getBase().getALocalSource() = cookies) and
  (
    read.getPropertyName() = "refreshToken"
    or
    // `request.cookies[NAME]` with `const NAME = 'refreshToken'`
    read.getPropertyNameExpr().flow().mayHaveStringValue("refreshToken")
  ) and
  MarketTrader::isServerSrc(read.getFile()) and
  not MarketTrader::serverFile(read.getFile(), "routes/auth.ts")
select read,
  "The refreshToken cookie may only be read by POST /auth/refresh in routes/auth.ts; route refresh-token handling through there."
