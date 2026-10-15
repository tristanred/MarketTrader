/**
 * @name Postgres decimal column used without Number()
 * @description On Postgres, decimal/numeric columns come back from Drizzle as strings; reading one into arithmetic, a comparison, an API response, an event or an audit record without Number() gives string concatenation, lexicographic comparison or a string where clients expect a number.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/decimal-column-without-number
 * @tags correctness
 * @precision medium
 */

import javascript
import lib.MarketTrader
import dataflow.DataflowLib

/** Tracks a Drizzle query result to the rows read out of it. */
module RowConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node n) {
    n instanceof DataflowLib::DrizzleQuery and MarketTrader::isServerSrc(n.getFile())
  }

  predicate isSink(DataFlow::Node n) { n = any(DataFlow::PropRead pr).getBase() }
}

module RowFlow = TaintTracking::Global<RowConfig>;

/** A read of a decimal column off a row a Drizzle query returned: `player.cashBalance`. */
class DecimalRead extends DataFlow::Node instanceof DataFlow::PropRead {
  DataflowLib::DrizzleQuery query;
  string column;

  DecimalRead() {
    RowFlow::flow(query, super.getBase()) and
    query.yieldsDecimal(super.getPropertyName(), column)
  }

  string describe() { result = "decimal column `" + column + "`" }
}

/** A whole result of a Drizzle query whose rows carry a decimal column. */
class DecimalRows extends DataflowLib::DrizzleQuery {
  DecimalRows() { this.yieldsDecimal(_, _) and MarketTrader::isServerSrc(this.getFile()) }

  string describe() {
    result =
      "rows carrying decimal column(s) " +
        concat(string c | this.yieldsDecimal(_, c) | "`" + c + "`", ", " order by c)
  }
}

/** Holds if `e` is statically a string: a string literal or a template literal. */
predicate isStringy(Expr e) {
  exists(e.getUnderlyingValue().getStringValue()) or
  e.getUnderlyingValue() instanceof TemplateLiteral
}

/** An operand of arithmetic or an ordering comparison, or the receiver of `toFixed`. */
class NumericUseSink extends DataFlow::Node {
  string what;

  NumericUseSink() {
    exists(BinaryExpr b | this.asExpr() = b.getAnOperand() |
      b instanceof ArithmeticExpr and
      not (b instanceof AddExpr and isStringy(b.getAnOperand())) and
      what = "arithmetic"
      or
      b instanceof RelationalComparison and what = "a comparison"
    )
    or
    exists(CompoundAssignExpr a | this.asExpr() = [a.getLhs(), a.getRhs()] | what = "arithmetic")
    or
    exists(DataFlow::MethodCallNode c |
      c.getMethodName() = ["toFixed", "toPrecision"] and this = c.getReceiver() and what = "toFixed"
    )
  }

  string describe() { result = what }
}

/** Holds if `n` is the receiver of a method call, as `bus` / `this.bus` / `registry`. */
bindingset[name]
predicate receiverNamed(DataFlow::MethodCallNode c, string name) {
  exists(Expr e | e = c.getReceiver().asExpr().getUnderlyingReference() |
    e.(VarAccess).getName() = name or e.(PropAccess).getPropertyName() = name
  )
}

/** A payload that leaves the process or is persisted as JSON: response, event, broadcast, audit record. */
class PayloadSink extends DataFlow::Node {
  string what;

  PayloadSink() {
    MarketTrader::isServerSrc(this.getFile()) and
    (
      this instanceof MarketTrader::HttpResponseSink and what = "an HTTP response"
      or
      exists(DataFlow::MethodCallNode c | receiverNamed(c, "bus") and c.getMethodName() = "emit" |
        this = c.getAnArgument() and what = "an event-bus payload"
      )
      or
      exists(DataFlow::MethodCallNode c |
        receiverNamed(c, ["registry", "globalRegistry"]) and c.getMethodName() = "broadcast"
      |
        this = c.getAnArgument() and what = "a WebSocket broadcast"
      )
      or
      // The audit log JSON-serialises before/after; a decimal string there is
      // frozen into the record and differs by dialect (number on SQLite).
      exists(DataFlow::CallNode c | c.getCalleeName() = "recordAdminAction" |
        this = c.getArgument(1).getALocalSource().(DataFlow::ObjectLiteralNode).getAPropertyWrite(["before", "after", "metadata"]).getRhs() and
        what = "an admin audit record"
      )
    )
  }

