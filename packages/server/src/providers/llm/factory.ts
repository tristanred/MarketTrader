import { env } from '../../env.js';
import type { LlmClient } from './interface.js';
import { OpenRouterClient } from './openrouter.js';

/**
 * The LLM client for this process, or null (feature off) when no key is set —
 * and always under `NODE_ENV=test`, so a developer's key can never make a test
 * spend free-tier budget. Tests that need one inject a fake through `buildApp`.
 */
export function createLlmClient(): LlmClient | null {
  if (env.OPENROUTER_API_KEY === '' || env.NODE_ENV === 'test') return null;
  return new OpenRouterClient(env.OPENROUTER_API_KEY);
}
