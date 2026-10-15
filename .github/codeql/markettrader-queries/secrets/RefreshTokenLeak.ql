/**
 * @name Refresh token leaves the HttpOnly cookie
 * @description The 7-day refresh token may only be delivered via reply.setCookie('refreshToken', ...); putting it in a response body, log or analytics event hands a long-lived credential to script or to telemetry storage.
 * @kind problem
 * @problem.severity error
 * @id markettrader/refresh-token-leak
 * @tags security
 *       external/cwe/cwe-522
 *       external/cwe/cwe-532
 * @precision high
 * @security-severity 8.5
 */

import javascript
import lib.MarketTrader
import secrets.SecretsLib

class RefreshTokenSource extends DataFlow::CallNode {
  RefreshTokenSource() {
    MarketTrader::isServerSrc(this.getFile()) and
    this.getCalleeName() = "signRefreshToken"
  }
}

class ForbiddenRefreshSink extends DataFlow::Node {
  string what;

  ForbiddenRefreshSink() {
    MarketTrader::isServerSrc(this.getFile()) and
    (
      this instanceof SecretsLib::ResponseSink and what = "an HTTP response body"
      or
      this instanceof SecretsLib::TelemetrySink and what = "log/analytics/span telemetry"
    )
  }

  string getWhat() { result = what }
}

module RefreshConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node n) { n instanceof RefreshTokenSource }

  predicate isSink(DataFlow::Node n) { n instanceof ForbiddenRefreshSink }

  predicate isAdditionalFlowStep(DataFlow::Node pred, DataFlow::Node succ) {
    SecretsLib::capturedVariableStep(pred, succ)
  }
}

module RefreshFlow = TaintTracking::Global<RefreshConfig>;

from RefreshTokenSource src, ForbiddenRefreshSink sink
where RefreshFlow::flow(src, sink)
select sink,
  "The refresh token from $@ reaches " + sink.getWhat() +
    "; deliver it only through reply.setCookie('refreshToken', token, { httpOnly: true, ... }).", src,
  "signRefreshToken"
