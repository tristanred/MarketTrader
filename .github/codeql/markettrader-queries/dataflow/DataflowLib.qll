/**
 * Helpers shared by the value-flow invariant queries in `dataflow/`: Drizzle
 * query recognition, the Postgres decimal column set, and the trade-write
 * sinks those queries agree on.
 */

import javascript
import lib.MarketTrader

module DataflowLib {
  /** Holds if `n` refers to a Drizzle database handle: `db`, `tx`, `trx`, or `<x>.db`. */
  predicate isDbRef(DataFlow::Node n) {
    exists(Expr e | e = n.asExpr().getUnderlyingReference() |
      e.(VarAccess).getName() = ["db", "tx", "trx"]
      or
      e.(PropAccess).getPropertyName() = "db"
    )
  }

  /** Gets `c` or any method call further down its receiver chain. */
  DataFlow::MethodCallNode chainLink(DataFlow::MethodCallNode c) {
    result = c
    or
    result = chainLink(c.getReceiver().(DataFlow::MethodCallNode))
  }

  /** Gets the first call of the chain ending at `c` whose receiver is a database handle. */
  DataFlow::MethodCallNode chainRoot(DataFlow::MethodCallNode c) {
    result = chainLink(c) and isDbRef(result.getReceiver())
    or
    // db.query.<table>.findFirst(...)
    result = chainLink(c) and
    result.getMethodName() = ["findFirst", "findMany"] and
    exists(DataFlow::PropRead table, DataFlow::PropRead query |
      table = result.getReceiver() and
      query = table.getBase() and
      query.getPropertyName() = "query" and
      isDbRef(query.getBase())
    )
  }

  /** Gets the name a table reference is spelled with: `trades` or `schema.trades` both give `trades`. */
  string tableRefName(DataFlow::Node n) {
    result = n.asExpr().getUnderlyingReference().(VarAccess).getName()
    or
    result = n.asExpr().getUnderlyingReference().(PropAccess).getPropertyName()
  }

  /**
   * A Drizzle query whose awaited value is a row or an array of rows: the outermost
   * call of a `db.select(...)...` chain, a `.returning()` chain, or `db.query.T.findFirst/findMany`.
   */
  class DrizzleQuery extends DataFlow::MethodCallNode {
    DataFlow::MethodCallNode root;

    DrizzleQuery() {
      root = chainRoot(this) and
      not exists(DataFlow::MethodCallNode outer | outer.getReceiver() = this) and
      (
        root.getMethodName() = ["select", "selectDistinct"]
        or
        root.getMethodName() = ["insert", "update", "delete"] and
        chainLink(this).getMethodName() = "returning"
        or
        root.getMethodName() = ["findFirst", "findMany"]
      )
    }

    /** Gets the first call of the chain (`select`, `insert`, `findFirst`, ...). */
    DataFlow::MethodCallNode getRoot() { result = root }

    /** Gets the name of the table the query reads from or writes to. */
    string getTableName() {
      exists(DataFlow::MethodCallNode fromCall | fromCall = chainLink(this) |
        fromCall.getMethodName() = "from" and result = tableRefName(fromCall.getArgument(0))
      )
      or
      root.getMethodName() = ["insert", "update", "delete"] and
      result = tableRefName(root.getArgument(0))
      or
      root.getMethodName() = ["findFirst", "findMany"] and
      result = root.getReceiver().(DataFlow::PropRead).getPropertyName()
    }

    /**
     * Holds if the rows this query yields carry the Postgres decimal column `col`,
     * either through an explicit projection `{ k: T.col }` (then `key` is `k`) or
     * because the whole row of a table with that column is selected (then `key = col`).
     */
    predicate yieldsDecimal(string key, string col) {
      exists(DataFlow::ObjectLiteralNode proj, DataFlow::PropRead colRef |
        root.getMethodName() = ["select", "selectDistinct"] and
        proj = root.getArgument(0).getALocalSource() and
        colRef = proj.getAPropertyWrite(key).getRhs() and
        col = colRef.getPropertyName() and
        decimalColumn(tableRefName(colRef.getBase()), col)
      )
      or
      not exists(root.getArgument(0)) and
      root.getMethodName() = ["select", "selectDistinct"] and
      decimalColumn(this.getTableName(), col) and
      key = col
      or
      // The relational API takes options, not a projection: the whole row comes
      // back unless a `columns` option narrows it (then only `col: true` survives).
      root.getMethodName() = ["findFirst", "findMany"] and
      decimalColumn(this.getTableName(), col) and
      key = col and
      (
        not exists(root.getArgument(0).getALocalSource().(DataFlow::ObjectLiteralNode).getAPropertyWrite("columns"))
        or
        root.getArgument(0)
            .getALocalSource()
            .(DataFlow::ObjectLiteralNode)
            .getAPropertyWrite("columns")
            .getRhs()
            .getALocalSource()
            .(DataFlow::ObjectLiteralNode)
            .getAPropertyWrite(col)
            .getRhs()
            .mayHaveBooleanValue(true)
      )
      or
      exists(DataFlow::MethodCallNode ret |
        ret = chainLink(this) and
        ret.getMethodName() = "returning" and
        not exists(ret.getArgument(0)) and
        decimalColumn(this.getTableName(), col) and
        key = col
      )
    }
  }

  /** Gets the receiver chain root of a column-definition call: `decimal(...)` in `decimal(...).notNull()`. */
  private DataFlow::Node columnBuilderRoot(DataFlow::Node n) {
    result = n and not n instanceof DataFlow::MethodCallNode
    or
    result = columnBuilderRoot(n.(DataFlow::MethodCallNode).getReceiver())
  }

  /**
   * Holds if `table.col` is declared `decimal(...)` / `numeric(...)` in `db/schema.pg.ts`,
   * i.e. the postgres-js driver returns it as a string at runtime.
   */
  predicate decimalColumn(string table, string col) {
    exists(DataFlow::CallNode pgTable, VariableDeclarator d, DataFlow::CallNode builder |
      MarketTrader::serverFile(pgTable.getFile(), "db/schema.pg.ts") and
      pgTable.getCalleeName() = "pgTable" and
      d.getInit() = pgTable.asExpr() and
      table = d.getBindingPattern().(VarDecl).getName() and
      builder =
        columnBuilderRoot(pgTable
              .getArgument(1)
              .getALocalSource()
              .(DataFlow::ObjectLiteralNode)
              .getAPropertyWrite(col)
              .getRhs()) and
      builder.getCalleeName() = ["decimal", "numeric"]
    )
  }

  /** Holds if `col` is a decimal column of some table. */
  predicate decimalColumnName(string col) { decimalColumn(_, col) }

  /** A call to `executeTrade(db, params)` (services/trade.ts). */
  class ExecuteTradeCall extends DataFlow::CallNode {
    ExecuteTradeCall() { this.getCalleeName() = "executeTrade" }

    /** Gets the object literal passed as the trade parameters. */
    DataFlow::ObjectLiteralNode getParamsObject() {
      result = this.getAnArgument().getALocalSource()
    }
  }

  /** A `.set({...})` or `.values({...})` call on `update(trades)` / `insert(trades)`. */
  class TradesWrite extends DataFlow::MethodCallNode {
    TradesWrite() {
      this.getMethodName() = ["set", "values"] and
      exists(DataFlow::MethodCallNode w | w = chainLink(this) |
        w.getMethodName() = ["update", "insert"] and
        tableRefName(w.getArgument(0)) = "trades"
      )
    }

    /** Gets the object literal of column values written. */
    DataFlow::ObjectLiteralNode getValuesObject() { result = this.getArgument(0).getALocalSource() }
  }
}
