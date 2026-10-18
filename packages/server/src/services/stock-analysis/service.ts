import { SpanStatusCode } from '@opentelemetry/api';
import type { FastifyBaseLogger } from 'fastify';
import type {
  AnalysisErrorCode,
  AnalysisFailure,
  AnalysisSource,
  AnalysisUsage,
  StockAnalysis,
  StockAnalysisPending,
  StockAnalysisResponse,
  StockAnalysisStatus,
  StockQuote,
} from '@markettrader/shared';
import type { Db } from '../../db/index.js';
import type { ConfigReader } from '../../config/runtime-config.js';
import type { EventBus } from '../../events/bus.js';
import type { Limits } from '../../limits/index.js';
import type { LimitSubject } from '../../limits/resolver.js';
import type { RequestAccount } from '../../limits/account.js';
import { LIMIT_CATALOGUE } from '../../limits/catalogue.js';
import { secondsUntilWindowFrees } from '../../limits/enforce.js';
import { LimitExceededError } from '../../limits/errors.js';
import {
  countStockAnalysesSince,
  oldestStockAnalysisSince,
  toSqlTimestamp,
  windowStart,
} from '../../limits/quota-counts.js';
import type { StockProvider } from '../../providers/interface.js';
import { LlmError, type LlmClient } from '../../providers/llm/interface.js';
import { meters, tracer } from '../../observability/telemetry.js';
import { AnalysisBreaker } from './breaker.js';
import { computeFeatures } from './features.js';
import { buildAnalysisPrompt, PROMPT_VERSION } from './prompt.js';
import { ANALYSIS_JSON_SCHEMA, modelOutputSchema, toResult } from './schema.js';
import {
  countAttemptsSince,
  findFreshAnalysis,
  latestAttempt,
  oldestAttemptSince,
  recordAttempt,
  type AnalysisKey,
} from './store.js';

const DAY_MS = 24 * 60 * 60_000;
/** After a failed attempt, the same analysis is not retried for this long — by anyone. */
export const FAILURE_COOLDOWN_MS = 60_000;
/** Matches the registry max of `ANALYSIS_RESPONSE_WAIT_MS`: under nginx's default 60 s read timeout. */
const MAX_RESPONSE_WAIT_MS = 50_000;
/** How long a polling client can still learn that a background generation failed. */
const RECENT_FAILURE_TTL_MS = 5 * 60_000;
/** Bounds the recent-failures map: its keys come from user-supplied symbols. */
const RECENT_FAILURES_MAX = 500;
/** Covers reasoning tokens too: at 1500 a free reasoning model spent all of them thinking. */
const MAX_OUTPUT_TOKENS = 4000;

/** An analysis request refused or failed, with the HTTP status the route should answer. */
export class AnalysisError extends Error {
  constructor(
    public readonly code: AnalysisErrorCode,
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AnalysisError';
  }
}

/** An authenticated caller: the limits subject with its account guaranteed. */
export type AnalysisCaller = LimitSubject & { account: RequestAccount };

/** Dependencies of {@link StockAnalysisService}. `llm: null` means the feature is off. */
export interface StockAnalysisDeps {
  db: Db;
  provider: StockProvider;
  llm: LlmClient | null;
  limits: Limits;
  config: ConfigReader;
  bus?: EventBus;
  logger?: FastifyBaseLogger;
}

/**
 * LLM stock analysis: a shared per-symbol cache in front of OpenRouter, a per-user
 * daily quota of fresh generations, a global daily ceiling, and a process-wide
 * breaker for account-level upstream failures.
 *
 * Cache hits and joins on another user's in-flight generation are free and bypass
 * every limit, so a user at their cap or during an outage still sees cached
 * results. Free models take 15–60 s, longer than a request may stay open behind
 * the proxy, so a request waits at most `ANALYSIS_RESPONSE_WAIT_MS` and then
 * answers "generating"; the generation runs on and the client polls
 * {@link StockAnalysisService.status}. A user runs one generation at a time — the
 * busy mark lasts as long as the generation, not the request, or a user could
 * start several before any of them is counted against their quota.
 *
 * The in-flight map, the busy set, the recent failures, and the breaker are
 * process-local, which the single-host deployment (ADR-013, ADR-018) makes exact.
 */
