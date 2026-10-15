/**
 * @name JWT verified without checking its type claim
 * @description Access and refresh tokens share one signing key and differ only by their `type` claim, so every `jwt.verify` / `request.jwtVerify()` result must be compared against ACCESS_TOKEN_TYPE or REFRESH_TOKEN_TYPE in the same function before its claims are trusted.
 * @kind problem
 * @problem.severity error
 * @id markettrader/jwt-verify-without-type-check
 * @tags security
 *       external/cwe/cwe-287
 * @precision high
 */

import javascript
import lib.MarketTrader

/** `<x>.jwt.verify(token)`. */
class JwtVerifyCall extends DataFlow::MethodCallNode {
  JwtVerifyCall() {
    this.getMethodName() = "verify" and
    this.getReceiver().asExpr().getUnderlyingReference().(PropAccess).getPropertyName() = "jwt"
  }
}

/** `request.jwtVerify()`, which stores the claims on `request.user`. */
class RequestJwtVerifyCall extends DataFlow::MethodCallNode {
  RequestJwtVerifyCall() { this.getMethodName() = "jwtVerify" }
}

/** A token-type value: the exported constants or their string literals. */
predicate isTokenTypeValue(Expr e) {
  e.getUnderlyingValue().(VarAccess).getName() = ["ACCESS_TOKEN_TYPE", "REFRESH_TOKEN_TYPE"]
  or
  e.getUnderlyingValue().(StringLiteral).getValue() = ["access", "refresh"]
}

/** An equality test `<base>.type ==/!= <token type>`; `typeRead` is the `.type` access. */
predicate typeComparison(EqualityTest eq, PropAccess typeRead) {
  typeRead = eq.getAnOperand().getUnderlyingValue() and
  typeRead.getPropertyName() = "type" and
  isTokenTypeValue(eq.getAnOperand())
}

/**
 * Holds if `eq` compares the `type` claim destructured out of `call`'s result
 * (`const { id, type } = app.jwt.verify(token); if (type !== ACCESS_TOKEN_TYPE)`).
 */
predicate destructuredTypeComparison(EqualityTest eq, DataFlow::MethodCallNode call) {
  exists(DataFlow::PropRead pr |
    pr.getPropertyName() = "type" and
    call.flowsTo(pr.getBase()) and
    pr.flowsToExpr(eq.getAnOperand()) and
    isTokenTypeValue(eq.getAnOperand())
  )
}

/** Holds if the result of `call` has its `type` claim compared in `call`'s function. */
predicate isTypeChecked(DataFlow::MethodCallNode call) {
  exists(EqualityTest eq, PropAccess typeRead |
    typeComparison(eq, typeRead) and
    eq.getContainer() = call.getContainer()
  |
    call instanceof JwtVerifyCall and
    call.flowsToExpr(typeRead.getBase())
    or
    call instanceof RequestJwtVerifyCall and
    typeRead.getBase().getUnderlyingReference().(PropAccess).getPropertyName() = "user"
  )
  or
  call instanceof JwtVerifyCall and
  exists(EqualityTest eq |
    eq.getContainer() = call.getContainer() and destructuredTypeComparison(eq, call)
  )
}

from DataFlow::MethodCallNode call
where
  (call instanceof JwtVerifyCall or call instanceof RequestJwtVerifyCall) and
  MarketTrader::isServerSrc(call.getFile()) and
  not isTypeChecked(call)
select call,
  "The verified token's `type` claim is never compared in this function; check `payload.type === ACCESS_TOKEN_TYPE` (or REFRESH_TOKEN_TYPE on the refresh path) before using its claims."
