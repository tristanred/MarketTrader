/**
 * @name Unbounded per-item getQuote fan-out
 * @description A getQuote call per loop iteration or per element of a Promise.all map scales provider load with user-controlled row counts; batch through getQuotes or chunk the input.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/unbounded-quote-fan-out
 * @tags maintainability
 *       correctness
 * @precision high
 */

import javascript
import lib.MarketTrader
import business.BusinessLib

/** A `.getQuote(...)` call in server code outside the provider layer. */
class QuoteCall extends DataFlow::MethodCallNode {
  QuoteCall() {
    this.getMethodName() = "getQuote" and
    MarketTrader::isServerSrc(this.getFile()) and
    not this.getFile().getRelativePath().matches("%packages/server/src/providers/%")
  }
}

/** `arr.map(cb)` / `flatMap` whose result feeds `Promise.all` / `allSettled`, or any `arr.forEach(cb)`. */
class FanOutCall extends DataFlow::MethodCallNode {
  FanOutCall() {
    this.getMethodName() = ["map", "flatMap"] and
    exists(DataFlow::MethodCallNode all |
      all = DataFlow::globalVarRef("Promise").getAMemberCall(["all", "allSettled"]) and
      this.flowsTo(all.getArgument(0))
    )
    or
    this.getMethodName() = "forEach"
  }
}

/**
 * The chunked-batch pattern used by the price poller: inside a loop, the mapped
 * array is `list.slice(start, start + K)`, so at most K quotes are in flight at a
 * time. A one-argument or open-ended `.slice(...)` is a copy, not a chunk.
 */
predicate isChunked(FanOutCall m) {
  exists(DataFlow::MethodCallNode slice, AddExpr end, Variable start |
    slice = m.getReceiver().getALocalSource() and
    slice.getMethodName() = "slice" and
    slice.getNumArgument() = 2 and
    slice.getArgument(0).asExpr().(VarAccess).getVariable() = start and
    end = slice.getArgument(1).asExpr().getUnderlyingValue() and
    end.getAnOperand().(VarAccess).getVariable() = start
  ) and
  exists(LoopStmt loop | m.asExpr().getParent+() = loop.getBody())
}

/** Holds if `q` runs inside the callback of `m` (directly or in a closure nested in it). */
predicate inCallback(QuoteCall q, FanOutCall m) {
  m.getCallback(0).getFunction() = Business::enclosingContainer(q.asExpr())
}

from QuoteCall q, string how
where
  exists(FanOutCall m |
    inCallback(q, m) and
    not isChunked(m) and
    how = "once per element of a concurrent ." + m.getMethodName() + "(...)"
  )
  or
  // Closures inside the loop body count (e.g. a retry wrapper); fan-out callbacks
  // are left to the arm above so a chunked batch inside a loop stays exempt.
  exists(LoopStmt loop |
    q.asExpr().getParent+() = loop.getBody() and
    not exists(FanOutCall m | inCallback(q, m)) and
    how = "once per loop iteration"
  )
select q,
  "getQuote is called " + how +
    ", so provider load grows with the row count. Fetch the distinct symbols through provider.getQuotes (bounded by a ceiling) or chunk them with a concurrency limit."
