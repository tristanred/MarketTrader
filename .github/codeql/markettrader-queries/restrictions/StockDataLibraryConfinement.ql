/**
 * @name Market-data SDK imported outside providers/
 * @description Stock data libraries (yahoo-finance2, Alpaca, Polygon) are only imported under
 *              packages/server/src/providers/, so every price goes through the StockProvider
 *              interface and its cache, rate-limit and stale-trade handling.
 * @kind problem
 * @problem.severity warning
 * @precision high
 * @id markettrader/stock-data-library-confinement
 * @tags maintainability
 *       correctness
 */

import javascript
import lib.MarketTrader
import restrictions.RestrictionsLib

bindingset[p]
predicate isStockDataPackage(string p) {
  Restrictions::isPackage(p, "yahoo-finance2") or
  Restrictions::isPackage(p, "yahoo-finance") or
  p.matches("@alpacahq/%") or
  p.matches("alpaca%") or
  p.matches("@polygon.io/%") or
  p.matches("polygon%")
}

from Restrictions::ModuleRef ref
where
  isStockDataPackage(ref.getPath()) and
  MarketTrader::isAppSrc(ref.getFile()) and
  not MarketTrader::serverFile(ref.getFile(), "providers/%")
select ref,
  "Market-data SDK '" + ref.getPath() +
    "' imported outside packages/server/src/providers/; fetch prices through the StockProvider interface."
