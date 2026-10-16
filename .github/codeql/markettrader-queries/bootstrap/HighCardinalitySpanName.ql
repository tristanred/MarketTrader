/**
 * @name High-cardinality span name
 * @description Span names (startActiveSpan/startSpan/updateName) must be low-cardinality; request input, symbols and user/entity ids belong in span attributes, not in the name.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/high-cardinality-span-name
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader

/** The name argument of `startActiveSpan`, `startSpan` or `updateName`. */
class SpanNameSink extends DataFlow::Node {
  SpanNameSink() {
    exists(DataFlow::MethodCallNode c |
      c.getMethodName() = ["startActiveSpan", "startSpan", "updateName"] and
      MarketTrader::isAppSrc(c.getFile()) and
      this = c.getArgument(0)
    )
  }
}

/** Holds if `n` is a reference to a variable named `request` or `req`. */
predicate isRequestVar(DataFlow::Node n) {
  n.asExpr().getUnderlyingReference().(VarAccess).getName() = ["request", "req"]
}

/**
 * A read of an unbounded value: request input, the raw request URL, or a
 * property or parameter named like a symbol or an id.
 */
class UnboundedValue extends DataFlow::Node {
  string what;

  UnboundedValue() {
    what = "request " + this.(MarketTrader::RequestInput).getKind()
    or
    exists(string p | p = this.(DataFlow::PropRead).getPropertyName() |
      p = ["symbol", "userId", "username", "id"] and what = "property '" + p + "'"
    )
    or
    // The raw URL carries path params and the query string; `request.routeOptions.url`
    // (the route template) is bounded and is not matched because its base is a property.
    exists(DataFlow::PropRead pr, string p | pr = this and p = pr.getPropertyName() |
      p = ["url", "originalUrl"] and
      (
        isRequestVar(pr.getBase())
        or
        exists(DataFlow::PropRead raw | raw = pr.getBase() |
          raw.getPropertyName() = "raw" and isRequestVar(raw.getBase())
        )
      ) and
      what = "request " + p
    )
    or
    exists(SimpleParameter sp, string p |
      this = DataFlow::parameterNode(sp) and
      p = sp.getName() and
      p = ["symbol", "userId", "username", "id"] and
      what = "parameter '" + p + "'"
    )
  }

  string describe() { result = what }
}

module SpanNameConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node n) { n instanceof UnboundedValue }

  predicate isSink(DataFlow::Node n) { n instanceof SpanNameSink }
}

module SpanNameFlow = TaintTracking::Global<SpanNameConfig>;

from UnboundedValue source, SpanNameSink sink
where SpanNameFlow::flow(source, sink)
select sink,
  "Span name is derived from $@, which is unbounded; use a fixed name and put the value in a span attribute.",
  source, source.describe()
