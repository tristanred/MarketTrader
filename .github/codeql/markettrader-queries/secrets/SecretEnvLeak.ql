/**
 * @name Secret environment value reaches logs, telemetry, a response or an error message
 * @description JWT_SECRET, the Alpaca keys, POSTHOG_KEY and DATABASE_URL may only be handed to the client that uses them; logging, returning or embedding one in an error message discloses it to journald, the OTLP collector, PostHog or the caller.
 * @kind problem
 * @problem.severity error
 * @id markettrader/secret-env-leak
 * @tags security
 *       external/cwe/cwe-532
 *       external/cwe/cwe-209
 * @precision high
 * @security-severity 7.5
 */

import javascript
import lib.MarketTrader
import secrets.SecretsLib

string secretVarName() {
  result =
    [
      "JWT_SECRET", "ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY", "ALPACA_API_KEY", "POSTHOG_KEY",
      "DATABASE_URL"
    ]
}

/**
 * A read of a secret: `env.X`, `process.env.X`, or `cfg.X` on any other object.
 * The names are specific enough that any property of that name holds the secret —
 * `validateProductionEnv(cfg = env)` reads them off a parameter, not `env`.
 */
class SecretRead extends DataFlow::Node instanceof DataFlow::PropRead {
  SecretRead() {
    MarketTrader::isServerSrc(this.getFile()) and
    super.getPropertyName() = secretVarName()
  }

  string getVarName() { result = super.getPropertyName() }
}

class ForbiddenSecretSink extends DataFlow::Node {
  string what;

  ForbiddenSecretSink() {
    MarketTrader::isServerSrc(this.getFile()) and
    (
      this instanceof SecretsLib::TelemetrySink and what = "log/analytics/span telemetry"
      or
      this instanceof SecretsLib::ResponseSink and what = "an HTTP response"
      or
      this instanceof SecretsLib::ErrorMessageSink and what = "an Error message"
    )
  }

  string getWhat() { result = what }
}

/**
 * A predicate-only use that yields no part of the secret: its length, or a
 * `startsWith`/`endsWith`/`includes` test.
 */
predicate isPredicateOnlyUse(DataFlow::Node n) {
  n.(DataFlow::PropRead).getPropertyName() = "length"
  or
  n.(DataFlow::MethodCallNode).getMethodName() = ["startsWith", "endsWith", "includes"]
}

module SecretConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node n) { n instanceof SecretRead }

  predicate isSink(DataFlow::Node n) { n instanceof ForbiddenSecretSink }

  predicate isBarrier(DataFlow::Node n) { isPredicateOnlyUse(n) }

  // `env.X` is seeded from `process.env.X`; report each leak once, from the nearest read.
  predicate isBarrierIn(DataFlow::Node n) { isSource(n) }

  predicate isAdditionalFlowStep(DataFlow::Node pred, DataFlow::Node succ) {
    SecretsLib::capturedVariableStep(pred, succ)
  }
}

module SecretFlow = TaintTracking::Global<SecretConfig>;

from SecretRead src, ForbiddenSecretSink sink
where SecretFlow::flow(src, sink)
select sink,
  "The value of " + src.getVarName() + " ($@) reaches " + sink.getWhat() +
    "; pass secrets only to the client that uses them, and log at most a length or a boolean.",
  src, src.getVarName()
