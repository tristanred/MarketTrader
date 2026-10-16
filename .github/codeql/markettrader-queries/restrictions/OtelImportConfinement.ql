/**
 * @name OpenTelemetry package imported outside the observability layer
 * @description The OTel SDK, exporters, instrumentations, context managers, resources and semantic conventions are
 *              only imported by observability/otel.ts, @fastify/otel only by plugins/otel.ts,
 *              and @opentelemetry/api outside the observability layer may only bring in
 *              SpanStatusCode or types, so instruments stay lazily created in telemetry.ts.
 * @kind problem
 * @problem.severity warning
 * @precision high
 * @id markettrader/otel-import-confinement
 * @tags maintainability
 */

import javascript
import lib.MarketTrader
import restrictions.RestrictionsLib

/**
 * Every `@opentelemetry/*` package except the `@opentelemetry/api*` facades: SDKs, exporters,
 * instrumentations, context managers, propagators, core, resources, semantic conventions.
 */
bindingset[p]
predicate isOtelSdkPackage(string p) {
  p.matches("@opentelemetry/%") and not p.matches("@opentelemetry/api%")
}

predicate isOtelBootstrapFile(File f) {
  MarketTrader::serverFile(f, "observability/otel.ts") or
  MarketTrader::frontendFile(f, "observability/otel.ts")
}

/** The observability layer, where the full @opentelemetry/api surface is allowed. */
predicate isObservabilityLayer(File f) {
  MarketTrader::serverFile(f, "observability/%") or
  MarketTrader::serverFile(f, "plugins/otel.ts") or
  MarketTrader::frontendFile(f, "observability/%")
}

/** Holds if `d` imports from `@opentelemetry/api*` something other than `SpanStatusCode` or a type. */
predicate importsApiValueOtherThanStatusCode(ImportDeclaration d, string name) {
  exists(ImportSpecifier s | s = d.getASpecifier() |
    not s.isTypeOnly() and
    (
      name = s.getImportedName() and not name = "SpanStatusCode"
      or
      // `import * as api` / default import: the whole namespace.
      not exists(s.getImportedName()) and name = "*"
    )
  )
}

from Restrictions::ModuleRef ref, string msg
where
  MarketTrader::isAppSrc(ref.getFile()) and
  (
    isOtelSdkPackage(ref.getPath()) and
    not isOtelBootstrapFile(ref.getFile()) and
    msg =
      "'" + ref.getPath() +
        "' is only imported by observability/otel.ts; SDK setup stays in the one bootstrap module."
    or
    Restrictions::isPackage(ref.getPath(), "@fastify/otel") and
    not MarketTrader::serverFile(ref.getFile(), "plugins/otel.ts") and
    msg = "@fastify/otel is only imported by plugins/otel.ts, which registers it before every route."
    or
    ref.getPath().matches("@opentelemetry/api%") and
    not isObservabilityLayer(ref.getFile()) and
    not ref.isTypeOnly() and
    (
      exists(string name |
        importsApiValueOtherThanStatusCode(ref, name) and
        msg =
          "Imports '" + name + "' from " + ref.getPath() +
            " outside observability/; only SpanStatusCode may be imported here — add a helper in observability/telemetry.ts."
      )
      or
      not ref instanceof ImportDeclaration and
      msg =
        ref.getPath() +
          " loaded outside observability/; only `import { SpanStatusCode }` is allowed here — add a helper in observability/telemetry.ts."
    )
  )
select ref, msg
