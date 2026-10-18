import { SpanStatusCode } from '@opentelemetry/api';
import { HTTPClient, OpenRouter, type Fetcher } from '@openrouter/sdk';
import type { ChatRequest, ChatResult } from '@openrouter/sdk/models';
import { InvalidRequestError, OpenRouterError, SDKValidationError } from '@openrouter/sdk/models/errors';
import { meters, tracer } from '../../observability/telemetry.js';
import { LlmError, type LlmClient, type LlmCompletion, type LlmRequest } from './interface.js';

/** Shape of an OpenRouter error object, top-level or inside a choice. Every field is untrusted. */
interface UpstreamError {
  code?: unknown;
  message?: unknown;
  metadata?: unknown;
}

/** A completion reduced to what classification reads, from the SDK's result or from a raw body. */
interface Answer {
  model?: unknown;
  error?: UpstreamError;
  choice?: { finishReason?: unknown; error?: UpstreamError; content?: unknown; reasoning?: unknown };
  usage?: { promptTokens?: unknown; completionTokens?: unknown };
}

/** How {@link OpenRouterClient} identifies itself. */
export interface OpenRouterClientOptions {
  apiKey: string;
  /**
   * The app's public URL, sent as `HTTP-Referer`. OpenRouter keys app attribution
   * on it: a title without it shows as "Unknown" in the dashboard.
   */
  appUrl: string;
  /** Replaces the network for tests. */
  fetcher?: Fetcher;
}

const APP_TITLE = 'MarketTrader';

// The SDK otherwise turns on a console logger when OPENROUTER_DEBUG is set, and
// its own docs warn that logger prints secrets — the API key among them.
const SILENT_LOGGER = { group: () => {}, groupEnd: () => {}, log: () => {} };

/**
 * {@link LlmClient} on the official `@openrouter/sdk`. Classifies every
 * documented failure, including the ones OpenRouter reports inside an HTTP 200.
 * Makes exactly one request per call: a retry would spend another unit of a
 * free-tier daily budget, so the SDK's own retries are off.
 */
export class OpenRouterClient implements LlmClient {
  private readonly sdk: OpenRouter;

  constructor(opts: OpenRouterClientOptions) {
    this.sdk = new OpenRouter({
      apiKey: opts.apiKey,
      appTitle: APP_TITLE,
      httpReferer: opts.appUrl,
      // Pinned, so an OPENROUTER_BASE_URL in the environment cannot redirect the key.
      server: 'production',
      retryConfig: { strategy: 'none' },
      debugLogger: SILENT_LOGGER,
      ...(opts.fetcher ? { httpClient: new HTTPClient({ fetcher: opts.fetcher }) } : {}),
    });
  }

  complete(req: LlmRequest): Promise<LlmCompletion> {
    const startedAt = Date.now();
    return tracer.startActiveSpan(
      'llm.complete',
      { attributes: { 'llm.provider': 'openrouter', 'llm.model': req.model } },
      async (span) => {
        let outcome = 'ok';
        try {
          const completion = await this.send(req);
          if (completion.reportedModel) span.setAttribute('llm.reported_model', completion.reportedModel);
          if (completion.usage) {
            meters.llmTokens.add(completion.usage.promptTokens, { direction: 'prompt' });
            meters.llmTokens.add(completion.usage.completionTokens, { direction: 'completion' });
          }
          return completion;
        } catch (err) {
          // LlmErrorCode is a closed union, so the attribute stays bounded.
          outcome = err instanceof LlmError ? err.code.toLowerCase() : 'upstream_error';
          span.recordException(err instanceof Error ? err : new Error(String(err)));
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          meters.llmRequests.add(1, { provider: 'openrouter', outcome });
          meters.llmDuration.record(Date.now() - startedAt, { provider: 'openrouter' });
          span.end();
        }
      },
    );
  }

  private async send(req: LlmRequest): Promise<LlmCompletion> {
    const timeout = AbortSignal.timeout(req.timeoutMs);
    // A per-call signal overrides the SDK's timeoutMs, so the deadline rides on the signal.
    const signal = req.signal ? AbortSignal.any([timeout, req.signal]) : timeout;
    let answer: Answer;
    try {
      const result = await this.sdk.chat.send({ chatRequest: chatRequest(req) }, { signal });
      answer = 'choices' in result ? answerFromResult(result) : {};
    } catch (err) {
      if (timeout.aborted) {
        throw new LlmError('TIMEOUT', `OpenRouter call exceeded ${req.timeoutMs} ms`, { reachedModel: true });
      }
      if (req.signal?.aborted) throw new LlmError('ABORTED', 'OpenRouter call aborted', { reachedModel: false });
      answer = recover(err);
    }
    return parseAnswer(answer);
  }
}

