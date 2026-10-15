/**
 * @name JWT signed outside plugins/jwt.ts
 * @description Tokens must be minted through signAccessToken / signRefreshToken in
 *              plugins/jwt.ts so the `type` claim that separates access from refresh
 *              tokens can never be forgotten.
 * @kind problem
 * @problem.severity error
 * @security-severity 7.0
 * @precision high
 * @id markettrader/jwt-sign-outside-plugin
 * @tags security
 *       external/cwe/cwe-287
 */

import javascript
import lib.MarketTrader
import restrictions.RestrictionsLib

/** Holds if `recv` is (a local alias of) a `.jwt` property read, e.g. `app.jwt`. */
predicate isJwtNamespace(DataFlow::Node recv) {
  recv.getALocalSource().(DataFlow::PropRead).getPropertyName() = "jwt"
  or
  recv.asExpr().getUnderlyingReference().(PropAccess).getPropertyName() = "jwt"
}

/** Holds if `call` invokes `<jwt>.sign`, directly (`app.jwt.sign()`) or via `const { sign } = app.jwt`. */
predicate isJwtNamespaceSign(DataFlow::CallNode call) {
  exists(DataFlow::PropRead sign | sign = call.getCalleeNode().getALocalSource() |
    sign.getPropertyName() = "sign" and isJwtNamespace(sign.getBase())
  )
  or
  call.(DataFlow::MethodCallNode).getMethodName() = "sign" and
  isJwtNamespace(call.(DataFlow::MethodCallNode).getReceiver())
}

from AstNode site, string msg
where
  MarketTrader::isAppSrc(site.getFile()) and
  not MarketTrader::serverFile(site.getFile(), "plugins/jwt.ts") and
  (
    exists(DataFlow::CallNode call | call.asExpr() = site |
      isJwtNamespaceSign(call)
      or
      // @fastify/jwt also decorates `reply.jwtSign`, which signs with the same secret.
      call.(DataFlow::MethodCallNode).getMethodName() = "jwtSign"
    ) and
    msg =
      "JWT signed directly; mint tokens with signAccessToken/signRefreshToken from plugins/jwt.ts so the 'type' claim is always set."
    or
    // A standalone JWT library signs outside @fastify/jwt entirely.
    exists(Restrictions::ModuleRef ref | ref = site |
      Restrictions::isPackage(ref.getPath(), ["jsonwebtoken", "fast-jwt", "jose"]) and
      not ref.isTypeOnly() and
      msg =
        "'" + ref.getPath() +
          "' imported outside plugins/jwt.ts; mint tokens with signAccessToken/signRefreshToken so the 'type' claim is always set."
    )
  )
select site, msg
