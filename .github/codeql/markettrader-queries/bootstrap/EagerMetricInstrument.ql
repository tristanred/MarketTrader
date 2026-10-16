/**
 * @name Metric meter or instrument created at module load
 * @description metrics.getMeter and Meter.create* must run lazily (inside a function called after initTelemetry), because the metrics API has no proxy and a meter bound at import time stays a no-op forever.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/eager-metric-instrument
 * @tags correctness
 *       maintainability
 * @precision high
 */

import javascript
import lib.MarketTrader

/** A `metrics.getMeter(...)` call on the `@opentelemetry/api` metrics singleton. */
class GetMeterCall extends DataFlow::CallNode {
  GetMeterCall() {
    this =
      API::moduleImport("@opentelemetry/api").getMember("metrics").getMember("getMeter").getACall()
  }
}

/** A `meter.create<Instrument>(...)` call on a meter obtained from {@link GetMeterCall}. */
class CreateInstrumentCall extends DataFlow::MethodCallNode {
  CreateInstrumentCall() {
    this.getMethodName() =
      [
        "createCounter", "createHistogram", "createUpDownCounter", "createGauge",
        "createObservableCounter", "createObservableGauge", "createObservableUpDownCounter"
      ] and
    this.getReceiver().getALocalSource() instanceof GetMeterCall
  }
}

/** Holds if code in `c` runs when the module is loaded: the top level, or an IIFE evaluated there. */
predicate runsAtLoad(StmtContainer c) {
  c instanceof TopLevel
  or
  exists(ImmediatelyInvokedFunctionExpr iife | iife = c | runsAtLoad(iife.getEnclosingContainer()))
}

/** Holds if calling `f` creates a meter or instrument, directly or through its callees. */
predicate createsInstruments(Function f, DataFlow::CallNode instrument) {
  (instrument instanceof GetMeterCall or instrument instanceof CreateInstrumentCall) and
  instrument.getContainer() = f
  or
  exists(DataFlow::CallNode call, Function g |
    call.getContainer() = f and
    g = call.getACallee() and
    g != f and
    createsInstruments(g, instrument)
  )
}

/** Holds if `v` is the lazy `meters` proxy from `observability/telemetry.ts`, imported or local. */
predicate isMetersProxy(Variable v) {
  v.getName() = "meters" and
  (
    exists(ImportSpecifier spec, ImportDeclaration imp |
      spec = imp.getASpecifier() and
      (
        MarketTrader::serverFile(imp.getImportedModule().getFile(), "observability/telemetry.ts")
        or
        imp.getImportedPathString().regexpMatch(".*/telemetry(\\.js)?")
      ) and
      spec.getImportedName() = "meters" and
      spec.getLocal().getVariable() = v
    )
    or
    exists(VarDecl d | d.getVariable() = v |
      MarketTrader::serverFile(d.getFile(), "observability/telemetry.ts")
    )
  )
}

/**
 * A read of an instrument off the `meters` proxy. The proxy's `get` trap builds
 * every instrument, which the call graph cannot see through.
 */
class MetersProxyRead extends DataFlow::Node instanceof DataFlow::PropRead {
  MetersProxyRead() {
    exists(DataFlow::Node base | base = super.getBase() |
      isMetersProxy(base.asExpr().(VarAccess).getVariable())
      or
      // `const { x } = meters`: the base is the pattern, fed by the `meters` access.
      isMetersProxy(base.getAPredecessor().asExpr().(VarAccess).getVariable())
    )
  }
}

from DataFlow::Node site, DataFlow::Node instrument, string msg
where
  MarketTrader::isServerSrc(site.getFile()) and
  runsAtLoad(site.getContainer()) and
  (
    site = instrument and
    (instrument instanceof GetMeterCall or instrument instanceof CreateInstrumentCall) and
    msg = "Meter/instrument $@ is created at module load; build it lazily on first use (see `meters` in observability/telemetry.ts)."
    or
    // An IIFE's body is already treated as load-time code by the first branch.
    not site.(DataFlow::CallNode).getACallee() instanceof ImmediatelyInvokedFunctionExpr and
    createsInstruments(site.(DataFlow::CallNode).getACallee(), instrument) and
    msg = "This module-load call creates meter/instrument $@; defer it to first use (see `meters` in observability/telemetry.ts)."
    or
    site instanceof MetersProxyRead and
    instrument = site and
    msg = "Reading $@ at module load triggers the `meters` proxy and builds every instrument against the no-op meter; read it inside the function that records."
  )
select site, msg, instrument, instrument.toString()
