/**
 * @name Route input not validated by a schema
 * @description Input is validated at route entry: a route with path parameters needs `schema.params`, a handler reading `request.body` needs `schema.body`, and a handler reading `request.query` needs `schema.querystring` (WebSocket upgrade routes included).
 * @kind problem
 * @problem.severity warning
 * @id markettrader/route-input-without-schema
 * @tags correctness
 *       security
 *       external/cwe/cwe-20
 * @precision high
 */

import javascript
import lib.MarketTrader
import WsAuthLib

/** The `schema` object literal of `r`, when it resolves to one. */
DataFlow::ObjectLiteralNode schemaOf(MarketTrader::RouteRegistration r) {
  result = WsAuth::optionsOf(r).getAPropertyWrite("schema").getRhs().getALocalSource()
}

/**
 * Holds if `r`'s schema declares `key`. A schema that does not resolve to an
 * object literal is given the benefit of the doubt.
 */
predicate declaresSchemaKey(MarketTrader::RouteRegistration r, string key) {
  key = ["params", "body", "querystring"] and
  (
    exists(schemaOf(r).getAPropertyWrite(key))
    or
    exists(WsAuth::optionsOf(r).getAPropertyWrite("schema")) and not exists(schemaOf(r))
  )
}

/**
 * Holds if `r`'s handler (or a closure inside it) reads `request.<kind>`,
 * directly or by destructuring (`const { body } = request`).
 */
predicate readsInput(MarketTrader::RouteRegistration r, string kind) {
  exists(DataFlow::Node i |
    i.(MarketTrader::RequestInput).getKind() = kind
    or
    i.(WsAuth::RequestPropRead).getPropertyName() = kind
  |
    WsAuth::nestedIn(i.getContainer(), r.getHandler().getFunction())
  )
}

/** The schema key `r` is missing, with a description of the input that needs it. */
predicate missingKey(MarketTrader::RouteRegistration r, string key, string why) {
  key = "params" and
  r.getPath().matches("%:%") and
  not declaresSchemaKey(r, key) and
  why = "its path has parameters"
  or
  // Any method, not only POST/PUT/PATCH: a DELETE that reads a body needs it validated too.
  key = "body" and
  readsInput(r, "body") and
  not declaresSchemaKey(r, key) and
  why = "its handler reads request.body"
  or
  key = "querystring" and
  readsInput(r, "query") and
  not declaresSchemaKey(r, key) and
  why = "its handler reads request.query"
}

from MarketTrader::RouteRegistration r, string key, string why
where missingKey(r, key, why)
select r,
  "Route " + r.getMethodName().toUpperCase() + " " + r.getPath() + " has no `schema." + key +
    "` although " + why + "; validate it at route entry with a Zod schema."
