/**
 * @name posthog-js imported outside the facade
 * @description posthog-js is only referenced by frontend lib/posthog.ts, which lazy-loads it
 *              with a dynamic import(); any other import (even type-only) couples code to
 *              the SDK, and a static value import pulls ~100 kB into the entry bundle.
 * @kind problem
 * @problem.severity warning
 * @precision high
 * @id markettrader/posthog-js-import-confinement
 * @tags maintainability
 */

import javascript
import lib.MarketTrader
import restrictions.RestrictionsLib

from Restrictions::ModuleRef ref, string msg
where
  MarketTrader::isAppSrc(ref.getFile()) and
  Restrictions::isPackage(ref.getPath(), "posthog-js") and
  (
    not MarketTrader::frontendFile(ref.getFile(), "lib/posthog.ts") and
    msg = "posthog-js is only imported by lib/posthog.ts; import from '@/lib/posthog' instead."
    or
    // Inside the facade itself, only a type import or the lazy import() keeps the SDK out of the entry chunk.
    MarketTrader::frontendFile(ref.getFile(), "lib/posthog.ts") and
    not ref.isDynamic() and
    not ref.isTypeOnly() and
    msg =
      "Static value import of posthog-js puts the SDK in the entry bundle; load it with import('posthog-js') and keep static imports type-only."
  )
select ref, msg
