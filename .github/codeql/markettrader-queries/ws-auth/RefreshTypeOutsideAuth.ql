/**
 * @name Refresh token type compared outside the refresh path
 * @description Only `POST /auth/refresh` (routes/auth.ts) and the token helpers (plugins/jwt.ts) may compare a token's `type` against REFRESH_TOKEN_TYPE; anywhere else the comparison means a 7-day refresh token is being handled as a credential.
 * @kind problem
 * @problem.severity error
 * @id markettrader/refresh-type-outside-auth
 * @tags security
 *       external/cwe/cwe-287
 * @precision high
 */

import javascript
import lib.MarketTrader

from EqualityTest eq, PropAccess typeRead, Expr refresh
where
  MarketTrader::isServerSrc(eq.getFile()) and
  typeRead = eq.getAnOperand().getUnderlyingValue() and
  typeRead.getPropertyName() = "type" and
  refresh = eq.getAnOperand().getUnderlyingValue() and
  (
    refresh.(VarAccess).getName() = "REFRESH_TOKEN_TYPE"
    or
    refresh.(StringLiteral).getValue() = "refresh"
  ) and
  not MarketTrader::serverFile(eq.getFile(), "routes/auth.ts") and
  not MarketTrader::serverFile(eq.getFile(), "plugins/jwt.ts")
select eq,
  "A token `type` is compared with the refresh type outside routes/auth.ts and plugins/jwt.ts; only POST /auth/refresh may accept a refresh token — require `type === ACCESS_TOKEN_TYPE` instead."