function chatRequest(req: LlmRequest): ChatRequest {
  return {
    model: req.model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    temperature: req.temperature ?? 0.2,
    maxTokens: req.maxOutputTokens,
    responseFormat: {
      type: 'json_schema',
      jsonSchema: { name: req.jsonSchema.name, strict: true, schema: req.jsonSchema.schema },
    },
    // A free router often lands on a reasoning model, which at default effort spends the
    // whole token budget thinking and returns no content (finish_reason "length").
    // Reasoning is not excluded: some models leave `content` empty and answer in it.
    reasoning: { effort: 'low' },
  };
}

/**
 * Turns an SDK failure into an {@link Answer} or throws the {@link LlmError} for it.
 * The SDK validates a 200 strictly, and OpenRouter reports some failures — or omits
 * a field — inside one, so a rejected 2xx is re-read from its raw body.
 */
function recover(err: unknown): Answer {
  if (err instanceof OpenRouterError) {
    const body = parseJsonObject(err.body);
    if (err.statusCode >= 200 && err.statusCode < 300) {
      if (!body) throw new LlmError('INVALID_OUTPUT', 'OpenRouter returned a non-JSON body', { reachedModel: true });
      return answerFromRaw(body);
    }
    const error = body?.['error'];
    throw classifyHttpError(
      err.statusCode,
      error !== null && typeof error === 'object' ? (error as UpstreamError) : undefined,
      parseRetryAfter(err.headers.get('retry-after')),
    );
  }
  // The SDK parses a JSON-typed body without catching, so a gateway's HTML page surfaces as this.
  if (err instanceof SyntaxError) {
    throw new LlmError('INVALID_OUTPUT', 'OpenRouter returned a non-JSON body', { reachedModel: true });
  }
  if (err instanceof InvalidRequestError || err instanceof SDKValidationError) {
    // Our request failed the SDK's own schema: a bug or a bad model id, never transient.
    throw new LlmError('BAD_REQUEST', `OpenRouter request rejected by the SDK (${errorName(err)})`, {
      reachedModel: false,
    });
  }
  // Connection failure before any response: nothing reached a model.
  throw new LlmError('UPSTREAM_ERROR', `OpenRouter request failed (${errorName(err)})`, { reachedModel: false });
}

function answerFromResult(result: ChatResult): Answer {
  const choice = result.choices[0];
  return {
    model: result.model,
    ...(choice
      ? {
          choice: {
            finishReason: choice.finishReason,
            content: textOf(choice.message.content),
            reasoning: choice.message.reasoning,
          },
        }
      : {}),
    ...(result.usage
      ? { usage: { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens } }
      : {}),
  };
}

/** The raw, snake_case body of a 200 the SDK would not accept. Every field is untrusted. */
function answerFromRaw(body: Record<string, unknown>): Answer {
  const choices = body['choices'];
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const choice = first !== null && typeof first === 'object' ? (first as Record<string, unknown>) : undefined;
  const message = asRecord(choice?.['message']);
  const usage = asRecord(body['usage']);
  return {
    model: body['model'],
    ...(asRecord(body['error']) ? { error: body['error'] as UpstreamError } : {}),
    ...(choice
      ? {
          choice: {
            finishReason: choice['finish_reason'],
            ...(asRecord(choice['error']) ? { error: choice['error'] as UpstreamError } : {}),
            content: textOf(message?.['content']),
            reasoning: message?.['reasoning'],
          },
        }
      : {}),
    ...(usage ? { usage: { promptTokens: usage['prompt_tokens'], completionTokens: usage['completion_tokens'] } } : {}),
  };
}

/** Message content as text: a string, or the text parts of a content array. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: unknown) => {
      const text = asRecord(part)?.['text'];
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** Maps an HTTP error status (or an error code reported inside a 200) to an {@link LlmError}. */
function classifyHttpError(
  status: number,
  error: UpstreamError | undefined,
  retryAfterMs: number | undefined,
  insideOk = false,
): LlmError {
  // Untrusted shape: `in` throws on a string, which would escape as a raw TypeError.
  const meta: Record<string, unknown> =
    error?.metadata !== null && typeof error?.metadata === 'object'
      ? (error.metadata as Record<string, unknown>)
      : {};
  const where = insideOk ? `OpenRouter reported ${status} in a 200 response` : `OpenRouter HTTP ${status}`;
  if (status === 401) return new LlmError('AUTH', where, { reachedModel: false });
  if (status === 402) {
    // The in-flight budget is a concurrency ceiling that frees up shortly, not an empty account.
    return meta['limit_source'] === 'openrouter_in_flight_budget'
      ? new LlmError('RATE_LIMITED', where, { reachedModel: false, retryAfterMs })
      : new LlmError('NO_CREDITS', where, { reachedModel: false, retryAfterMs });
  }
  if (status === 403) {
    if ('reasons' in meta || 'flagged_input' in meta || 'patterns' in meta) {
      return new LlmError('REFUSED', where, { reachedModel: true });
    }
    if ('limit_source' in meta || 'resets_at' in meta || 'limit_usd' in meta) {
      return new LlmError('SPEND_LIMIT', where, {
        reachedModel: false,
        retryAfterMs: msUntil(meta['resets_at']) ?? retryAfterMs,
      });
    }
    return new LlmError('AUTH', where, { reachedModel: false });
  }
  if (status === 429) {
    // One free model's shared upstream pool is saturated, not our account: a router
    // picks another model next time, so this must not pause the feature for everyone.
    if (meta['limit_source'] === 'upstream_provider_shared_pool') {
      return new LlmError('UPSTREAM_ERROR', where, { reachedModel: false });
    }
    return new LlmError('RATE_LIMITED', where, { reachedModel: false, retryAfterMs });
  }
  if (status === 400 || status === 404) return new LlmError('BAD_REQUEST', where, { reachedModel: false });
  if (status === 408) return new LlmError('TIMEOUT', where, { reachedModel: true });
  // 5xx: the model was down or answered badly. Counted as reaching it, so a failing
  // model still advances the global ceiling and the per-symbol cooldown.
  return new LlmError('UPSTREAM_ERROR', where, { reachedModel: true, retryAfterMs });
}

