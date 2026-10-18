/** One structured-output completion request. The caller validates `content`. */
export interface LlmRequest {
  /** Upstream model id, e.g. `openrouter/free`. */
  model: string;
  systemPrompt: string;
  userPrompt: string;
  /** JSON Schema the answer must match. Advisory: not every model honours it. */
  jsonSchema: { name: string; schema: Record<string, unknown> };
  /** Covers reasoning tokens too, so it must leave room for a reasoning model to answer. */
  maxOutputTokens: number;
  temperature?: number;
  timeoutMs: number;
  /** Aborts the call early, e.g. on shutdown. */
  signal?: AbortSignal;
}

/** A completion whose content parsed as JSON. */
export interface LlmCompletion {
  /** Parsed JSON, unvalidated. */
  content: unknown;
  /** Model that actually answered (a router picks one per call); null when not reported. */
  reportedModel: string | null;
  usage: { promptTokens: number; completionTokens: number } | null;
}

/**
 * Transport for LLM calls. Lives under `providers/` because it is the only place
 * outbound HTTP is allowed (`ServerOutboundHttpConfinement.ql`).
 */
export interface LlmClient {
  /** Throws {@link LlmError} for every failure, never a raw fetch or parse error. */
  complete(req: LlmRequest): Promise<LlmCompletion>;
}

/**
 * Why an LLM call failed.
 * - `AUTH` — key rejected (401, or a 403 that is not a budget or moderation block).
 * - `NO_CREDITS` — 402: the account or key is out of credits.
 * - `SPEND_LIMIT` — 403 budget block; `retryAfterMs` comes from its `resets_at`.
 * - `RATE_LIMITED` — 429, or a 402 from the in-flight budget.
 * - `BAD_REQUEST` — 400/404: our request or the configured model id is wrong.
 * - `REFUSED` — moderation, guardrail, or a `content_filter` finish.
 * - `UPSTREAM_ERROR` — model down, no provider, network failure, or an error reported inside a 200.
 * - `TIMEOUT` — our deadline passed.
 * - `TRUNCATED` — the token budget ran out before an answer (reasoning models do this).
 * - `INVALID_OUTPUT` — the answer was not parseable JSON.
 * - `ABORTED` — the caller's signal fired.
 */
export type LlmErrorCode =
  | 'AUTH'
  | 'NO_CREDITS'
  | 'SPEND_LIMIT'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'REFUSED'
  | 'UPSTREAM_ERROR'
  | 'TIMEOUT'
  | 'TRUNCATED'
  | 'INVALID_OUTPUT'
  | 'ABORTED';

/** Codes that say the whole account or configuration is unusable, not just this request. */
const FEATURE_SCOPED: ReadonlySet<LlmErrorCode> = new Set([
  'AUTH',
  'NO_CREDITS',
  'SPEND_LIMIT',
  'RATE_LIMITED',
  'BAD_REQUEST',
]);

/**
 * A classified LLM failure. The message carries only a status and a code —
 * never the upstream body, headers, or key, which may echo credentials.
 */
export class LlmError extends Error {
  /** Delay the upstream asked for (`Retry-After`, `resets_at`), when it gave one. */
  readonly retryAfterMs: number | undefined;
  /** True when the request reached a model and so may have used upstream quota. */
  readonly reachedModel: boolean;
  /** Model that produced a bad answer, when a router picked one; for diagnosing which models misbehave. */
  readonly reportedModel: string | null;

  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    opts: { reachedModel: boolean; retryAfterMs?: number | undefined; reportedModel?: string | null },
  ) {
    super(message);
    this.name = 'LlmError';
    this.reachedModel = opts.reachedModel;
    this.retryAfterMs = opts.retryAfterMs;
    this.reportedModel = opts.reportedModel ?? null;
  }

  /** `feature` failures should pause every caller; `request` ones affect only this call. */
  get scope(): 'feature' | 'request' {
    return FEATURE_SCOPED.has(this.code) ? 'feature' : 'request';
  }
}
