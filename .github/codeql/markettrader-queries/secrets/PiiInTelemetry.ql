/**
 * @name Username, email or password reaches logs, analytics, span or metric attributes
 * @description Usernames, emails and password fields are personal data; telemetry should key on the opaque user id instead, so log/OTLP/PostHog storage holds no directly identifying values.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/pii-in-telemetry
 * @tags security
 *       external/cwe/cwe-359
 *       external/cwe/cwe-532
 * @precision medium
 * @security-severity 4.0
 */

import javascript
import lib.MarketTrader
import secrets.SecretsLib

/**
 * A username, email or password-like value: a request-body field of that name on
 * the server, or a `.username` / `.email` property read anywhere in app source
 * (the frontend's `user.username`, a DB row's `username` column, a JWT claim).
 */
class PiiSource extends DataFlow::Node {
  string field;

  PiiSource() {
    MarketTrader::isAppSrc(this.getFile()) and
    (
      field = this.(SecretsLib::BodyFieldRead).getField() and
      field = ["username", "email", "password", "newPassword", "currentPassword"]
      or
      field = this.(DataFlow::PropRead).getPropertyName() and
      field = ["username", "email"]
    )
  }

  string getField() { result = field }
}

class TelemetryPiiSink extends DataFlow::Node {
  TelemetryPiiSink() {
    MarketTrader::isAppSrc(this.getFile()) and
    (
      this instanceof SecretsLib::TelemetrySink
      or
      exists(MarketTrader::MetricAttributesSink m | SecretsLib::withinLiteral(m, this))
    ) and
    // The one-time stdout announcement of the seeded `admin` account (a system
    // account, not a person) is the documented delivery for its credentials.
    not exists(MarketTrader::ConsoleCall c |
      MarketTrader::serverFile(c.getFile(), "db/seed-admin.ts") and
      c.getCalleeName() = "log" and
      SecretsLib::withinLiteral(c.getAnArgument(), this)
    )
  }
}

module PiiConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node n) { n instanceof PiiSource }

  predicate isSink(DataFlow::Node n) { n instanceof TelemetryPiiSink }

  // Report each leak from the nearest source (a destructured body field, not request.body).
  predicate isBarrierIn(DataFlow::Node n) { isSource(n) }

  predicate isAdditionalFlowStep(DataFlow::Node pred, DataFlow::Node succ) {
    SecretsLib::capturedVariableStep(pred, succ)
  }
}

module PiiFlow = TaintTracking::Global<PiiConfig>;

from PiiSource src, TelemetryPiiSink sink
where PiiFlow::flow(src, sink)
select sink,
  "The " + src.getField() +
    " from $@ reaches log/analytics/telemetry; key telemetry on the opaque user id, or record a deliberate exception.",
  src, src.getField()
