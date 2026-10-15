/**
 * @name Quote price returned without a positivity check
 * @description A StockProvider's getQuote/getQuotes must only return a price it has checked is positive (and so finite); every fill, reservation and price-cache row trusts that price as-is.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/unguarded-quote-price
 * @tags correctness
 * @precision high
 */

import javascript
import lib.MarketTrader

/** A provider source file (`providers/*.ts`, not the market-status subfolder). */
predicate isProviderFile(File f) {
  MarketTrader::serverFile(f, "providers/%") and
  not MarketTrader::serverFile(f, "providers/market-status/%")
}

/** Data an upstream market-data API returned: a `client.*(...)` call or `res.json()`. */
class UpstreamData extends DataFlow::MethodCallNode {
  UpstreamData() {
    isProviderFile(this.getFile()) and
    (
      this.getMethodName() = "json"
      or
      this.getReceiver().asExpr().getUnderlyingReference().(PropAccess).getPropertyName() = "client"
    )
  }
}

/** A `getQuote` / `getQuotes` method of a provider class. */
class QuoteMethod extends Function {
  QuoteMethod() {
    isProviderFile(this.getFile()) and
    exists(MethodDeclaration m | m.getBody() = this and m.getName() = ["getQuote", "getQuotes"])
  }
}

/** The `price` of a quote object built inside a `getQuote` / `getQuotes` method. */
class QuotePriceSink extends DataFlow::Node {
  QuotePriceSink() {
    exists(DataFlow::ObjectLiteralNode quote |
      quote.getContainer() instanceof QuoteMethod and
      this = quote.getAPropertyWrite("price").getRhs()
    )
  }
}

/**
 * A check that a value is a positive number (`x > 0`, `0 < x`, `x >= k` with k > 0,
 * or its negation `x <= 0` on the false branch) or finite (`Number.isFinite(x)`, `isFinite(x)`).
 */
class PositivePriceGuard extends DataFlow::Node {
  Expr checked;
  boolean passes;

  PositivePriceGuard() {
    exists(RelationalComparison cmp, Expr bound | cmp = this.asExpr() |
      // x > b / x >= b (greater operand is checked, lesser is the bound)
      cmp.getGreaterOperand() = checked and
      cmp.getLesserOperand() = bound and
      bound.getIntValue() >= 0 and
      (not cmp.isInclusive() or bound.getIntValue() > 0) and
      passes = true
      or
      // x <= 0 / x < b: price fails the check when this is true
      cmp.getLesserOperand() = checked and
      cmp.getGreaterOperand() = bound and
      bound.getIntValue() >= 0 and
      (cmp.isInclusive() or bound.getIntValue() > 0) and
      passes = false
    )
    or
    exists(DataFlow::CallNode c | c = this |
      (
        c = DataFlow::globalVarRef("Number").getAMemberCall("isFinite")
        or
        c = DataFlow::globalVarRef("isFinite").getACall()
      ) and
      checked = c.getArgument(0).asExpr() and
      passes = true
    )
  }

  predicate blocksExpr(boolean outcome, Expr e) { e = checked and outcome = passes }
}

module QuotePriceConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node n) { n instanceof UpstreamData }

  predicate isSink(DataFlow::Node n) { n instanceof QuotePriceSink }

  predicate isBarrier(DataFlow::Node n) {
    n = DataFlow::MakeBarrierGuard<PositivePriceGuard>::getABarrierNode()
  }
}

module QuotePriceFlow = TaintTracking::Global<QuotePriceConfig>;

from DataFlow::Node source, QuotePriceSink sink
where QuotePriceFlow::flow(source, sink)
select sink,
  "Quote price from $@ is returned without a dominating check that it is > 0 (or finite), so 0, negative or NaN prices can reach fills and the price cache. Throw (or skip the symbol) unless price > 0.",
  source, "upstream data"