export class StockAnalysisService {
  private readonly inFlight = new Map<string, Promise<StockAnalysis>>();
  private readonly busyUsers = new Set<string>();
  /** How background generations ended, for clients that got a 202 and are polling. */
  private readonly recentFailures = new Map<string, AnalysisFailure>();
  private readonly shutdown = new AbortController();
  readonly breaker = new AnalysisBreaker();

  constructor(private readonly deps: StockAnalysisDeps) {}

  /** False when no LLM is configured: analyze answers 503, status reports `enabled: false`, the button is hidden. */
  get enabled(): boolean {
    return this.deps.llm !== null;
  }

  /**
   * Returns the cached analysis for `symbol`, joins one in flight, or starts one —
   * answering "generating" if it is not done within the wait. Throws
   * {@link AnalysisError}, `LimitExceededError` (quota), or `StockProviderError`
   * (unknown symbol, price provider trouble).
   */
  async analyze(
    caller: AnalysisCaller,
    symbol: string,
  ): Promise<StockAnalysisResponse | StockAnalysisPending> {
    try {
      const llm = this.deps.llm;
      if (!llm) throw disabled();
      // Validates the symbol before anything is spent; an unknown one is a cheap 404.
      const quote = await this.deps.provider.getQuote(symbol);
      const resolved = await this.resolve(caller, this.keyFor(symbol), quote, llm);
      const usage = await this.usage(caller);
      if (resolved.kind === 'pending') {
        meters.analysisRequests.add(1, { outcome: 'pending' });
        return { status: 'generating', usage };
      }
      meters.analysisRequests.add(1, { outcome: resolved.source });
      return { analysis: resolved.analysis, source: resolved.source, usage };
    } catch (err) {
      meters.analysisRequests.add(1, { outcome: outcomeOf(err) });
      throw err;
    }
  }

  /** What the Analyze button needs before a click, and what a polling client reads. Never generates. */
  async status(caller: AnalysisCaller, symbol: string): Promise<StockAnalysisStatus> {
    const usage = await this.usage(caller);
    if (!this.enabled) {
      return {
        enabled: false,
        available: false,
        retryAt: null,
        cached: false,
        generating: false,
        lastFailure: null,
        usage,
      };
    }
    const key = this.keyFor(symbol);
    const now = Date.now();
    const cached = (await findFreshAnalysis(this.deps.db, key, this.cacheCutoff(now))) !== undefined;
    const pausedUntil = this.breaker.openUntil(key.model, now) ?? (await this.capacityFreesAt(now));
    return {
      enabled: true,
      available: pausedUntil === undefined,
      retryAt: pausedUntil === undefined ? null : new Date(pausedUntil).toISOString(),
      cached,
      generating: this.inFlight.has(flightKeyOf(key)),
      lastFailure: this.recentFailure(flightKeyOf(key), now),
      usage,
    };
  }

  /** The caller's allowance of fresh analyses in the rolling 24 h window. */
  async usage(caller: AnalysisCaller, now: number = Date.now()): Promise<AnalysisUsage> {
    const resolved = await this.deps.limits.resolver.resolve(caller, 'stockAnalyses');
    const since = windowStart('stockAnalyses', now);
    const userId = caller.account.id;
    const used = await countStockAnalysesSince(this.deps.db, userId, since);
    const oldest = used > 0 ? await oldestStockAnalysisSince(this.deps.db, userId, since) : null;
    return {
      limit: resolved.max,
      used,
      remaining: resolved.max === null ? null : Math.max(0, resolved.max - used),
      probation: resolved.probation,
      nextSlotAt: oldest ? new Date(Date.parse(oldest) + DAY_MS).toISOString() : null,
    };
  }

