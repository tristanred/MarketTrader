// BAD: a service calling the SDK directly skips LlmClient's timeout, retries and classification.
import { OpenRouter } from '@openrouter/sdk';
import type { ChatResult } from '@openrouter/sdk/models';

export async function analyze(): Promise<ChatResult | undefined> {
  const sdk = new OpenRouter({ apiKey: 'k' });
  void sdk;
  return undefined;
}
