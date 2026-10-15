/**
 * @name JWT reaches a logged or persisted sink
 * @description Access and refresh tokens may only travel in the Authorization header, the WebSocket subprotocol offer, the refresh cookie or the auth response body; a token in a log, telemetry, close reason, URL, web storage or the handleProtocols echo is a replayable credential leak.
 * @kind problem
 * @problem.severity error
 * @id markettrader/access-token-leak
 * @tags security
 *       external/cwe/cwe-532
 *       external/cwe/cwe-598
 * @precision high
 * @security-severity 8.0
 */

import javascript
import lib.MarketTrader
import secrets.SecretsLib

/** A JWT the server mints or receives, or the frontend's in-memory access token. */
class TokenSource extends DataFlow::Node {
  string kind;

  TokenSource() {
    MarketTrader::isServerSrc(this.getFile()) and
    (
      this.(DataFlow::CallNode).getCalleeName() = "extractSubprotocolToken" and
      kind = "the WebSocket subprotocol token"
      or
      exists(MarketTrader::RequestInput h | h.getKind() = "headers" |
        this.(DataFlow::PropRead).getBase().getALocalSource() = h and
        this.(DataFlow::PropRead).getPropertyName() = "sec-websocket-protocol"
      ) and
      kind = "the raw Sec-WebSocket-Protocol header"
      or
      this.(DataFlow::CallNode).getCalleeName() = ["signAccessToken", "signRefreshToken"] and
      kind = "a freshly signed JWT"
      or
      this = any(SecretsLib::HandleProtocolsFunction f).getParameter(0) and
      kind = "the offered subprotocols (which carry the token)"
    )
    or
    MarketTrader::isFrontendSrc(this.getFile()) and
    kind = "the access token from useAuthStore" and
    (
      // useAuthStore.getState().token
      exists(DataFlow::MethodCallNode gs |
        gs.getMethodName() = "getState" and
        gs.getReceiver().asExpr().getUnderlyingReference().(VarAccess).getName() = "useAuthStore" and
        this.(DataFlow::PropRead).getBase().getALocalSource() = gs and
        this.(DataFlow::PropRead).getPropertyName() = "token"
      )
      or
      // useAuthStore((s) => s.token)
      exists(DataFlow::CallNode sel, DataFlow::FunctionNode f |
        sel.getCalleeName() = "useAuthStore" and
        f = sel.getArgument(0).getALocalSource() and
        f.getAReturn().(DataFlow::PropRead).getPropertyName() = "token" and
        this = sel
      )
    )
  }

  string getKind() { result = kind }
}

class ForbiddenTokenSink extends DataFlow::Node {
  string what;

  ForbiddenTokenSink() {
    MarketTrader::isAppSrc(this.getFile()) and
    (
      this instanceof SecretsLib::TelemetrySink and what = "log/analytics/span telemetry"
      or
      this instanceof SecretsLib::SocketCloseReasonSink and what = "a WebSocket close reason"
      or
      this instanceof SecretsLib::UrlSink and what = "a URL"
      or
      this instanceof SecretsLib::WebStorageSink and what = "web storage"
      or
      this = any(SecretsLib::HandleProtocolsFunction f).getAReturn() and
      what = "the handleProtocols return value (echoed in the handshake response)"
    )
  }

  string getWhat() { result = what }
}

module TokenConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node n) { n instanceof TokenSource }

  predicate isSink(DataFlow::Node n) { n instanceof ForbiddenTokenSink }

  predicate isAdditionalFlowStep(DataFlow::Node pred, DataFlow::Node succ) {
    SecretsLib::capturedVariableStep(pred, succ)
  }

  // A verified payload carries claims, not the credential itself.
  predicate isBarrier(DataFlow::Node n) {
    exists(DataFlow::MethodCallNode v |
      v.getMethodName() = "verify" and
      v.getReceiver().(DataFlow::PropRead).getPropertyName() = "jwt" and
      n = v
    )
  }
}

module TokenFlow = TaintTracking::Global<TokenConfig>;

from TokenSource src, ForbiddenTokenSink sink
where TokenFlow::flow(src, sink)
select sink,
  "A JWT from $@ reaches " + sink.getWhat() +
    "; tokens may only travel in the Authorization header, the subprotocol offer, the refresh cookie or the auth response body.",
  src, src.getKind()