function parseAnswer(answer: Answer): LlmCompletion {
  if (answer.error) {
    throw classifyHttpError(numericCode(answer.error.code) ?? 502, answer.error, undefined, true);
  }
  const reportedModel =
    typeof answer.model === 'string' && answer.model !== '' ? answer.model.slice(0, 120) : null;
  const choice = answer.choice;
  if (!choice) {
    throw new LlmError('UPSTREAM_ERROR', 'OpenRouter returned no choices', { reachedModel: true, reportedModel });
  }
  if (choice.error || choice.finishReason === 'error') {
    throw classifyHttpError(numericCode(choice.error?.code) ?? 502, choice.error, undefined, true);
  }
  if (choice.finishReason === 'content_filter') {
    throw new LlmError('REFUSED', 'OpenRouter answer was filtered', { reachedModel: true, reportedModel });
  }
  if (choice.finishReason === 'length') {
    throw new LlmError('TRUNCATED', 'OpenRouter answer ran out of tokens', { reachedModel: true, reportedModel });
  }

  const text = typeof choice.content === 'string' ? choice.content : '';
  const reasoning = typeof choice.reasoning === 'string' ? choice.reasoning : '';
  const content = extractJson(text) ?? extractJson(reasoning);
  if (content === undefined) {
    // Shape only — the content itself stays out of errors and telemetry.
    const finish =
      typeof choice.finishReason === 'string' && /^[a-z_]{1,20}$/.test(choice.finishReason)
        ? choice.finishReason
        : 'unknown';
    const body = text.trim() === '' ? 'empty' : `${text.length} chars`;
    const shape = `${body}, ${reasoning.length} reasoning chars, finish ${finish}`;
    throw new LlmError('INVALID_OUTPUT', `OpenRouter answer was not JSON (${shape})`, {
      reachedModel: true,
      reportedModel,
    });
  }
  return { content, reportedModel, usage: parseUsage(answer.usage) };
}

/** Reasoning text can run to tens of thousands of chars; the answer is at its end. */
const EXTRACT_WINDOW = 20_000;

/**
 * Parses the last JSON object in a model answer. Models that ignore
 * `response_format` wrap it in a code fence, lead with prose, or draft it more
 * than once in their reasoning — so after dropping any `<think>` block, take the
 * earliest opening brace that parses through the final closing one.
 */
export function extractJson(text: string): unknown {
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '').slice(-EXTRACT_WINDOW);
  const end = stripped.lastIndexOf('}');
  for (let start = stripped.indexOf('{'); start !== -1 && start < end; start = stripped.indexOf('{', start + 1)) {
    try {
      return JSON.parse(stripped.slice(start, end + 1));
    } catch {
      // Not a complete object from here; try the next opening brace.
    }
  }
  return undefined;
}

function parseUsage(usage: Answer['usage']): LlmCompletion['usage'] {
  const prompt = usage?.promptTokens;
  const completion = usage?.completionTokens;
  return typeof prompt === 'number' && typeof completion === 'number'
    ? { promptTokens: prompt, completionTokens: completion }
    : null;
}

/** `Retry-After` as milliseconds: delta-seconds or an HTTP date. Undefined when absent or unparseable. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  return msUntil(trimmed, now);
}

function msUntil(value: unknown, now: number = Date.now()): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const at = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, at - now);
}

function numericCode(code: unknown): number | undefined {
  const n = typeof code === 'number' ? code : typeof code === 'string' ? Number(code) : NaN;
  return Number.isInteger(n) && n >= 400 && n < 600 ? n : undefined;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown';
}

