/**
 * @name Outbound HTTP from server code outside providers/ and observability/
 * @description Server code only makes raw outbound HTTP calls from providers/ (market data) and
 *              observability/ (telemetry transports); anything else should go through a
 *              StockProvider so it shares the cache and rate-limit protection.
 * @kind problem
 * @problem.severity warning
 * @precision high
 * @id markettrader/server-outbound-http-confinement
 * @tags maintainability
 */

import javascript
import lib.MarketTrader
import restrictions.RestrictionsLib

predicate allowedHttpFile(File f) {
  MarketTrader::serverFile(f, "providers/%") or
  MarketTrader::serverFile(f, "observability/%")
}

from AstNode site, string what
where
  MarketTrader::isServerSrc(site.getFile()) and
  not allowedHttpFile(site.getFile()) and
  (
    site = DataFlow::globalVarRef("fetch").getACall().asExpr() and what = "fetch()"
    or
    // Only the client calls: importing node:http to create a server is fine.
    exists(string m |
      site =
        DataFlow::moduleMember(["http", "https", "node:http", "node:https"], m).getACall().asExpr() and
      m = ["request", "get"] and
      what = "node:http(s)." + m + "()"
    )
    or
    exists(Restrictions::ModuleRef ref | ref = site |
      Restrictions::isPackage(ref.getPath(), ["undici", "node-fetch", "axios", "got"]) and
      what = "the '" + ref.getPath() + "' HTTP client"
    )
  )
select site,
  "Outbound HTTP via " + what +
    " outside providers/ and observability/; route external calls through a StockProvider."
