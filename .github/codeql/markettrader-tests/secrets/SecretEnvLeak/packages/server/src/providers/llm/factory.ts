declare const env: { OPENROUTER_API_KEY: string; NODE_ENV: string };
declare const logger: { info(obj: unknown, msg: string): void };
declare class OpenRouterClient {
  constructor(apiKey: string);
}
declare class LlmError extends Error {
  constructor(code: string, msg: string);
}

export function createLlmClient(): OpenRouterClient | null {
  if (env.OPENROUTER_API_KEY === '' || env.NODE_ENV === 'test') return null; // OK: predicate-only use
  logger.info({ llmEnabled: env.OPENROUTER_API_KEY !== '' }, 'llm ready'); // OK: a boolean
  return new OpenRouterClient(env.OPENROUTER_API_KEY); // OK: the consumer
}

export function leakKey(): void {
  logger.info({ key: env.OPENROUTER_API_KEY }, 'llm key'); // BAD: secret logged
  throw new LlmError('AUTH', `rejected key ${env.OPENROUTER_API_KEY}`); // BAD: error message
}
