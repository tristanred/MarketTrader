/**
 * Drizzle-shaped vocabulary shared by the business-rule queries: table
 * references, `insert`/`update`/`delete` chains, transaction handles, and the
 * route that encloses a piece of code.
 */

import javascript
import lib.MarketTrader

module Business {
  /** A Drizzle table exported from `db/schema.*.ts`. */
  string tableName() {
    result =
      [
        "users", "groups", "userGroups", "adminAuditLog", "games", "gamePlayers", "portfolios",
        "trades", "stockPriceCache", "watchlists", "watchlistItems", "systemSettings",
        "portfolioSnapshots", "achievementProgress", "gameAchievementOverrides", "gamePlayerStats",
        "positionHighWater", "discoverMarketMovers", "gameDiscoverPicks"
      ]
  }

  /** Holds if `e` refers to the table `name`, as `trades` or `schema.trades`. */
  predicate namesTable(Expr e, string name) {
    name = tableName() and
    (
      e.getUnderlyingValue().(VarAccess).getName() = name
      or
      e.getUnderlyingValue().(PropAccess).getPropertyName() = name
    )
  }

  /** `x.insert(T)`, `x.update(T)` or `x.delete(T)` where `T` is a schema table. */
  class DrizzleWrite extends DataFlow::MethodCallNode {
    string op;
    string table;

    DrizzleWrite() {
      op = ["insert", "update", "delete"] and
      this.getMethodName() = op and
      this.getNumArgument() = 1 and
      namesTable(this.getArgument(0).asExpr(), table)
    }

    /** `insert`, `update` or `delete`. */
    string getOp() { result = op }

    /** The table name, e.g. `gamePlayers`. */
    string getTable() { result = table }

    /** The next call in the builder chain with method `name`, e.g. `set`, `values`, `where`. */
    DataFlow::MethodCallNode getChained(string name) {
      result.getMethodName() = name and
      (
        result.getReceiver() = this
        or
        result.getReceiver() = this.getChained(_)
      )
    }

    /**
     * The object literal passed to `.set(...)` / `.values(...)`, when it is one,
     * or each object literal of a bulk `.values([...])`.
     */
    DataFlow::ObjectLiteralNode getPayload() {
      exists(DataFlow::Node arg | arg = this.getChained(["set", "values"]).getArgument(0) |
        result = arg.getALocalSource()
        or
        result = arg.getALocalSource().(DataFlow::ArrayLiteralNode).getAnElement().getALocalSource()
      )
    }

    /** The argument of `.where(...)`, if any. */
    DataFlow::Node getWhere() { result = this.getChained("where").getArgument(0) }
  }

  /** The first parameter of a `x.transaction(async (tx) => ...)` callback. */
  class TxParam extends DataFlow::ParameterNode {
    DataFlow::MethodCallNode txCall;

    TxParam() {
      txCall.getMethodName() = "transaction" and
      this = txCall.getCallback(0).getParameter(0)
    }

    /** The `transaction(...)` call that opened this handle. */
    DataFlow::MethodCallNode getTransactionCall() { result = txCall }

    /** The transaction callback this is the parameter of. */
    Function getCallbackFunction() { result = txCall.getCallback(0).getFunction() }
  }

  /** A call to `recordAdminAction(handle, {...})`. */
  class AuditCall extends DataFlow::CallNode {
    AuditCall() { this.getCalleeName() = "recordAdminAction" }
  }

  private module TxFlowConfig implements DataFlow::ConfigSig {
    predicate isSource(DataFlow::Node n) { n instanceof TxParam }

    predicate isSink(DataFlow::Node n) {
      n = any(DrizzleWrite w).getReceiver()
      or
      n = any(DataFlow::InvokeNode c).getAnArgument()
    }
  }

  private module TxFlow = DataFlow::Global<TxFlowConfig>;

  /**
   * Holds if `n` is (flows from) a transaction handle — directly a `tx`
   * parameter, or a helper parameter that every-or-some caller feeds a `tx`.
   */
  predicate isTxHandle(DataFlow::Node n) { TxFlow::flowTo(n) }

  /**
   * Holds if the handle `n` may be the base connection: no transaction handle
   * reaches it, or it is a helper parameter that some caller feeds a non-tx
   * value (`isTxHandle` alone accepts a helper if *any* caller passes a tx).
   */
  predicate mayRunOutsideTx(DataFlow::Node n) {
    not isTxHandle(n)
    or
    exists(DataFlow::FunctionNode fn, int i, DataFlow::CallNode c |
      fn.getParameter(i).flowsTo(n) and
      c.getACallee() = fn.getFunction() and
      not isTxHandle(c.getArgument(i))
    )
  }

  /** Holds if `w` writes through a transaction handle on every call path. */
  predicate inTransaction(DrizzleWrite w) { not mayRunOutsideTx(w.getReceiver()) }

  /** The innermost-to-outermost containers enclosing `n`. */
  StmtContainer enclosingContainer(AstNode n) { result = n.getContainer().getEnclosingContainer*() }

  /** A label for `f` in an alert: its name, or the route it handles when anonymous. */
  string functionLabel(Function f) {
    result = f.getName()
    or
    not exists(f.getName()) and
    (
      exists(MarketTrader::RouteRegistration r | r.getHandler().getFunction() = f |
        result = r.getMethodName().toUpperCase() + " " + r.getPath() + " handler"
      )
      or
      not exists(MarketTrader::RouteRegistration r | r.getHandler().getFunction() = f) and
      result = "this function"
    )
  }

  /** Holds if a Fastify route is registered somewhere inside `f`. */
  private predicate registersRoutes(Function f) {
    exists(MarketTrader::RouteRegistration r | f = enclosingContainer(r.asExpr()))
  }

  /**
   * The unit of code `n` belongs to: the outermost enclosing function that does
   * not itself register routes. For a service that is the top-level function;
   * inside a routes factory it is the route handler (or a helper declared in
   * the factory), never the factory, which would merge every handler together.
   */
  Function scopeFunction(AstNode n) {
    result = enclosingContainer(n) and
    not registersRoutes(result) and
    not exists(Function outer |
      outer = result.getEnclosingContainer+() and
      not registersRoutes(outer)
    )
  }

  /** The Fastify route whose handler (transitively) encloses `n`. */
  MarketTrader::RouteRegistration enclosingRoute(AstNode n) {
    result.getHandler().getFunction() = enclosingContainer(n)
  }

  /** Holds if `s` is a `sql\`...\`` tagged template. */
  predicate isSqlTemplate(Expr s) {
    s.getUnderlyingValue().(TaggedTemplateExpr).getTag().(VarAccess).getName() = "sql"
  }

  /** The value written to property `prop` of a `.set`/`.values` payload (shorthand included). */
  DataFlow::Node payloadValue(DrizzleWrite w, string prop) {
    result = w.getPayload().getAPropertyWrite(prop).getRhs()
  }
}
