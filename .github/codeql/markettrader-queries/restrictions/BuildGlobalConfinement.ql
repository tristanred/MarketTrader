/**
 * @name Build-time global referenced outside build-info.ts
 * @description __APP_VERSION__, __GIT_COMMIT__ and __BUILD_TIME__ are only referenced in the
 *              build-info.ts modules; on the server each read must sit behind a typeof guard,
 *              because `tsx watch` has no define step and a bare reference throws.
 * @kind problem
 * @problem.severity warning
 * @precision high
 * @id markettrader/build-global-confinement
 * @tags correctness
 *       maintainability
 */

import javascript
import lib.MarketTrader

string buildGlobal() { result = ["__APP_VERSION__", "__GIT_COMMIT__", "__BUILD_TIME__"] }

predicate isBuildInfoFile(File f) {
  MarketTrader::serverFile(f, "build-info.ts") or
  MarketTrader::frontendFile(f, "build-info.ts")
}

/** `typeof <name> === '<not undefined>'` or `typeof <name> !== 'undefined'`. */
predicate isDefinedTest(EqualityTest t, string name) {
  exists(TypeofExpr tof, string tag |
    tof = t.getAnOperand().getUnderlyingValue() and
    tof.getOperand().getUnderlyingValue().(VarAccess).getName() = name and
    tag = t.getAnOperand().getStringValue()
  |
    t.getPolarity() = true and tag != "undefined"
    or
    t.getPolarity() = false and tag = "undefined"
  )
}

/** `typeof <name> === 'undefined'` or `typeof <name> !== '<not undefined>'`. */
predicate isUndefinedTest(EqualityTest t, string name) {
  exists(TypeofExpr tof, string tag |
    tof = t.getAnOperand().getUnderlyingValue() and
    tof.getOperand().getUnderlyingValue().(VarAccess).getName() = name and
    tag = t.getAnOperand().getStringValue()
  |
    t.getPolarity() = true and tag = "undefined"
    or
    t.getPolarity() = false and tag != "undefined"
  )
}

/** Holds if `cond` being truthy implies `name` is defined: a defined-test, possibly inside `&&`. */
predicate impliesDefined(Expr cond, string name) {
  isDefinedTest(cond.getUnderlyingValue(), name)
  or
  impliesDefined(cond.getUnderlyingValue().(LogAndExpr).getAnOperand(), name)
  or
  impliesUndefined(cond.getUnderlyingValue().(LogNotExpr).getOperand(), name)
}

/** Holds if `cond` being falsy implies `name` is defined: an undefined-test, possibly inside `||`. */
predicate impliesUndefined(Expr cond, string name) {
  isUndefinedTest(cond.getUnderlyingValue(), name)
  or
  impliesUndefined(cond.getUnderlyingValue().(LogOrExpr).getAnOperand(), name)
  or
  impliesDefined(cond.getUnderlyingValue().(LogNotExpr).getOperand(), name)
}

/** Holds if `s` always leaves the enclosing block (ends in `return` or `throw`). */
predicate exitsAbruptly(Stmt s) {
  s instanceof ReturnStmt
  or
  s instanceof ThrowStmt
  or
  exists(BlockStmt b | b = s | exitsAbruptly(b.getStmt(b.getNumStmt() - 1)))
}

/** Holds if `va` is the operand of `typeof`, or only evaluated when such a test succeeded. */
predicate isGuarded(VarAccess va) {
  exists(TypeofExpr tof | tof.getOperand().getUnderlyingValue() = va)
  or
  exists(ConditionalExpr c |
    impliesDefined(c.getCondition(), va.getName()) and
    c.getConsequent().getAChildExpr*() = va
    or
    impliesUndefined(c.getCondition(), va.getName()) and
    c.getAlternate().getAChildExpr*() = va
  )
  or
  exists(IfStmt s |
    impliesDefined(s.getCondition(), va.getName()) and
    s.getThen().getAChild*() = va
    or
    impliesUndefined(s.getCondition(), va.getName()) and
    s.getElse().getAChild*() = va
  )
  or
  // Early exit: `if (typeof X === 'undefined') return ...;` guards the rest of the block.
  exists(IfStmt s, BlockStmt b, int i, int j |
    impliesUndefined(s.getCondition(), va.getName()) and
    exitsAbruptly(s.getThen()) and
    b.getStmt(i) = s and
    j > i and
    b.getStmt(j).getAChild*() = va
  )
  or
  exists(LogAndExpr conj |
    impliesDefined(conj.getLeftOperand(), va.getName()) and
    conj.getRightOperand().getAChildExpr*() = va
  )
  or
  exists(LogOrExpr disj |
    impliesUndefined(disj.getLeftOperand(), va.getName()) and
    disj.getRightOperand().getAChildExpr*() = va
  )
}

from VarRef ref, string name, string msg
where
  name = ref.getName() and
  name = buildGlobal() and
  MarketTrader::isAppSrc(ref.getFile()) and
  (
    not isBuildInfoFile(ref.getFile()) and
    msg = name + " is only referenced in build-info.ts; import `buildInfo` from there instead."
    or
    MarketTrader::serverFile(ref.getFile(), "build-info.ts") and
    ref instanceof VarAccess and
    not isGuarded(ref) and
    msg =
      name +
        " read without a typeof guard; `tsx watch` has no define step, so write `typeof " + name +
        " === 'string' ? " + name + " : <fallback>`."
  )
select ref, msg
