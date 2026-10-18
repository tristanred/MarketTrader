import { describe, it, expect } from 'vitest';
import { OpenRouterClient, extractJson, parseRetryAfter } from '../../src/providers/llm/openrouter.js';
import { LlmError, type LlmRequest } from '../../src/providers/llm/interface.js';

const KEY = 'sk-or-v1-test-key-do-not-leak';

const request: LlmRequest = {
  model: 'openrouter/free',
  system: 'system prompt',
  user: 'user prompt',
  jsonSchema: { name: 'stock_analysis', schema: { type: 'object' } },
  maxOutputTokens: 4000,
  timeoutMs: 5_000,
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function ok(content: unknown, extra: Record<string, unknown> = {}): Response {
  return json(200, {
    model: 'nvidia/nemotron:free',
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: { prompt_tokens: 111, completion_tokens: 222 },
    ...extra,
  });
}

function clientReturning(res: Response | (() => Promise<Response>)) {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return typeof res === 'function' ? res() : res;
  }) as typeof fetch;
  return { client: new OpenRouterClient(KEY, fetchImpl), seen };
}

async function failure(res: Response | (() => Promise<Response>), req: LlmRequest = request): Promise<LlmError> {
  const { client } = clientReturning(res);
  const err = await client.complete(req).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(LlmError);
  return err as LlmError;
}

describe('OpenRouterClient request', () => {
  it('posts one structured-output request with low reasoning effort and no user data', async () => {
    const { client, seen } = clientReturning(ok('{"verdict":"BUY"}'));
    await client.complete(request);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(seen[0]!.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'openrouter/free',
      max_tokens: 4000,
      reasoning: { effort: 'low' },
      response_format: { type: 'json_schema', json_schema: { name: 'stock_analysis', strict: true } },
    });
    expect(body).not.toHaveProperty('user');
    expect(body).not.toHaveProperty('provider');
    expect(body['messages']).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
    ]);
  });

  it('returns parsed content, the reported model, and token usage', async () => {
    const { client } = clientReturning(ok('{"verdict":"HOLD","confidence":40}'));
    await expect(client.complete(request)).resolves.toEqual({
      content: { verdict: 'HOLD', confidence: 40 },
      reportedModel: 'nvidia/nemotron:free',
      usage: { promptTokens: 111, completionTokens: 222 },
    });
  });

  it('accepts JSON wrapped in a code fence or behind reasoning text', async () => {
    const fenced = await clientReturning(ok('Sure!\n```json\n{"verdict":"SELL"}\n```')).client.complete(request);
    expect(fenced.content).toEqual({ verdict: 'SELL' });
    const thinking = await clientReturning(ok('<think>{maybe} hmm</think>{"verdict":"BUY"}')).client.complete(request);
    expect(thinking.content).toEqual({ verdict: 'BUY' });
  });

  it('falls back to the reasoning field when a model leaves content empty', async () => {
    // Seen live: poolside/laguna-xs-2.1:free answered with empty content and finish "stop".
    const res = json(200, {
      model: 'poolside/laguna-xs-2.1:free',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: '',
            reasoning: 'Draft: {"verdict": "BUY", oops} Then final answer: {"verdict":"HOLD","nested":{"a":1}} done.',
          },
        },
      ],
    });
    const out = await clientReturning(res).client.complete(request);
    expect(out.content).toEqual({ verdict: 'HOLD', nested: { a: 1 } });
  });
});

describe('OpenRouterClient HTTP errors', () => {
  it.each([
    [401, {}, 'AUTH', 'feature', false],
    [402, {}, 'NO_CREDITS', 'feature', false],
    [402, { limit_source: 'openrouter_in_flight_budget' }, 'RATE_LIMITED', 'feature', false],
    [403, { limit_source: 'key', resets_at: '2099-01-01T00:00:00Z' }, 'SPEND_LIMIT', 'feature', false],
    [403, { reasons: ['violence'], flagged_input: 'x' }, 'REFUSED', 'request', true],
    [403, {}, 'AUTH', 'feature', false],
    [429, {}, 'RATE_LIMITED', 'feature', false],
    [400, {}, 'BAD_REQUEST', 'feature', false],
    [404, {}, 'BAD_REQUEST', 'feature', false],
    [408, {}, 'TIMEOUT', 'request', true],
    [500, {}, 'UPSTREAM_ERROR', 'request', true],
    [502, {}, 'UPSTREAM_ERROR', 'request', true],
    [503, {}, 'UPSTREAM_ERROR', 'request', true],
  ] as const)('maps %i %j to %s (%s scope)', async (status, metadata, code, scope, reached) => {
    const err = await failure(json(status, { error: { code: status, message: `upstream says ${KEY}`, metadata } }));
    expect(err.code).toBe(code);
    expect(err.scope).toBe(scope);
    expect(err.reachedModel).toBe(reached);
  });

  it('treats one free model’s saturated upstream pool as a per-request failure', async () => {
    // Seen live: the error names the model's shared pool, not our account.
    const err = await failure(
      json(429, {
        error: {
          code: 429,
          message: 'Provider returned error',
          metadata: { limit_source: 'upstream_provider_shared_pool', provider_name: 'Poolside' },
        },
      }),
    );
    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.scope).toBe('request');
    expect(err.reachedModel).toBe(false);
  });

  it('classifies an error whose metadata is not an object', async () => {
    const err = await failure(json(403, { error: { code: 403, message: 'x', metadata: 'oops' } }));
    expect(err.code).toBe('AUTH');
  });

  it('honours Retry-After on a 429, and leaves it unset when absent', async () => {
    const withHeader = await failure(json(429, { error: { code: 429, message: 'slow down' } }, { 'retry-after': '120' }));
    expect(withHeader.retryAfterMs).toBe(120_000);
    const without = await failure(json(429, { error: { code: 429, message: 'slow down' } }));
    expect(without.retryAfterMs).toBeUndefined();
  });

  it('takes a spend-limit pause from resets_at', async () => {
    const resetsAt = new Date(Date.now() + 3_600_000).toISOString();
    const err = await failure(json(403, { error: { code: 403, message: 'budget', metadata: { resets_at: resetsAt } } }));
    expect(err.code).toBe('SPEND_LIMIT');
    expect(err.retryAfterMs).toBeGreaterThan(3_500_000);
    expect(err.retryAfterMs).toBeLessThanOrEqual(3_600_000);
  });

  it('never puts the key or the upstream body in an error message', async () => {
    for (const status of [400, 401, 402, 403, 429, 500]) {
      const err = await failure(json(status, { error: { code: status, message: `echo ${KEY} secret-body` } }));
      expect(err.message).not.toContain(KEY);
      expect(err.message).not.toContain('secret-body');
    }
  });
});

