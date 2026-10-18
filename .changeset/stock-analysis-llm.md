---
'@markettrader/frontend': minor
'@markettrader/server': minor
'@markettrader/shared': minor
---

"Analyze this": an **Analyze** button on the quote view asks an LLM (through OpenRouter, server-side only) for a BUY / HOLD / SELL verdict on a stock, with a confidence, a short summary, and bull and bear points, shown on a SELL · HOLD · BUY rating rail. One analysis per symbol is cached and shared by every player for a day (`ANALYSIS_CACHE_TTL_MS`), and viewing a cached one is free. Each player may generate `LIMIT_STOCK_ANALYSES_PER_DAY` fresh analyses (default 10, reduced on probation). A global `ANALYSIS_MAX_GENERATIONS_PER_DAY` ceiling (default 50) binds everyone, admins included. Slow models answer in the background: the request returns 202 after `ANALYSIS_RESPONSE_WAIT_MS` and the button polls until the result is ready. Account-level OpenRouter failures (bad key, no credits, rate limits) pause the feature for everyone instead of failing each player in turn. Off unless `OPENROUTER_API_KEY` is set; deployments enabling it need that key in the service environment and outbound HTTPS to `openrouter.ai`, with no proxy change (ADR-019).