  /** Aborts in-flight LLM calls and waits for them to settle; called from `onClose`. */
  async stop(): Promise<void> {
    this.shutdown.abort();
    await Promise.allSettled([...this.inFlight.values()]);
  }

  private async resolve(
    caller: AnalysisCaller,
    key: AnalysisKey,
    quote: StockQuote,
    llm: LlmClient,
  ): Promise<Resolved> {
    const { db, limits, config } = this.deps;
    const flightKey = flightKeyOf(key);

    const hit = await findFreshAnalysis(db, key, this.cacheCutoff(Date.now()));
    if (hit) return { kind: 'done', analysis: hit, source: 'cache' };
    const joined = this.inFlight.get(flightKey);
    if (joined) return this.awaitBounded(joined, 'shared');

    const pausedUntil = this.breaker.openUntil(key.model);
    if (pausedUntil !== undefined) throw unavailable(pausedUntil);

    const userId = caller.account.id;
    if (this.busyUsers.has(userId)) {
      throw new AnalysisError(
        'ANALYSIS_IN_PROGRESS',
        409,
        'An analysis you started is still running.',
      );
    }
    this.busyUsers.add(userId);
    // Once a generation starts it owns the busy mark and releases it when it settles.
    let handedOff = false;
    try {
      const now = Date.now();
      const since = windowStart('stockAnalyses', now);
      await limits.enforcer.enforceFor(
        caller,
        'stockAnalyses',
        () => countStockAnalysesSince(db, userId, since),
        {
          retryAfter: async () =>
            secondsUntilWindowFrees(
              await oldestStockAnalysisSince(db, userId, since),
              LIMIT_CATALOGUE.stockAnalyses.windowMs,
              now,
            ),
        },
      );

      const attempts = await countAttemptsSince(db, toSqlTimestamp(new Date(now - DAY_MS)));
      // Every other busy user is a leader either still in these checks or with a
      // generation running — counting them (not just started flights) keeps
      // simultaneous leaders from all passing at cap − 1. It errs on the strict side.
      const otherLeaders = this.busyUsers.size - 1;
      if (attempts + otherLeaders >= config.get('ANALYSIS_MAX_GENERATIONS_PER_DAY')) {
        const freesAt = await this.capacityFreesAt(now, true);
        throw new AnalysisError(
          'ANALYSIS_CAPACITY',
          503,
          "Today's analysis capacity is used up.",
          freesAt === undefined ? undefined : secondsUntil(freesAt, now),
        );
      }

      const last = await latestAttempt(db, key);
      if (last?.status === 'failed') {
        const retryAt = Date.parse(last.createdAt) + FAILURE_COOLDOWN_MS;
        if (retryAt > now) throw unavailable(retryAt, now);
      }

      // The awaits above let another request finish or start this analysis.
      const fresh = await findFreshAnalysis(db, key, this.cacheCutoff(Date.now()));
      if (fresh) return { kind: 'done', analysis: fresh, source: 'cache' };
      // No await between this check and starting the flight, so two leaders cannot both start.
      const raced = this.inFlight.get(flightKey);
      if (raced) return this.awaitBounded(raced, 'shared');

      const flight = this.startFlight(flightKey, key, quote, userId, llm);
      handedOff = true;
      return this.awaitBounded(flight, 'generated');
    } finally {
      if (!handedOff) this.busyUsers.delete(userId);
    }
  }