describe('OpenRouterClient failures inside a 200', () => {
  it('maps a top-level error object by its code', async () => {
    const err = await failure(json(200, { error: { code: 502, message: 'provider died' } }));
    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.reachedModel).toBe(true);
    const limited = await failure(json(200, { error: { code: 429, message: 'later' } }));
    expect(limited.code).toBe('RATE_LIMITED');
  });

  it('maps finish_reason "error" and a choice-level error', async () => {
    const finished = await failure(json(200, { choices: [{ finish_reason: 'error', message: { content: '' } }] }));
    expect(finished.code).toBe('UPSTREAM_ERROR');
    const choiceError = await failure(
      json(200, { choices: [{ finish_reason: 'stop', error: { code: 500, message: 'x' }, message: { content: '{}' } }] }),
    );
    expect(choiceError.code).toBe('UPSTREAM_ERROR');
  });

  it('maps a token-budget cut-off (the reasoning-model failure) to TRUNCATED', async () => {
    const err = await failure(json(200, { choices: [{ finish_reason: 'length', message: { content: null } }] }));
    expect(err.code).toBe('TRUNCATED');
    expect(err.reachedModel).toBe(true);
  });

  it('maps a content_filter finish to REFUSED', async () => {
    const err = await failure(json(200, { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }));
    expect(err.code).toBe('REFUSED');
  });

  it('carries the model that gave a bad answer, and only the answer’s shape in the message', async () => {
    const err = await failure(ok('Here is my analysis: buy it, secret-content'));
    expect(err.code).toBe('INVALID_OUTPUT');
    expect(err.reportedModel).toBe('nvidia/nemotron:free');
    expect(err.message).toMatch(/\d+ chars, 0 reasoning chars, finish stop/);
    expect(err.message).not.toContain('secret-content');
  });

  it('maps prose, empty content, no choices, and a non-JSON body', async () => {
    expect((await failure(ok('I think you should buy.'))).code).toBe('INVALID_OUTPUT');
    expect((await failure(ok(null))).code).toBe('INVALID_OUTPUT');
    expect((await failure(json(200, { choices: [] }))).code).toBe('UPSTREAM_ERROR');
    expect((await failure(json(200, '<html>gateway</html>'))).code).toBe('INVALID_OUTPUT');
  });
});

describe('OpenRouterClient transport failures', () => {
  it('maps its own deadline to TIMEOUT', async () => {
    const fetchImpl = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;
    const client = new OpenRouterClient(KEY, fetchImpl);
    const err = await client.complete({ ...request, timeoutMs: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).code).toBe('TIMEOUT');
    expect((err as LlmError).reachedModel).toBe(true);
  });

  it('maps a caller abort to ABORTED', async () => {
    const fetchImpl = ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;
    const controller = new AbortController();
    const pending = new OpenRouterClient(KEY, fetchImpl).complete({ ...request, signal: controller.signal });
    controller.abort();
    const err = await pending.catch((e: unknown) => e);
    expect((err as LlmError).code).toBe('ABORTED');
  });

  it('maps a network failure to UPSTREAM_ERROR that never reached a model', async () => {
    const fetchImpl = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    const err = await new OpenRouterClient(KEY, fetchImpl).complete(request).catch((e: unknown) => e);
    expect((err as LlmError).code).toBe('UPSTREAM_ERROR');
    expect((err as LlmError).reachedModel).toBe(false);
  });
});

describe('helpers', () => {
  it('extractJson takes the outermost object and rejects garbage', () => {
    expect(extractJson('{"a":{"b":1}}')).toEqual({ a: { b: 1 } });
    expect(extractJson('no json here')).toBeUndefined();
    expect(extractJson('{broken')).toBeUndefined();
  });

  it('parseRetryAfter reads delta-seconds and HTTP dates', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    expect(parseRetryAfter('30', now)).toBe(30_000);
    expect(parseRetryAfter('Sat, 17 Oct 2026 12:01:00 GMT', now)).toBe(60_000);
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('soon', now)).toBeUndefined();
  });
});
