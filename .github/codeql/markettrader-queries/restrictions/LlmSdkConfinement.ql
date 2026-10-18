/**
 * @name LLM SDK imported outside providers/llm/
 * @description LLM client libraries (@openrouter/sdk, openai, @anthropic-ai/sdk) are only imported
 *              under packages/server/src/providers/llm/, so every call goes through LlmClient and
 *              its timeout, no-retry policy, error classification, span and metrics.
 * @kind problem
 * @problem.severity warning
 * @precision high
 * @id markettrader/llm-sdk-confinement
 * @tags maintainability
 *       correctness
 */

import javascript
import lib.MarketTrader
import restrictions.RestrictionsLib

bindingset[p]
predicate isLlmSdkPackage(string p) {
  Restrictions::isPackage(p, "@openrouter/sdk") or
  Restrictions::isPackage(p, "openai") or
  Restrictions::isPackage(p, "@anthropic-ai/sdk")
}

from Restrictions::ModuleRef ref
where
  isLlmSdkPackage(ref.getPath()) and
  MarketTrader::isAppSrc(ref.getFile()) and
  not MarketTrader::serverFile(ref.getFile(), "providers/llm/%")
select ref,
  "LLM SDK '" + ref.getPath() +
    "' imported outside packages/server/src/providers/llm/; call the model through LlmClient."
