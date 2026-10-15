/**
 * @name Dangerous DOM API in the frontend
 * @description The SPA renders through React only: no dangerouslySetInnerHTML, eval,
 *              new Function, innerHTML/outerHTML writes, insertAdjacentHTML or document.write,
 *              and every target="_blank" link carries rel="noopener" (or noreferrer).
 * @kind problem
 * @problem.severity error
 * @security-severity 6.1
 * @precision high
 * @id markettrader/frontend-dangerous-dom-api
 * @tags security
 *       external/cwe/cwe-79
 *       external/cwe/cwe-1022
 */

import javascript
import lib.MarketTrader

/** Holds if `e` sets `target="_blank"` without a constant rel that contains noopener/noreferrer. */
predicate unsafeBlankTarget(JsxElement e) {
  exists(JsxAttribute t | t = e.getAttributeByName("target") |
    t.getStringValue() = "_blank"
  ) and
  // A spread may supply rel, so only judge elements whose attributes are all visible.
  not exists(JsxAttribute a | a = e.getAnAttribute() | not exists(a.getName())) and
  not exists(JsxAttribute r | r = e.getAttributeByName("rel") |
    r.getStringValue().regexpMatch("(?i).*\\bno(opener|referrer)\\b.*")
    or
    // A dynamic rel is not something this query can judge.
    not exists(r.getStringValue())
  )
}

from Locatable site, string msg
where
  MarketTrader::isFrontendSrc(site.getFile()) and
  (
    site.(JsxAttribute).getName() = "dangerouslySetInnerHTML" and
    msg = "dangerouslySetInnerHTML injects raw HTML; render the content as React children."
    or
    site = DataFlow::globalVarRef("eval").getACall().asExpr() and
    msg = "eval() executes a string as code; it is never needed in the SPA."
    or
    site = DataFlow::globalVarRef("Function").getAnInvocation().asExpr() and
    msg = "The Function constructor executes a string as code; it is never needed in the SPA."
    or
    // Only real assignments `el.innerHTML = ...`; an object literal `{ innerHTML: ... }` writes no DOM.
    exists(Assignment a | a.getLhs().(PropAccess).getPropertyName() = ["innerHTML", "outerHTML"] |
      site = a.getLhs()
    ) and
    msg = "Assigning innerHTML/outerHTML injects raw HTML; render through React or set textContent."
    or
    exists(DataFlow::MethodCallNode c | c.getMethodName() = "insertAdjacentHTML" |
      site = c.asExpr()
    ) and
    msg = "insertAdjacentHTML injects raw HTML; render through React."
    or
    site = DataFlow::globalVarRef("document").getAMemberCall(["write", "writeln"]).asExpr() and
    msg = "document.write injects raw HTML; render through React."
    or
    unsafeBlankTarget(site) and
    msg = "target=\"_blank\" without rel=\"noopener noreferrer\" lets the opened page reach window.opener."
  )
select site, msg