  /** Starts a generation that outlives any one request: it registers itself, and cleans up when it settles. */
  private startFlight(
    flightKey: string,
    key: AnalysisKey,
    quote: StockQuote,
    userId: string,
    llm: LlmClient,
  ): Promise<StockAnalysis> {
    this.recentFailures.delete(flightKey);
    const flight = this.generate(key, quote, userId, llm)
      .catch((err: unknown) => {
        this.rememberFailure(flightKey, err);
        throw err;
      })
      .finally(() => {
        this.inFlight.delete(flightKey);
        this.busyUsers.delete(userId);
      });
    // After a 202 nobody awaits the flight; its outcome is reported through status().
    flight.catch(() => {});
    this.inFlight.set(flightKey, flight);
    return flight;
  }

  /** Waits for `flight` up to `ANALYSIS_RESPONSE_WAIT_MS`, then reports it as still generating. */
  private async awaitBounded(flight: Promise<StockAnalysis>, source: AnalysisSource): Promise<Resolved> {
    // Environment values skip the registry bounds that admin overrides get, and a
    // wait past the proxy read timeout would bring back the cut-off this avoids.
    const waitMs = Math.min(this.deps.config.get('ANALYSIS_RESPONSE_WAIT_MS'), MAX_RESPONSE_WAIT_MS);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<'pending'>((resolve) => {
      timer = setTimeout(() => resolve('pending'), waitMs);
    });
    try {
      const outcome = await Promise.race([flight, waited]);
      return outcome === 'pending' ? { kind: 'pending' } : { kind: 'done', analysis: outcome, source };
    } finally {
      clearTimeout(timer);
    }
  }

  private rememberFailure(flightKey: string, err: unknown): void {
    const body =
      err instanceof AnalysisError
        ? { error: err.message, code: err.code, ...retryField(err.retryAfterSeconds) }
        : { error: couldNotGenerate, code: 'ANALYSIS_FAILED' as const };
    // Re-inserting moves the key to the newest position, so eviction drops the oldest.
    this.recentFailures.delete(flightKey);
    this.recentFailures.set(flightKey, { ...body, failedAt: new Date().toISOString() });
    if (this.recentFailures.size > RECENT_FAILURES_MAX) {
      const oldest = this.recentFailures.keys().next().value;
      if (oldest !== undefined) this.recentFailures.delete(oldest);
    }
  }

  private recentFailure(flightKey: string, now: number): AnalysisFailure | null {
    const failure = this.recentFailures.get(flightKey);
    if (!failure) return null;
    if (Date.parse(failure.failedAt) + RECENT_FAILURE_TTL_MS < now) {
      this.recentFailures.delete(flightKey);
      return null;
    }
    return failure;
  }

