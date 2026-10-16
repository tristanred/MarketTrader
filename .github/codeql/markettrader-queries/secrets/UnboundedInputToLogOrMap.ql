/**
 * @name Length-unbounded request string reaches a log or a long-lived Map key
 * @description A request-body string whose Zod schema has no length bound (.max/.length/a fixed format) must not be logged or used as a key in a process-lifetime Map: each request can then write up to the body limit into journald/OTLP or pin it in memory.
 * @kind problem
 * @problem.severity warning
 * @id markettrader/unbounded-input-to-log-or-map
 * @tags security
 *       external/cwe/cwe-400
 *       external/cwe/cwe-770
 * @precision high
 */

import javascript
import lib.MarketTrader
import secrets.SecretsLib

/** Holds if `n` is a Zod-ish expression we analyse: a route body schema or a `z.object` shape property. */
predicate zodTop(DataFlow::Node n) {
  n = routeBodySchemaRef(_)
  or
  exists(DataFlow::MethodCallNode obj |
    obj.getMethodName() = "object" and
    n = obj.getArgument(0).getALocalSource().(DataFlow::ObjectLiteralNode).getAPropertyWrite().getRhs()
  )
}

/** Holds if `c` is `top` or a call further down `top`'s method chain (`z.string().min(1)` -> `z.string()`). */
predicate inChain(DataFlow::Node top, DataFlow::Node c) {
  zodTop(top) and c = top
  or
  exists(DataFlow::Node mid | inChain(top, mid) |
    c = mid.(DataFlow::MethodCallNode).getReceiver()
    or
    // a named schema: `body: loginSchema`, defined at module level
    exists(Variable v |
      mid.asExpr() = v.getAnAccess() and c.asExpr() = v.getAnAssignedExpr()
    )
  )
}

/** The `schema.body` expression of route `r`, before any variable resolution. */
DataFlow::Node routeBodySchemaRef(MarketTrader::RouteRegistration r) {
  result =
    r.getOptions()
        .getAPropertyWrite("schema")
        .getRhs()
        .getALocalSource()
        .(DataFlow::ObjectLiteralNode)
        .getAPropertyWrite("body")
        .getRhs()
}

/**
 * A Zod method or format that caps a string's length: `.max`, `.length`, or a
 * fixed-shape format. `.regex(...)` is deliberately not counted — whether a
 * pattern bounds the length (anchored, no `*`/`+`) is not checked.
 */
string boundingMethod() {
  result =
    [
      "max", "length", "uuid", "cuid", "cuid2", "ulid", "nanoid", "datetime", "date", "time", "ip",
      "ipv4", "ipv6"
    ]
}

/** Holds if `shapeProp` is a `z.string()` chain with no length-bounding call in it. */
predicate unboundedZodString(DataFlow::Node shapeProp) {
  exists(DataFlow::MethodCallNode root |
    inChain(shapeProp, root) and
    root.getMethodName() = "string" and
    root.getReceiver().asExpr().(VarAccess).getName() = "z"
  ) and
  not exists(DataFlow::MethodCallNode b |
    inChain(shapeProp, b) and b.getMethodName() = boundingMethod()
  )
}

/** Holds if route `r`'s body schema declares field `f` as an unbounded string at `def`. */
predicate unboundedBodyField(MarketTrader::RouteRegistration r, string f, DataFlow::Node def) {
  exists(DataFlow::MethodCallNode obj |
    inChain(routeBodySchemaRef(r), obj) and
    obj.getMethodName() = "object" and
    def = obj.getArgument(0).getALocalSource().(DataFlow::ObjectLiteralNode).getAPropertyWrite(f).getRhs() and
    unboundedZodString(def)
  )
}

/** A body-field read in a route handler whose schema leaves that field unbounded. */
class UnboundedFieldSource extends DataFlow::Node instanceof SecretsLib::BodyFieldRead {
  DataFlow::Node def;

  UnboundedFieldSource() {
    exists(MarketTrader::RouteRegistration r |
      // the handler itself or a callback nested in it (e.g. a `db.transaction` body)
      this.getContainer().getEnclosingContainer*() = r.getHandler().getFunction() and
      unboundedBodyField(r, super.getField(), def)
    )
  }

  string getField() { result = super.getField() }

  /** The `z.string()...` definition of this field in the schema. */
  DataFlow::Node getDefinition() { result = def }
}

/** A class with a field initialised to `new Map(...)`: a process-lifetime keyed store. */
class MapOwningClass extends ClassDefinition {
  MapOwningClass() {
    exists(FieldDeclaration fd | fd = this.getAField() |
      fd.getInit().(NewExpr).getCalleeName() = "Map"
    )
  }
}

/**
 * Holds if `m` is a `new Map()` that outlives a request: created at module level,
 * or in a route factory / plugin closure that encloses a route handler (e.g.
 * `tradingRoutes(...) { const throttle = new Map(); return async (app) => { app.post(...) } }`).
 * A Map created inside a handler, or in a helper called per request, is excluded.
 */
predicate longLivedMap(DataFlow::NewNode m) {
  m.getCalleeName() = "Map" and
  (
    m.getContainer() instanceof TopLevel
    or
    exists(MarketTrader::RouteHandler h |
      h.getFunction().getEnclosingContainer+() = m.getContainer()
    )
  )
}

class UnboundedSink extends DataFlow::Node {
  string what;

  UnboundedSink() {
    MarketTrader::isServerSrc(this.getFile()) and
    (
      exists(MarketTrader::LogSink l | SecretsLib::withinLiteral(l, this)) and what = "a log call"
      or
      // Calls into a Map-owning class from outside it. Its internal
      // `this.entries.get(key)` operations are reached through these, so
      // reporting them too would only duplicate each finding.
      exists(DataFlow::MethodCallNode c, MapOwningClass cls |
        c.getACallee() = cls.getAMethod().getBody() and
        not c.getContainer().(Function).getEnclosingContainer*() = cls.getAMethod().getBody() and
        this = c.getAnArgument()
      ) and
      what = "a method of a Map-backed store"
      or
      // Key operations on a long-lived `new Map()`.
      exists(DataFlow::MethodCallNode c, DataFlow::NewNode m |
        c.getMethodName() = ["get", "set", "has", "delete"] and
        m = c.getReceiver().getALocalSource() and
        longLivedMap(m) and
        this = c.getArgument(0)
      ) and
      what = "a long-lived Map key"
    )
  }

  string getWhat() { result = what }
}

module UnboundedConfig implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node n) { n instanceof UnboundedFieldSource }

  predicate isSink(DataFlow::Node n) { n instanceof UnboundedSink }

  predicate isAdditionalFlowStep(DataFlow::Node pred, DataFlow::Node succ) {
    SecretsLib::capturedVariableStep(pred, succ)
  }
}

module UnboundedFlow = TaintTracking::Global<UnboundedConfig>;

from UnboundedFieldSource src, UnboundedSink sink
where UnboundedFlow::flow(src, sink)
select sink,
  "Body field '" + src.getField() + "' has no length bound in its $@ but reaches " + sink.getWhat() +
    "; add .max(n) to the schema field.", src.getDefinition(), "Zod schema"
