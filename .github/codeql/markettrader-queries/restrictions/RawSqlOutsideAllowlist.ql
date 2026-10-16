/**
 * @name Raw SQL outside the PRAGMA allowlist
 * @description All database access goes through the Drizzle query builder; raw SQL (sql.raw,
 *              db.run/execute/all/get/values, the driver client, $client) is only allowed for
 *              the connection PRAGMAs in packages/server/src/db/index.ts.
 * @kind problem
 * @problem.severity warning
 * @precision medium
 * @id markettrader/raw-sql-outside-allowlist
 * @tags correctness
 *       maintainability
 */

import javascript
import lib.MarketTrader

/** The Drizzle database or transaction object, by the names the codebase gives it. */
predicate isDbObject(DataFlow::Node n) {
  exists(Expr e | e = n.asExpr().getUnderlyingReference() |
    e.(VarAccess).getName() = ["db", "tx", "trx", "database"]
    or
    e.(PropAccess).getPropertyName() = ["db", "tx", "trx", "database"]
  )
}

/** A raw driver client: a libsql `createClient(...)` / postgres-js `postgres(...)` result, or a variable named `client`. */
predicate isDriverClient(DataFlow::Node n) {
  n.getALocalSource() = DataFlow::moduleMember("@libsql/client", "createClient").getACall()
  or
  n.getALocalSource() = DataFlow::moduleImport("postgres").getACall()
  or
  n.asExpr().getUnderlyingReference().(VarAccess).getName() = ["client", "libsqlClient", "pgClient"]
  or
  n.asExpr().getUnderlyingReference().(PropAccess).getPropertyName() = "$client"
}

/** Holds if `e` is a string literal or template whose text starts with `PRAGMA `. */
predicate isPragma(Expr e) {
  e.getStringValue().regexpMatch("(?is)\\s*PRAGMA\\s.*")
  or
  e.(TemplateLiteral).getElement(0).(TemplateElement).getValue().regexpMatch("(?is)\\s*PRAGMA\\s.*")
}

/** The connection-setup PRAGMAs in db/index.ts. */
predicate isAllowlisted(DataFlow::MethodCallNode c) {
  MarketTrader::serverFile(c.getFile(), "db/index.ts") and
  c.getMethodName() = "execute" and
  isPragma(c.getArgument(0).asExpr())
}

from DataFlow::Node site, string what
where
  MarketTrader::isAppSrc(site.getFile()) and
  (
    exists(DataFlow::MethodCallNode c | c = site |
      c = DataFlow::moduleMember("drizzle-orm", "sql").getAMemberCall("raw")
      or
      c.getMethodName() = "raw" and
      c.getReceiver().asExpr().getUnderlyingReference().(VarAccess).getName() = "sql"
    ) and
    what = "sql.raw()"
    or
    exists(DataFlow::MethodCallNode c | c = site |
      c.getMethodName() = ["run", "execute", "all", "get", "values"] and
      isDbObject(c.getReceiver()) and
      what = "db." + c.getMethodName() + "()"
    )
    or
    exists(DataFlow::MethodCallNode c | c = site |
      c.getMethodName() = ["execute", "executeMultiple", "batch", "unsafe", "migrate"] and
      isDriverClient(c.getReceiver()) and
      not isAllowlisted(c) and
      what = "driver client ." + c.getMethodName() + "()"
    )
    or
    // postgres-js runs a query when its client is used as a template tag: client`SELECT ...`.
    exists(TaggedTemplateExpr t | site.asExpr() = t |
      isDriverClient(DataFlow::valueNode(t.getTag())) and
      what = "a driver-client tagged template"
    )
    or
    site.(DataFlow::PropRead).getPropertyName() = "$client" and
    what = "$client"
  )
select site,
  "Raw SQL via " + what +
    "; use the Drizzle query builder (only the PRAGMAs in db/index.ts may bypass it)."
