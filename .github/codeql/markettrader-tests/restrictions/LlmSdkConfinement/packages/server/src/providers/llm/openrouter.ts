// OK: providers/llm/ owns the LLM SDK, root and subpath imports alike.
import { OpenRouter } from '@openrouter/sdk';
import { OpenRouterError } from '@openrouter/sdk/models/errors';

export const client = new OpenRouter({ apiKey: 'k' });
export const isUpstreamError = (e: unknown) => e instanceof OpenRouterError;
