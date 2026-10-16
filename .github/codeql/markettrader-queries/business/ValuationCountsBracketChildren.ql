/**
 * @name Valuation counts bracket children as reserved shares
 * @description Bracket take-profit/stop-loss children are working sells that reserve nothing, so a valuation adding quantity * price for open sell orders must skip rows with a parentTradeId and a non-entry bracketRole, or it counts the same shares twice.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/valuation-counts-bracket-children
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader
import business.BusinessLib

/** Holds if `e` is a query that filters trades to an open status. */
predicate openOrderQuery(Expr e) {
  exists(StringLiteral s | s.getParent+() = e and s.getValue() = ["pending", "working"]) and
  exists(PropAccess p | p.getParent+() = e |
    p.getPropertyName() = "status" and Business::namesTable(p.getBase(), "trades")
  )
}

/** `row.bracketRole` / `row.parentTradeId`, or a variable destructured under that name. */
predicate bracketMention(Expr e) {
  e.(PropAccess).getPropertyName() = ["bracketRole", "parentTradeId"]
  or
  e.(VarAccess).getName() = ["bracketRole", "parentTradeId"]
}

/**
 * Holds if `f` tests for bracket children: a bracket column used in a
 * comparison, a branch condition, or a Drizzle predicate (`isNull`, `eq`, ...).
 * A bare mention such as a `.select({ parentTradeId: ... })` projection does not count.
 */
predicate excludesBracketChildren(Function f) {
  exists(Expr e | bracketMention(e) and f = Business::enclosingContainer(e) |
    exists(EqualityTest t | e.getParent*() = t)
    or
    exists(IfStmt i | e.getParent*() = i.getCondition())
    or
    exists(ConditionalExpr c | e.getParent*() = c.getCondition())
    or
    exists(LogicalBinaryExpr l | e.getParent*() = l)
    or
    exists(LogNotExpr n | e.getParent*() = n)
    or
    exists(CallExpr c |
      c.getCalleeName() = ["isNull", "isNotNull", "eq", "ne", "inArray", "notInArray"] and
      e.getParent*() = c.getAnArgument()
    )
  )
}

from ForOfStmt loop, VarAccess rows, VariableDeclarator decl, AssignAddExpr add, Function f
where
  MarketTrader::isServerSrc(loop.getFile()) and
  rows = loop.getIterationDomain().getUnderlyingValue() and
  decl.getBindingPattern().getAVariable() = rows.getVariable() and
  openOrderQuery(decl.getInit()) and
  add.getParent+() = loop.getBody() and
  exists(MulExpr m, Expr q |
    m = add.getRhs().getUnderlyingValue() and
    q = m.getAnOperand().getUnderlyingValue() and
    (
      q.(PropAccess).getPropertyName() = "quantity"
      or
      q.(VarAccess).getName() = "quantity"
    )
  ) and
  f = loop.getContainer() and
  not excludesBracketChildren(f)
select add,
  "This adds quantity * price for every open sell order fetched in $@, including bracket take-profit/stop-loss children, which reserve no shares; their position is already counted in holdings. Skip rows where parentTradeId != null && bracketRole !== 'entry'.",
  decl, "this query"
