/**
 * @name Unbounded value in a metric attribute
 * @description Metric attribute values must come from a closed set; request input, identifiers, symbols and free-text error strings create one time series per distinct value.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/unbounded-metric-attribute
 * @tags maintainability
 *       correctness
 * @precision high
 */

import javascript
import lib.MarketTrader

/** A value whose set of possible values is unbounded in practice. */
class UnboundedSource extends DataFlow::Node {
  string what;

  UnboundedSource() {
    this instanceof MarketTrader::RequestInput and what = "request input"
    or
    exists(string p | p = this.(DataFlow::PropRead).getPropertyName() |
      p = ["symbol", "userId", "username", "gamePlayerId", "gameId", "id"] and
      what = "the identifier `" + p + "`"
      or
      // Free text: Error messages and the `error` string of a reply payload. The
      // `code` of a TradeError/StockProviderError is a closed union and is not a source.
      p = ["message", "error"] and what = "the free-text `" + p + "` string"
    )
  }

  string describe() { result = what }
}

/** The value of one property of a metric attributes object. */
class MetricAttributeValue extends DataFlow::Node {
  string key;

  MetricAttributeValue() {
    exists(MarketTrader::MetricAttributesSink attrs, DataFlow::ObjectLiteralNode obj |
      MarketTrader::isAppSrc(attrs.getFile()) and
      obj = attrs.getALocalSource() and
      this = obj.getAPropertyWrite(key).getRhs()
    )
  }

  string getKey() { result = key }
}

/** Gets the receiver-chain root of `n`: `z.enum(...)` in `z.enum(...).optional()`. */
DataFlow::Node zodChainRoot(DataFlow::Node n) {
  result = n and not n.(DataFlow::MethodCallNode).getReceiver() instanceof DataFlow::MethodCallNode
  or
  result = zodChainRoot(n.(DataFlow::MethodCallNode).getReceiver())
}

/**
 * Holds if file `f` declares a Zod object field `p` whose schema admits only a closed
 * set of values (`z.enum`, `z.literal`, `z.boolean`, `z.nativeEnum`).
 */
predicate closedZodField(File f, string p) {
  exists(DataFlow::ObjectLiteralNode obj, DataFlow::MethodCallNode zc |
    obj.getFile() = f and
    zc = zodChainRoot(obj.getAPropertyWrite(p).getRhs()) and
    zc.getReceiver().asExpr().(VarAccess).getName() = "z" and
    zc.getMethodName() = ["enum", "literal", "boolean", "nativeEnum"]
  )
}

/**
 * A read of request field `p` in a route file whose Zod schema restricts `p` to a
 * closed set; validation runs before the handler, so the value is bounded.
 */
class ClosedRequestField extends DataFlow::Node instanceof DataFlow::PropRead {
  ClosedRequestField() { closedZodField(this.getFile(), super.getPropertyName()) }
}

module MetricCardinalityConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node n) { n instanceof UnboundedSource }

  predicate isBarrier(DataFlow::Node n) { n instanceof ClosedRequestField }

  // Sources nest (`request.body` -> `.symbol`); report each sink once, from the innermost one.
  predicate isBarrierIn(DataFlow::Node n) { isSource(n) }

  predicate isSink(DataFlow::Node n) { n instanceof MetricAttributeValue }
}

module MetricCardinalityFlow = TaintTracking::Global<MetricCardinalityConfig>;

from UnboundedSource source, MetricAttributeValue sink
where MetricCardinalityFlow::flow(source, sink)
select sink,
  "Metric attribute '" + sink.getKey() + "' is derived from $@ (" + source.describe() +
    "); map it to a fixed set of values (e.g. an error code) or move it to a span attribute.",
  source, source.toString()
