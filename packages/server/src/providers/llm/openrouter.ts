import { SpanStatusCode } from '@opentelemetry/api';
import { meters, tracer } from '../../observability/telemetry.js';
import { LlmError, type LlmClient, type LlmCompletion, type LlmRequest } from './interface.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Shape of an OpenRouter error object, top-level or inside a choice. Every field is untrusted. */
interface UpstreamError {
  code?: unknown;
  message?: unknown;
  metadata?: unknown;
}

interface ChatResponse {
  model?: unknown;
  error?: UpstreamError;
  choices?: Array<{
    finish_reason?: unknown;
    error?: UpstreamError;
    message?: { content?: unknown; reasoning?: unknown };
  }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

/**
 * {@link LlmClient} for OpenRouter's OpenAI-compatible chat completions API.
 * Classifies every documented failure, including the ones OpenRouter reports
 * inside an HTTP 200. Makes exactly one request per call: a retry would spend
 * another unit of a free-tier daily budget.
 */
export class OpenRouterClient implements LlmClient {
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'MarketTrader',
    };
    this.fetchImpl = fetchImpl;
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
    const signal = req.signal ? AbortSignal.any([timeout, req.signal]) : timeout;
    let res: Response;
    let body: ChatResponse | undefined;
    try {
      res = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(requestBody(req)),
        signal,
      });
      body = await readJson(res);
    } catch (err) {
      if (timeout.aborted) {
        throw new LlmError('TIMEOUT', `OpenRouter call exceeded ${req.timeoutMs} ms`, { reachedModel: true });
      }
      if (req.signal?.aborted) throw new LlmError('ABORTED', 'OpenRouter call aborted', { reachedModel: false });
      // Network failure before any response: nothing reached a model.
      throw new LlmError('UPSTREAM_ERROR', `OpenRouter request failed (${errorName(err)})`, {
        reachedModel: false,
      });
    }

    if (!res.ok) {
      throw classifyHttpError(res.status, body?.error, parseRetryAfter(res.headers.get('retry-after')));
    }
    if (!body) throw new LlmError('INVALID_OUTPUT', 'OpenRouter returned a non-JSON body', { reachedModel: true });
    return parseCompletion(body);
  }
}

function requestBody(req: LlmRequest): Record<string, unknown> {
  return {
    model: req.model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    temperature: req.temperature ?? 0.2,
    max_tokens: req.maxOutputTokens,
    response_format: {
      type: 'json_schema',
      json_schema: { name: req.jsonSchema.name, strict: true, schema: req.jsonSchema.schema },
    },
    // A free router often lands on a reasoning model, which at default effort spends the
    // whole token budget thinking and returns no content (finish_reason "length").
    // Reasoning is not excluded: some models leave `content` empty and answer in it.
    reasoning: { effort: 'low' },
  };
}

async function readJson(res: Response): Promise<ChatResponse | undefined> {
  const text = await res.text();
  if (text.trim() === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' ? (parsed as ChatResponse) : undefined;
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

function parseCompletion(body: ChatResponse): LlmCompletion {
  if (body.error) {
    throw classifyHttpError(numericCode(body.error.code) ?? 502, body.error, undefined, true);
  }
  const reportedModel = typeof body.model === 'string' && body.model !== '' ? body.model.slice(0, 120) : null;
  const choice = body.choices?.[0];
  if (!choice) {
    throw new LlmError('UPSTREAM_ERROR', 'OpenRouter returned no choices', { reachedModel: true, reportedModel });
  }
  if (choice.error || choice.finish_reason === 'error') {
    throw classifyHttpError(numericCode(choice.error?.code) ?? 502, choice.error, undefined, true);
  }
  if (choice.finish_reason === 'content_filter') {
    throw new LlmError('REFUSED', 'OpenRouter answer was filtered', { reachedModel: true, reportedModel });
  }
  if (choice.finish_reason === 'length') {
    throw new LlmError('TRUNCATED', 'OpenRouter answer ran out of tokens', { reachedModel: true, reportedModel });
  }

  const text = typeof choice.message?.content === 'string' ? choice.message.content : '';
  const reasoning = typeof choice.message?.reasoning === 'string' ? choice.message.reasoning : '';
  const content = extractJson(text) ?? extractJson(reasoning);
  if (content === undefined) {
    // Shape only — the content itself stays out of errors and telemetry.
    const finish =
      typeof choice.finish_reason === 'string' && /^[a-z_]{1,20}$/.test(choice.finish_reason)
        ? choice.finish_reason
        : 'unknown';
    const body = text.trim() === '' ? 'empty' : `${text.length} chars`;
    const shape = `${body}, ${reasoning.length} reasoning chars, finish ${finish}`;
    throw new LlmError('INVALID_OUTPUT', `OpenRouter answer was not JSON (${shape})`, {
      reachedModel: true,
      reportedModel,
    });
  }
  return { content, reportedModel, usage: parseUsage(body.usage) };
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

function parseUsage(usage: ChatResponse['usage']): LlmCompletion['usage'] {
  const prompt = usage?.prompt_tokens;
  const completion = usage?.completion_tokens;
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

