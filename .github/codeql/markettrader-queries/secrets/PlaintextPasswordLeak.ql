/**
 * @name Plaintext password reaches logs, a response, the database or the audit log
 * @description A submitted or generated password may only be passed to argon2 hash/verify (and, for the one-time seeded admin password, the console.log in db/seed-admin.ts); anywhere else it is stored or shipped in clear text.
 * @kind problem
 * @problem.severity error
 * @id markettrader/plaintext-password-leak
 * @tags security
 *       external/cwe/cwe-312
 *       external/cwe/cwe-532
 * @precision high
 * @security-severity 8.0
 */

import javascript
import lib.MarketTrader
import secrets.SecretsLib

class PasswordSource extends DataFlow::Node {
  string kind;

  PasswordSource() {
    MarketTrader::isServerSrc(this.getFile()) and
    (
      this.(SecretsLib::BodyFieldRead).getField() = ["password", "newPassword", "currentPassword"] and
      kind = "request body field '" + this.(SecretsLib::BodyFieldRead).getField() + "'"
      or
      MarketTrader::serverFile(this.getFile(), "db/seed-admin.ts") and
      exists(DataFlow::MethodCallNode toStr |
        toStr = this and
        toStr.getMethodName() = "toString" and
        toStr.getReceiver().(DataFlow::CallNode).getCalleeName() = "randomBytes"
      ) and
      kind = "the generated admin password"
    )
  }

  string getKind() { result = kind }

  predicate isSeedPassword() { kind = "the generated admin password" }
}

class ForbiddenPasswordSink extends DataFlow::Node {
  string what;

  ForbiddenPasswordSink() {
    MarketTrader::isServerSrc(this.getFile()) and
    (
      this instanceof SecretsLib::TelemetrySink and what = "log/analytics/span telemetry"
      or
      this instanceof SecretsLib::ResponseSink and what = "an HTTP response"
      or
      exists(DataFlow::MethodCallNode c |
        (
          c.getMethodName() = "values"
          or
          // drizzle `.set({...})`; Map/Headers `.set(k, v)` take two arguments
          c.getMethodName() = "set" and c.getNumArgument() = 1
        ) and
        SecretsLib::withinLiteral(c.getArgument(0), this)
      ) and
      what = "a database write"
      or
      exists(DataFlow::CallNode c |
        c.getCalleeName() = "recordAdminAction" and
        SecretsLib::withinLiteral(c.getAnArgument(), this)
      ) and
      what = "the admin audit log"
    )
  }

  string getWhat() { result = what }

  /** The deliberate one-time stdout print of the seeded admin's password. */
  predicate isSeedAnnouncement() {
    MarketTrader::serverFile(this.getFile(), "db/seed-admin.ts") and
    exists(MarketTrader::ConsoleCall c |
      c.getCalleeName() = "log" and SecretsLib::withinLiteral(c.getAnArgument(), this)
    )
  }
}

module PasswordConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node n) { n instanceof PasswordSource }

  predicate isSink(DataFlow::Node n) { n instanceof ForbiddenPasswordSink }

  // A hash or a verify verdict reveals nothing of the password.
  predicate isBarrier(DataFlow::Node n) { n instanceof SecretsLib::Argon2Call }

  predicate isAdditionalFlowStep(DataFlow::Node pred, DataFlow::Node succ) {
    SecretsLib::transactionReturnStep(pred, succ) or
    SecretsLib::capturedVariableStep(pred, succ)
  }
}

module PasswordFlow = TaintTracking::Global<PasswordConfig>;

from PasswordSource src, ForbiddenPasswordSink sink
where
  PasswordFlow::flow(src, sink) and
  not (src.isSeedPassword() and sink.isSeedAnnouncement())
select sink,
  "A plaintext password from $@ reaches " + sink.getWhat() +
    "; pass passwords only to argon2 hash/verify and store or log the hash, never the password.",
  src, src.getKind()
