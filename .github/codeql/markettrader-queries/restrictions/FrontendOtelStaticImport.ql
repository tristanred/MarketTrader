/**
 * @name Browser OTel module imported statically
 * @description The frontend observability/otel module is only loaded with a dynamic import()
 *              after first render, so the OTel browser SDK stays out of the entry bundle.
 * @kind problem
 * @problem.severity warning
 * @precision high
 * @id markettrader/frontend-otel-static-import
 * @tags maintainability
 */

import javascript
import lib.MarketTrader
import restrictions.RestrictionsLib

/** Holds if `ref` names the frontend's `observability/otel` module. */
predicate refersToBrowserOtel(Restrictions::ModuleRef ref) {
  MarketTrader::frontendFile(resolvedFile(ref), "observability/otel.ts")
  or
  // Path aliases such as `@/` may not resolve in the database; fall back to the specifier.
  not exists(resolvedFile(ref)) and
  ref.getPath().regexpMatch("(\\./|\\.\\./|@/)(\\.\\./)*observability/otel(\\.[jt]s)?")
}

File resolvedFile(Restrictions::ModuleRef ref) {
  result = ref.(Import).getImportedFile()
  or
  result = ref.(ReExportDeclaration).getReExportedModule().getFile()
}

from Restrictions::ModuleRef ref
where
  MarketTrader::isFrontendSrc(ref.getFile()) and
  refersToBrowserOtel(ref) and
  not ref.isDynamic() and
  not ref.isTypeOnly()
select ref,
  "observability/otel is imported statically, which puts the OTel browser SDK in the entry bundle; load it with import('./observability/otel') after render."
