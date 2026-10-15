/**
 * Helpers shared by the `bootstrap` group: app wiring in `buildApp` and
 * observability structure.
 */

import javascript
import lib.MarketTrader

module Bootstrap {
  /** The `buildApp` function in `packages/server/src/app.ts`. */
  class BuildApp extends Function {
    BuildApp() {
      this.getName() = "buildApp" and
      MarketTrader::serverFile(this.getFile(), "app.ts")
    }
  }

  /**
   * Holds if `a` starts strictly before `b` in the same file. Both must be bound:
   * evaluated alone this would materialise every node pair in a file.
   */
  bindingset[a, b]
  predicate before(AstNode a, AstNode b) {
    a.getFile() = b.getFile() and
    (
      a.getLocation().getStartLine() < b.getLocation().getStartLine()
      or
      a.getLocation().getStartLine() = b.getLocation().getStartLine() and
      a.getLocation().getStartColumn() < b.getLocation().getStartColumn()
    )
  }

  /** Holds if `inner` is `outer` or (transitively) nested inside it. */
  predicate containerWithin(StmtContainer inner, StmtContainer outer) {
    inner.getEnclosingContainer*() = outer
  }

  /** `e` with any surrounding `await` and parentheses removed. */
  Expr stripAwait(Expr e) {
    exists(Expr u | u = e.getUnderlyingValue() |
      result = stripAwait(u.(AwaitExpr).getOperand())
      or
      not u instanceof AwaitExpr and result = u
    )
  }

  /** The callback of an `x.addHook('onClose', cb)` call. */
  class OnCloseHook extends Function {
    OnCloseHook() {
      exists(DataFlow::MethodCallNode c |
        c.getMethodName() = "addHook" and
        c.getArgument(0).getStringValue() = "onClose" and
        c.getArgument(1).getALocalSource().(DataFlow::FunctionNode).getFunction() = this
      )
    }
  }

  /** A method name that releases a started resource. */
  string releaseMethod() {
    result = ["stop", "close", "dispose", "destroy", "shutdown", "cancel", "abort", "unsubscribe"]
  }
}
