/**
 * @name Trade execution time taken from the request
 * @description A trade's `executedAt` must be stamped by the server clock, never taken from request input, or a player could backdate fills and game-window checks.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/executed-at-from-request
 * @tags correctness
 *       security
 *       external/cwe/cwe-807
 * @precision high
 */

import javascript
import lib.MarketTrader
import dataflow.DataflowLib

/** The value of an `executedAt` property passed to `executeTrade(...)` or written to the trades table. */
class ExecutedAtSink extends DataFlow::Node {
  ExecutedAtSink() {
    MarketTrader::isServerSrc(this.getFile()) and
    (
      this = any(DataflowLib::ExecuteTradeCall c).getParamsObject().getAPropertyWrite("executedAt").getRhs()
      or
      this = any(DataflowLib::TradesWrite w).getValuesObject().getAPropertyWrite("executedAt").getRhs()
    )
  }
}

module ExecutedAtConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node n) { n instanceof MarketTrader::RequestInput }

  predicate isSink(DataFlow::Node n) { n instanceof ExecutedAtSink }
}

module ExecutedAtFlow = TaintTracking::Global<ExecutedAtConfig>;

from DataFlow::Node source, DataFlow::Node sink
where ExecutedAtFlow::flow(source, sink)
select sink,
  "Trade executedAt is derived from $@; stamp it server-side (new Date().toISOString()) instead.",
  source, "request input"
