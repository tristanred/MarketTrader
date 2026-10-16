/**
 * @name Build-time VITE_ variable read outside its owning module
 * @description VITE_POSTHOG_* is read only by lib/posthogConfig.ts and VITE_OTEL_* only by
 *              observability/otel.ts, so each integration's configuration has exactly one
 *              source and its enabled flag cannot drift.
 * @kind problem
 * @problem.severity warning
 * @precision high
 * @id markettrader/vite-env-read-confinement
 * @tags maintainability
 */

import javascript
import lib.MarketTrader

/** A read of `import.meta.env`. */
class ImportMetaEnv extends DataFlow::Node instanceof DataFlow::PropRead {
  ImportMetaEnv() {
    super.getPropertyName() = "env" and
    super.getBase().asExpr().getUnderlyingValue() instanceof ImportMetaExpr
  }
}

/** Holds if `name` is owned by the frontend file `owner` (path under packages/frontend/src/). */
bindingset[name]
predicate ownedBy(string name, string owner) {
  name.matches("VITE\\_POSTHOG\\_%") and owner = "lib/posthogConfig.ts"
  or
  name.matches("VITE\\_OTEL\\_%") and owner = "observability/otel.ts"
}

from DataFlow::PropRead read, string name, string owner
where
  read.getBase().getALocalSource() instanceof ImportMetaEnv and
  name = read.getPropertyName() and
  ownedBy(name, owner) and
  MarketTrader::isAppSrc(read.getFile()) and
  not MarketTrader::frontendFile(read.getFile(), owner)
select read,
  "import.meta.env." + name + " is only read in packages/frontend/src/" + owner +
    "; import the value from that module."