  private generate(
    key: AnalysisKey,
    quote: StockQuote,
    userId: string,
    llm: LlmClient,
  ): Promise<StockAnalysis> {
    const startedAt = Date.now();
    return tracer.startActiveSpan(
      'analysis.generate',
      { attributes: { 'analysis.symbol': key.symbol, 'analysis.model': key.model } },
      async (span) => {
        try {
          const input = await this.collectInput(key.symbol, quote);
          const prompt = buildAnalysisPrompt(input);
          span.setAttribute('analysis.inputs', inputsPresent(input));

          const base = {
            ...key,
            generatedBy: userId,
            priceAtAnalysis: quote.price,
          };
          let completion;
          try {
            completion = await llm.complete({
              model: key.model,
              system: prompt.system,
              user: prompt.user,
              jsonSchema: ANALYSIS_JSON_SCHEMA,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              timeoutMs: this.deps.config.get('ANALYSIS_TIMEOUT_MS'),
              signal: this.shutdown.signal,
            });
          } catch (err) {
            if (!(err instanceof LlmError)) throw err;
            if (err.scope === 'feature') this.trip(err, key.model);
            if (err.reportedModel) span.setAttribute('analysis.reported_model', err.reportedModel);
            if (err.reachedModel) {
              // Info, not warn: free models fail often and PostHog bills logs by volume.
              this.deps.logger?.info(
                { code: err.code, reportedModel: err.reportedModel, detail: err.message },
                'stock analysis generation failed',
              );
              await this.recordFailure(
                { ...base, reportedModel: err.reportedModel, durationMs: Date.now() - startedAt },
                err.code,
              );
            }
            throw toAnalysisError(err, this.breaker.openUntil(key.model));
          }
          if (completion.reportedModel) span.setAttribute('analysis.reported_model', completion.reportedModel);

          const usage = {
            reportedModel: completion.reportedModel,
            promptTokens: completion.usage?.promptTokens ?? null,
            completionTokens: completion.usage?.completionTokens ?? null,
          };
          const parsed = modelOutputSchema.safeParse(completion.content);
          if (!parsed.success) {
            await this.recordFailure(
              { ...base, ...usage, durationMs: Date.now() - startedAt },
              'INVALID_OUTPUT',
            );
            throw new AnalysisError('ANALYSIS_FAILED', 502, couldNotGenerate);
          }

          const result = toResult(parsed.data);
          const durationMs = Date.now() - startedAt;
          const generatedAt = await recordAttempt(this.deps.db, {
            ...base,
            ...usage,
            durationMs,
            status: 'ok',
            result,
          });
          meters.analysisDuration.record(durationMs, { outcome: 'ok' });
          void this.deps.bus?.emit({
            type: 'analysis.generated',
            userId,
            symbol: key.symbol,
            verdict: result.verdict,
            confidence: result.confidence,
            model: key.model,
            durationMs,
            generatedAt,
          });
          return {
            symbol: key.symbol,
            ...result,
            generatedAt,
            reportedModel: completion.reportedModel,
            priceAtAnalysis: quote.price,
          };
        } catch (err) {
          meters.analysisDuration.record(Date.now() - startedAt, { outcome: 'error' });
          span.recordException(err instanceof Error ? err : new Error(String(err)));
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  }

  /** Quote is required; every other input is best-effort, since a missing one only lowers confidence. */
  private async collectInput(symbol: string, quote: StockQuote) {
    const { provider } = this.deps;
    const [details, history, fundamentals] = await Promise.allSettled([
      provider.getDetails(symbol),
      provider.getHistory(symbol, '1y'),
      provider.getFundamentals ? provider.getFundamentals(symbol) : Promise.reject(new Error('unsupported')),
    ]);
    return {
      symbol,
      asOf: new Date().toISOString(),
      quote,
      details: details.status === 'fulfilled' ? details.value : undefined,
      features: history.status === 'fulfilled' ? computeFeatures(history.value) : undefined,
      fundamentals: fundamentals.status === 'fulfilled' ? fundamentals.value : undefined,
    };
  }

  private async recordFailure(attempt: FailedAttempt, errorCode: string): Promise<void> {
    try {
      await recordAttempt(this.deps.db, {
        reportedModel: null,
        promptTokens: null,
        completionTokens: null,
        ...attempt,
        status: 'failed',
        errorCode,
      });
    } catch (err) {
      // Losing the failure row only weakens the cooldown and the ceiling; the
      // caller still gets the real error rather than this one.
      this.deps.logger?.error({ err }, 'could not record failed stock analysis');
    }
  }

  private trip(err: LlmError, model: string): void {
    this.breaker.open(err, model);
    meters.analysisBreakerTrips.add(1, { reason: err.code });
    const log = { code: err.code, until: new Date(this.breaker.openUntil(model) ?? Date.now()).toISOString() };
    // A bad key or a malformed request needs an operator; the rest clear on their own.
    if (err.code === 'AUTH' || err.code === 'BAD_REQUEST') {
      this.deps.logger?.error(log, 'stock analysis paused: upstream rejected the request');
    } else {
      this.deps.logger?.warn(log, 'stock analysis paused: upstream capacity or credits');
    }
  }

  /** When the global ceiling frees a slot, or undefined when it is not reached. */
  private async capacityFreesAt(now: number, reached = false): Promise<number | undefined> {
    const since = toSqlTimestamp(new Date(now - DAY_MS));
    if (!reached) {
      const attempts = await countAttemptsSince(this.deps.db, since);
      if (attempts + this.inFlight.size < this.deps.config.get('ANALYSIS_MAX_GENERATIONS_PER_DAY')) {
        return undefined;
      }
    }
    const oldest = await oldestAttemptSince(this.deps.db, since);
    return oldest ? Date.parse(oldest) + DAY_MS : undefined;
  }

  private keyFor(symbol: string): AnalysisKey {
    return { symbol, model: this.deps.config.get('ANALYSIS_MODEL'), promptVersion: PROMPT_VERSION };
  }

  private cacheCutoff(now: number): string {
    return toSqlTimestamp(new Date(now - this.deps.config.get('ANALYSIS_CACHE_TTL_MS')));
  }
}

/** How a request ended: with an analysis, or still generating when the wait ran out. */
type Resolved = { kind: 'done'; analysis: StockAnalysis; source: AnalysisSource } | { kind: 'pending' };

function flightKeyOf(key: AnalysisKey): string {
  return `${key.symbol}|${key.promptVersion}|${key.model}`;
}

function retryField(seconds: number | undefined): { retryAfterSeconds?: number } {
  return seconds === undefined ? {} : { retryAfterSeconds: seconds };
}

/** A failed attempt to record; usage fields are known only when the model answered. */
type FailedAttempt = AnalysisKey & {
  generatedBy: string;
  priceAtAnalysis: number;
  durationMs: number;
  reportedModel?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
};

const couldNotGenerate = "Couldn't generate an analysis. This didn't use one of your analyses.";

function disabled(): AnalysisError {
  return new AnalysisError('ANALYSIS_DISABLED', 503, 'Stock analysis is not configured on this server.');
}

function unavailable(until: number, now: number = Date.now()): AnalysisError {
  return new AnalysisError(
    'ANALYSIS_UNAVAILABLE',
    503,
    'Analysis is temporarily unavailable.',
    secondsUntil(until, now),
  );
}

function secondsUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / 1000));
}

