import type { LlmClient, LlmCompletion, LlmRequest } from '../../src/providers/llm/interface.js';

/** A well-formed model answer, in the snake_case shape the prompt asks for. */
export function validAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    verdict: 'BUY',
    confidence: 72,
    summary: 'Momentum and margins support the stock despite a full valuation.',
    bull_points: ['Price above its 50- and 200-day averages', 'Revenue growing 14% a year'],
    bear_points: ['Forward P/E of 31 is above its history', 'Earnings report in 9 days'],
    ...overrides,
  };
}

type Step = LlmCompletion | Error | (() => Promise<LlmCompletion>);

/**
 * Scripted {@link LlmClient}: each call takes the next queued step (a completion,
 * an error to throw, or a function — e.g. one awaiting a gate, for concurrency
 * tests) and falls back to a valid answer when the queue is empty.
 */
export class FakeLlmClient implements LlmClient {
  readonly calls: LlmRequest[] = [];
  private readonly steps: Step[] = [];

  /** Queues the outcomes of the next calls, in order. */
  queue(...steps: Step[]): this {
    this.steps.push(...steps);
    return this;
  }

  async complete(req: LlmRequest): Promise<LlmCompletion> {
    this.calls.push(req);
    const step = this.steps.shift();
    if (step === undefined) return completion(validAnswer());
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step();
    return step;
  }
}

/** Wraps parsed content as a completion from a router-picked model. */
export function completion(content: unknown, reportedModel = 'vendor/backing-model:free'): LlmCompletion {
  return { content, reportedModel, usage: { promptTokens: 900, completionTokens: 300 } };
}

/** A promise plus its resolver, for holding a fake call open. */
export function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