  string describe() { result = what }
}

module DecimalValueConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node n) { n instanceof DecimalRead }

  predicate isSink(DataFlow::Node n) {
    (n instanceof NumericUseSink or n instanceof PayloadSink) and
    MarketTrader::isServerSrc(n.getFile())
  }

  predicate allowImplicitRead(DataFlow::Node n, DataFlow::ContentSet c) {
    n instanceof PayloadSink and
    c = [DataFlow::ContentSet::anyProperty(), DataFlow::ContentSet::arrayElement()]
  }
}

module DecimalValueFlow = DataFlow::Global<DecimalValueConfig>;

/**
 * Holds if `{ ...row, ... }` copies `row`'s property `key` into `obj`: the
 * library does not carry content through object spread, and a literal that
 * re-writes `key` after the spread (`startingBalance: Number(...)`) drops it.
 */
predicate spreadCopies(DataFlow::Node row, DataFlow::ObjectLiteralNode obj, string key) {
  exists(SpreadProperty sp |
    sp = obj.asExpr().(ObjectExpr).getAProperty() and
    row = sp.getInit().(SpreadElement).getOperand().flow() and
    any(DecimalRows r).yieldsDecimal(key, _) and
    not exists(Property p |
      p = obj.asExpr().(ObjectExpr).getAProperty() and
      p.getName() = key and
      p.getIndex() > sp.getIndex()
    )
  )
}

/**
 * Holds if `succ` is one row of the row array `pred`: `const [row] = rows`,
 * `rows[i]`, `rows.map((row) => ...)` and friends, `for (const row of rows)`,
 * or the same rows re-filtered/sorted.
 */
predicate rowStep(DataFlow::Node pred, DataFlow::Node succ) {
  exists(DataFlow::PropRead pr | pr = succ and pred = pr.getBase() |
    exists(pr.getPropertyName().toInt())
    or
    not exists(pr.getPropertyName()) and pr.asExpr() instanceof IndexExpr
  )
  or
  exists(DataFlow::MethodCallNode c | pred = c.getReceiver() |
    c.getMethodName() = ["map", "flatMap", "forEach", "filter", "find", "findLast", "some", "every"] and
    succ = c.getCallback(0).getParameter(0)
    or
    c.getMethodName() = ["filter", "slice", "sort", "toSorted", "reverse", "toReversed", "find", "findLast", "at"] and
    succ = c
  )
  or
  exists(ForOfStmt fo |
    pred = fo.getIterationDomain().flow() and
    succ = DataFlow::lvalueNode(fo.getLValue())
  )
}

module DecimalRowsConfig implements DataFlow::StateConfigSig {
  /** The row key that carries the decimal column. */
  class FlowState = string;

  predicate isSource(DataFlow::Node n, FlowState key) { n.(DecimalRows).yieldsDecimal(key, _) }

  predicate isSink(DataFlow::Node n, FlowState key) { n instanceof PayloadSink and any(DecimalRows r).yieldsDecimal(key, _) }

  predicate isAdditionalFlowStep(DataFlow::Node pred, FlowState s1, DataFlow::Node succ, FlowState s2) {
    spreadCopies(pred, succ, s1) and s2 = s1
  }

  // A query result is an opaque value with no stored array content, so the
  // library's element reads find nothing in it; these steps take a row out.
  // (Taint tracking would, but it also taints every column read off the row,
  // flagging rows already rebuilt with Number().)
  predicate isAdditionalFlowStep(DataFlow::Node pred, DataFlow::Node succ) { rowStep(pred, succ) }

  predicate allowImplicitRead(DataFlow::Node n, DataFlow::ContentSet c) {
    n instanceof PayloadSink and
    c = [DataFlow::ContentSet::anyProperty(), DataFlow::ContentSet::arrayElement(), DataFlow::ContentSet::promiseValue()]
  }
}

module DecimalRowsFlow = DataFlow::GlobalWithState<DecimalRowsConfig>;

string sinkDescription(DataFlow::Node sink) {
  result = sink.(NumericUseSink).describe() or result = sink.(PayloadSink).describe()
}

from DataFlow::Node source, DataFlow::Node sink, string what
where
  DecimalValueFlow::flow(source, sink) and what = source.(DecimalRead).describe()
  or
  DecimalRowsFlow::flow(source, sink) and what = source.(DecimalRows).describe()
select sink,
  "$@ reaches " + sinkDescription(sink) + " without Number(); on Postgres it is a string here.",
  source, what