function toAnalysisError(err: LlmError, pausedUntil: number | undefined): AnalysisError {
  if (err.scope === 'feature' || err.code === 'ABORTED') {
    return unavailable(pausedUntil ?? Date.now() + FAILURE_COOLDOWN_MS);
  }
  if (err.code === 'TIMEOUT') {
    return new AnalysisError(
      'ANALYSIS_TIMEOUT',
      504,
      "The analysis took too long. Try again in a minute — it didn't use one of your analyses.",
    );
  }
  if (err.code === 'REFUSED') {
    return new AnalysisError('ANALYSIS_FAILED', 502, 'The model declined to analyze this stock.');
  }
  return new AnalysisError('ANALYSIS_FAILED', 502, couldNotGenerate);
}

/** Which optional inputs reached the prompt, for the span: e.g. `details,history`. */
function inputsPresent(input: { details?: unknown; features?: unknown; fundamentals?: unknown }): string {
  return (
    [input.details && 'details', input.features && 'history', input.fundamentals && 'fundamentals']
      .filter(Boolean)
      .join(',') || 'quote-only'
  );
}

/** Closed set for the `outcome` metric attribute. */
function outcomeOf(err: unknown): string {
  if (err instanceof AnalysisError) {
    switch (err.code) {
      case 'ANALYSIS_DISABLED':
        return 'disabled';
      case 'ANALYSIS_UNAVAILABLE':
        return 'unavailable';
      case 'ANALYSIS_CAPACITY':
        return 'capacity';
      case 'ANALYSIS_IN_PROGRESS':
        return 'in_progress';
      case 'ANALYSIS_FAILED':
      case 'ANALYSIS_TIMEOUT':
        return 'failed';
    }
  }
  if (err instanceof LimitExceededError) return 'limited';
  return 'error';
}
