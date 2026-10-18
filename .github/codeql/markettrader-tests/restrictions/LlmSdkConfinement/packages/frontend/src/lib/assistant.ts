// BAD: the browser must never talk to an LLM directly; the key would ship to clients.
import Anthropic from '@anthropic-ai/sdk';

export const assistant = new Anthropic();
