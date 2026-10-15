/**
 * @name posthog-node used outside its owning modules
 * @description posthog-node is only imported by observability/posthog.ts; business events are
 *              captured only by the EventBus subscriber in observability/analytics.ts and
 *              exceptions only by observability/error-capture.ts.
 * @kind problem
 * @problem.severity warning
 * @precision medium
 * @id markettrader/posthog-node-confinement
 * @tags maintainability
 */

import javascript
import lib.MarketTrader
import restrictions.RestrictionsLib

from AstNode site, string msg
where
  MarketTrader::isAppSrc(site.getFile()) and
  (
    exists(Restrictions::ModuleRef ref | ref = site |
      Restrictions::isPackage(ref.getPath(), "posthog-node") and
      not MarketTrader::serverFile(ref.getFile(), "observability/posthog.ts")
    ) and
    msg = "posthog-node is only imported by observability/posthog.ts; use getPostHog() / AnalyticsClient."
    or
    // Name-based: in server source these method names are only ever PostHog client calls.
    exists(DataFlow::MethodCallNode c | c.asExpr() = site |
      MarketTrader::isServerSrc(c.getFile()) and
      c.getMethodName() = "capture" and
      not MarketTrader::serverFile(c.getFile(), "observability/analytics.ts")
    ) and
    msg =
      "PostHog capture() outside observability/analytics.ts; emit a domain event on the EventBus and capture it in the analytics subscriber."
    or
    exists(DataFlow::MethodCallNode c | c.asExpr() = site |
      MarketTrader::isServerSrc(c.getFile()) and
      c.getMethodName() = "captureException" and
      not MarketTrader::serverFile(c.getFile(), "observability/error-capture.ts")
    ) and
    msg =
      "PostHog captureException() outside observability/error-capture.ts; let errors reach the error-capture hook instead."
  )
select site, msg
