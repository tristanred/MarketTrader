import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type {
  AnalysisErrorBody,
  LimitExceededBody,
  StockAnalysisResponse,
  StockAnalysisStatus,
} from '@markettrader/shared';
import { createTestAppWithDb, registerAdmin } from '../helpers/app.js';
import { ageAccount, registerUser } from '../helpers/users.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { FakeLlmClient, completion, deferred, validAnswer } from '../helpers/fake-llm.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { schema } from '../../src/db/index.js';
import { LlmError } from '../../src/providers/llm/interface.js';
import type { AnalyticsClient } from '../../src/observability/posthog.js';

type Db = Awaited<ReturnType<typeof createTestAppWithDb>>['db'];

const BASE_ENV = {
  LIMITS_PROBATION_PERCENT: 100,
  // Every account in this suite registers from the same inject IP.
  LIMIT_REGISTRATIONS_PER_IP_PER_DAY: 10_000,
  LIMIT_STOCK_ANALYSES_PER_DAY: 3,
  ANALYSIS_MAX_GENERATIONS_PER_DAY: 1_000,
};

let seq = 0;
const unique = (prefix: string) => `${prefix}${++seq}`;

describe('stock analysis routes', () => {
  let app: FastifyInstance;
  let db: Db;
  let config: RuntimeConfig;
  let llm: FakeLlmClient;
  let provider: MockStockProvider;

  async function build(opts: { llm?: FakeLlmClient | null; provider?: MockStockProvider } = {}) {
    llm = new FakeLlmClient();
    provider = opts.provider ?? new MockStockProvider();
    ({ app, db, config } = await createTestAppWithDb(provider, undefined, {
      limits: { disabled: false },
      runtimeConfig: RuntimeConfig.fromEnvironment(BASE_ENV),
      llmClient: opts.llm === undefined ? llm : opts.llm,
    }));
    // The in-memory database is shared across this file; start each test from an empty ledger.
    await db.delete(schema.stockAnalyses);
  }

  async function user(mature = true) {
    const u = await registerUser(app, unique('analyst'));
    if (mature) await ageAccount(db, u.userId, 30);
    return u;
  }

  const analyze = (token: string, symbol: string) =>
    app.inject({ method: 'POST', url: `/stocks/${symbol}/analysis`, headers: { authorization: `Bearer ${token}` } });
  const status = (token: string, symbol: string) =>
    app.inject({ method: 'GET', url: `/stocks/${symbol}/analysis/status`, headers: { authorization: `Bearer ${token}` } });
  const rows = () => db.select().from(schema.stockAnalyses);

  beforeEach(async () => {
    await build();
  });
  afterEach(async () => {
    await app.close();
  });

  describe('disabled and auth', () => {
    it('answers 503 ANALYSIS_DISABLED and reports enabled:false without an LLM', async () => {
      await app.close();
      await build({ llm: null });
      const u = await user();
      const res = await analyze(u.token, 'AAPL');
      expect(res.statusCode).toBe(503);
      expect(res.json<AnalysisErrorBody>().code).toBe('ANALYSIS_DISABLED');
      const s = await status(u.token, 'AAPL');
      expect(s.statusCode).toBe(200);
      expect(s.json<StockAnalysisStatus>()).toMatchObject({ enabled: false, available: false, cached: false });
    });

    it('requires authentication', async () => {
      expect((await app.inject({ method: 'POST', url: '/stocks/AAPL/analysis' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/stocks/AAPL/analysis/status' })).statusCode).toBe(401);
    });

    it('404s an unknown symbol without calling the model or charging', async () => {
      const u = await user();
      provider.setError('NOPE', 'SYMBOL_NOT_FOUND');
      expect((await analyze(u.token, 'NOPE')).statusCode).toBe(404);
      expect(llm.calls).toHaveLength(0);
      expect(await rows()).toHaveLength(0);
    });

    it('rejects an over-long symbol at the route', async () => {
      const u = await user();
      expect((await analyze(u.token, 'WAYTOOLONGSYMBOL')).statusCode).toBe(400);
    });
  });

  describe('generation and cache', () => {
    it('generates, records an ok row, upper-cases the symbol, and spends one analysis', async () => {
      const u = await user();
      const res = await analyze(u.token, 'aapl');
      expect(res.statusCode).toBe(200);
      const body = res.json<StockAnalysisResponse>();
      expect(body.source).toBe('generated');
      expect(body.analysis).toMatchObject({
        symbol: 'AAPL',
        verdict: 'BUY',
        confidence: 72,
        reportedModel: 'vendor/backing-model:free',
        priceAtAnalysis: 100,
      });
      expect(body.usage).toMatchObject({ limit: 3, used: 1, remaining: 2, probation: false });
      expect(body.usage.nextSlotAt).not.toBeNull();

      const [row] = await rows();
      expect(row).toMatchObject({ symbol: 'AAPL', status: 'ok', generatedBy: u.userId, model: 'openrouter/free' });
      expect(llm.calls[0]!.model).toBe('openrouter/free');
      expect(llm.calls[0]!.user).toContain('Analyze AAPL');
    });

    it('serves every later request from the shared cache for free, even at the limit', async () => {
      const a = await user();
      const b = await user();
      await analyze(a.token, 'MSFT');
      config.set('LIMIT_STOCK_ANALYSES_PER_DAY', 1);

      const second = await analyze(b.token, 'MSFT');
      expect(second.statusCode).toBe(200);
      expect(second.json<StockAnalysisResponse>().source).toBe('cache');
      expect(second.json<StockAnalysisResponse>().usage.used).toBe(0);
      // a is now at the limit and still gets the cached result.
      expect((await analyze(a.token, 'MSFT')).json<StockAnalysisResponse>().source).toBe('cache');
      expect(llm.calls).toHaveLength(1);
      expect(await rows()).toHaveLength(1);

      const s = await status(b.token, 'MSFT');
      expect(s.json<StockAnalysisStatus>()).toMatchObject({ enabled: true, available: true, cached: true });
      expect((await status(b.token, 'OTHER')).json<StockAnalysisStatus>().cached).toBe(false);
    });

    it('regenerates once the cache TTL has passed', async () => {
      const u = await user();
      await analyze(u.token, 'NVDA');
      await db.update(schema.stockAnalyses).set({ createdAt: '2000-01-01 00:00:00' });
      const again = await analyze(u.token, 'NVDA');
      expect(again.json<StockAnalysisResponse>().source).toBe('generated');
      expect(llm.calls).toHaveLength(2);
    });

    it('starts a fresh cache when the configured model changes', async () => {
      const u = await user();
      await analyze(u.token, 'AMD');
      config.set('ANALYSIS_MODEL', 'vendor/other-model');
      const again = await analyze(u.token, 'AMD');
      expect(again.json<StockAnalysisResponse>().source).toBe('generated');
      expect(llm.calls[1]!.model).toBe('vendor/other-model');
    });

    it('treats a stored result that no longer validates as a miss', async () => {
      const u = await user();
      await analyze(u.token, 'INTC');
      await db.update(schema.stockAnalyses).set({ result: '{"verdict":"MAYBE"}' });
      expect((await analyze(u.token, 'INTC')).json<StockAnalysisResponse>().source).toBe('generated');
    });

    it('keeps the cache when the generating account is deleted', async () => {
      const a = await user();
      const b = await user();
      await analyze(a.token, 'ORCL');
      await db.delete(schema.users).where(eq(schema.users.id, a.userId));
      const [row] = await rows();
      expect(row!.generatedBy).toBeNull();
      expect((await analyze(b.token, 'ORCL')).json<StockAnalysisResponse>().source).toBe('cache');
    });
  });

  describe('inputs', () => {
    it('still analyzes with no history, details, or fundamentals, and says so', async () => {
      await app.close();
      await build({ provider: new MockStockProvider({ fundamentals: false }) });
      const u = await user();
      vi.spyOn(provider, 'getDetails').mockRejectedValue(new Error('down'));
      const res = await analyze(u.token, 'IBM');
      expect(res.statusCode).toBe(200);
      expect(llm.calls[0]!.user).toContain('<missing>details, price_history, fundamentals, company_profile</missing>');
    });

    it('feeds fundamentals when the provider has them', async () => {
      const u = await user();
      provider.setFundamentals('CRM', { sector: 'Software', trailingPE: 44.2 });
      await analyze(u.token, 'CRM');
      expect(llm.calls[0]!.user).toContain('"trailingPE":44.2');
      expect(llm.calls[0]!.user).toContain('Sector: Software');
    });

    it('tolerates a failing fundamentals call', async () => {
      const u = await user();
      provider.setFundamentalsError('SHOP', 'PROVIDER_ERROR');
      expect((await analyze(u.token, 'SHOP')).statusCode).toBe(200);
      expect(llm.calls[0]!.user).toContain('fundamentals, company_profile</missing>');
    });
  });

  describe('per-user quota', () => {
    it('refuses the fresh analysis past the limit with LIMIT_EXCEEDED and Retry-After', async () => {
      const u = await user();
      for (const s of ['A1', 'A2', 'A3']) expect((await analyze(u.token, s)).statusCode).toBe(200);
      const over = await analyze(u.token, 'A4');
      expect(over.statusCode).toBe(429);
      const body = over.json<LimitExceededBody>();
      expect(body).toMatchObject({ code: 'LIMIT_EXCEEDED', limit: 'stockAnalyses', max: 3 });
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
      expect(body.retryAfterSeconds).toBe(Number(over.headers['retry-after']));
      expect(llm.calls).toHaveLength(3);

      const s = (await status(u.token, 'A4')).json<StockAnalysisStatus>();
      expect(s.usage).toMatchObject({ limit: 3, used: 3, remaining: 0 });
    });

    it('frees a slot once the oldest analysis leaves the 24 h window', async () => {
      const u = await user();
      for (const s of ['B1', 'B2', 'B3']) await analyze(u.token, s);
      const old = new Date(Date.now() - 25 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
      const [first] = await rows();
      await db.update(schema.stockAnalyses).set({ createdAt: old }).where(eq(schema.stockAnalyses.id, first!.id));
      expect((await analyze(u.token, 'B4')).statusCode).toBe(200);
    });

    it('gives a new account the probation share', async () => {
      config.set('LIMITS_PROBATION_PERCENT', 34);
      const u = await user(false);
      const s = (await status(u.token, 'X')).json<StockAnalysisStatus>();
      expect(s.usage).toMatchObject({ limit: 2, probation: true });
    });

    it('applies a per-user override and exempts admins', async () => {
      const admin = await registerAdmin(app, unique('boss'));
      const u = await user();
      await app.limits.overrides.set(admin.userId, u.userId, 'stockAnalyses', 1, 'test');
      await analyze(u.token, 'C1');
      expect((await analyze(u.token, 'C2')).statusCode).toBe(429);

      for (const s of ['C3', 'C4', 'C5', 'C6']) expect((await analyze(admin.token, s)).statusCode).toBe(200);
      const s = (await status(admin.token, 'C7')).json<StockAnalysisStatus>();
      expect(s.usage).toMatchObject({ limit: null, remaining: null });
    });

    it('lifts the per-user quota with LIMITS_ENABLED=false', async () => {
      config.set('LIMITS_ENABLED', false);
      const u = await user();
      for (const s of ['D1', 'D2', 'D3', 'D4']) expect((await analyze(u.token, s)).statusCode).toBe(200);
    });
  });

  describe('global ceiling', () => {
    it('refuses past ANALYSIS_MAX_GENERATIONS_PER_DAY, for admins and with limits off too', async () => {
      config.set('ANALYSIS_MAX_GENERATIONS_PER_DAY', 2);
      config.set('LIMITS_ENABLED', false);
      const admin = await registerAdmin(app, unique('boss'));
      await analyze(admin.token, 'E1');
      await analyze(admin.token, 'E2');
      const over = await analyze(admin.token, 'E3');
      expect(over.statusCode).toBe(503);
      expect(over.json<AnalysisErrorBody>()).toMatchObject({ code: 'ANALYSIS_CAPACITY' });
      expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
      // Cached results still flow.
      expect((await analyze(admin.token, 'E1')).statusCode).toBe(200);
      const s = (await status(admin.token, 'E3')).json<StockAnalysisStatus>();
      expect(s).toMatchObject({ available: false });
      expect(s.retryAt).not.toBeNull();
    });

    it('counts failed attempts toward the ceiling', async () => {
      config.set('ANALYSIS_MAX_GENERATIONS_PER_DAY', 1);
      const u = await user();
      llm.queue(completion('not an object'));
      expect((await analyze(u.token, 'F1')).statusCode).toBe(502);
      expect((await analyze(u.token, 'F2')).json<AnalysisErrorBody>().code).toBe('ANALYSIS_CAPACITY');
    });
  });

  describe('failures', () => {
    it('records an invalid answer as a failed row, charges nothing, and cools the symbol down', async () => {
      const u = await user();
      llm.queue(completion(validAnswer({ verdict: 'STRONG BUY' })));
      const res = await analyze(u.token, 'G1');
      expect(res.statusCode).toBe(502);
      expect(res.json<AnalysisErrorBody>().code).toBe('ANALYSIS_FAILED');
      const [row] = await rows();
      expect(row).toMatchObject({ status: 'failed', errorCode: 'INVALID_OUTPUT', result: null });

      const s = (await status(u.token, 'G1')).json<StockAnalysisStatus>();
      expect(s.usage.used).toBe(0);
      const cooled = await analyze(u.token, 'G1');
      expect(cooled.statusCode).toBe(503);
      expect(cooled.json<AnalysisErrorBody>().code).toBe('ANALYSIS_UNAVAILABLE');
      expect(llm.calls).toHaveLength(1);
      // Other symbols are unaffected.
      expect((await analyze(u.token, 'G2')).statusCode).toBe(200);
    });

    it('lets the symbol retry once the cooldown has passed', async () => {
      const u = await user();
      llm.queue(new LlmError('TRUNCATED', 'cut off', { reachedModel: true }));
      expect((await analyze(u.token, 'H1')).statusCode).toBe(502);
      await db.update(schema.stockAnalyses).set({ createdAt: '2000-01-01 00:00:00' });
      expect((await analyze(u.token, 'H1')).statusCode).toBe(200);
    });

    it('maps a timeout to 504 and records it', async () => {
      const u = await user();
      llm.queue(new LlmError('TIMEOUT', 'slow', { reachedModel: true }));
      const res = await analyze(u.token, 'J1');
      expect(res.statusCode).toBe(504);
      expect(res.json<AnalysisErrorBody>().code).toBe('ANALYSIS_TIMEOUT');
      expect((await rows())[0]).toMatchObject({ status: 'failed', errorCode: 'TIMEOUT' });
    });

    it('writes no row for a failure that never reached a model', async () => {
      const u = await user();
      llm.queue(new LlmError('UPSTREAM_ERROR', 'network', { reachedModel: false }));
      expect((await analyze(u.token, 'K1')).statusCode).toBe(502);
      expect(await rows()).toHaveLength(0);
    });

    it.each([
      ['NO_CREDITS', undefined],
      ['RATE_LIMITED', 45_000],
      ['AUTH', undefined],
      ['SPEND_LIMIT', 7_200_000],
    ] as const)('pauses the feature for everyone on %s', async (code, retryAfterMs) => {
      const a = await user();
      const b = await user();
      await analyze(a.token, 'CACHED');
      llm.queue(new LlmError(code, code, { reachedModel: false, retryAfterMs }));

      const first = await analyze(a.token, 'L1');
      expect(first.statusCode).toBe(503);
      expect(first.json<AnalysisErrorBody>().code).toBe('ANALYSIS_UNAVAILABLE');
      const retry = Number(first.headers['retry-after']);
      if (retryAfterMs) expect(retry).toBe(retryAfterMs / 1000);
      else expect(retry).toBeGreaterThan(60);

      // A different user and a different symbol: refused without another call.
      const second = await analyze(b.token, 'L2');
      expect(second.statusCode).toBe(503);
      expect(llm.calls).toHaveLength(2);
      // Cached results still work during the outage, and status explains it.
      expect((await analyze(b.token, 'CACHED')).statusCode).toBe(200);
      const s = (await status(b.token, 'L2')).json<StockAnalysisStatus>();
      expect(s).toMatchObject({ enabled: true, available: false, cached: false });
      expect(Date.parse(s.retryAt!)).toBeGreaterThan(Date.now());
      expect(await rows()).toHaveLength(1);
    });

    it('lifts a bad-request pause when the admin changes the model', async () => {
      const u = await user();
      llm.queue(new LlmError('BAD_REQUEST', 'bad model', { reachedModel: false }));
      expect((await analyze(u.token, 'M1')).statusCode).toBe(503);
      expect((await analyze(u.token, 'M1')).statusCode).toBe(503);
      config.set('ANALYSIS_MODEL', 'vendor/fixed-model');
      expect((await analyze(u.token, 'M1')).statusCode).toBe(200);
    });

    it('maps a moderation refusal to 502 without pausing the feature', async () => {
      const u = await user();
      llm.queue(new LlmError('REFUSED', 'flagged', { reachedModel: true }));
      const res = await analyze(u.token, 'N1');
      expect(res.statusCode).toBe(502);
      expect(res.json<AnalysisErrorBody>().error).toMatch(/declined/);
      expect((await analyze(u.token, 'N2')).statusCode).toBe(200);
    });
  });

  describe('concurrency', () => {
    it('runs one generation for concurrent requests on one symbol and charges only the leader', async () => {
      const a = await user();
      const b = await user();
      const gate = deferred<void>();
      llm.queue(async () => {
        await gate.promise;
        return completion(validAnswer());
      });
      const first = analyze(a.token, 'P1');
      await vi.waitFor(() => expect(llm.calls).toHaveLength(1));
      const second = analyze(b.token, 'P1');
      // Let the second request reach the in-flight join before releasing the model.
      await new Promise((r) => setTimeout(r, 20));
      gate.resolve();

      const [ra, rb] = await Promise.all([first, second]);
      expect(ra.json<StockAnalysisResponse>().source).toBe('generated');
      expect(rb.json<StockAnalysisResponse>().source).toBe('shared');
      expect(rb.json<StockAnalysisResponse>().usage.used).toBe(0);
      expect(llm.calls).toHaveLength(1);
      expect(await rows()).toHaveLength(1);
    });

    it('refuses a second fresh analysis from the same user while one runs, with 409', async () => {
      const u = await user();
      const gate = deferred<void>();
      llm.queue(async () => {
        await gate.promise;
        return completion(validAnswer());
      });
      const first = analyze(u.token, 'Q1');
      await vi.waitFor(() => expect(llm.calls).toHaveLength(1));
      const second = await analyze(u.token, 'Q2');
      expect(second.statusCode).toBe(409);
      expect(second.json<AnalysisErrorBody>().code).toBe('ANALYSIS_IN_PROGRESS');
      gate.resolve();
      expect((await first).statusCode).toBe(200);
      expect((await analyze(u.token, 'Q2')).statusCode).toBe(200);
    });

    it('counts an in-flight generation against the global ceiling', async () => {
      config.set('ANALYSIS_MAX_GENERATIONS_PER_DAY', 1);
      const a = await user();
      const b = await user();
      const gate = deferred<void>();
      llm.queue(async () => {
        await gate.promise;
        return completion(validAnswer());
      });
      const first = analyze(a.token, 'R1');
      await vi.waitFor(() => expect(llm.calls).toHaveLength(1));
      expect((await analyze(b.token, 'R2')).json<AnalysisErrorBody>().code).toBe('ANALYSIS_CAPACITY');
      gate.resolve();
      await first;
    });

    describe('slow generations (202 + polling)', () => {
      function gated(outcome: () => Promise<ReturnType<typeof completion>>) {
        const gate = deferred<void>();
        llm.queue(async () => {
          await gate.promise;
          return outcome();
        });
        return gate;
      }

      it('answers 202 when the model is slow, then serves the result from the cache', async () => {
        config.set('ANALYSIS_RESPONSE_WAIT_MS', 1_000);
        const u = await user();
        const gate = gated(async () => completion(validAnswer({ verdict: 'SELL' })));

        const first = await analyze(u.token, 'T1');
        expect(first.statusCode).toBe(202);
        expect(first.json()).toMatchObject({ status: 'generating', usage: { used: 0 } });
        expect((await status(u.token, 'T1')).json<StockAnalysisStatus>()).toMatchObject({
          generating: true,
          cached: false,
          lastFailure: null,
        });

        gate.resolve();
        await vi.waitFor(async () =>
          expect((await status(u.token, 'T1')).json<StockAnalysisStatus>()).toMatchObject({
            generating: false,
            cached: true,
          }),
        );
        const again = await analyze(u.token, 'T1');
        expect(again.statusCode).toBe(200);
        expect(again.json<StockAnalysisResponse>()).toMatchObject({
          source: 'cache',
          analysis: { verdict: 'SELL' },
          usage: { used: 1 },
        });
        expect(llm.calls).toHaveLength(1);
      });

      it('keeps the user busy until the generation ends, not just the request', async () => {
        config.set('ANALYSIS_RESPONSE_WAIT_MS', 1_000);
        config.set('LIMIT_STOCK_ANALYSES_PER_DAY', 1);
        const u = await user();
        const gate = gated(async () => completion(validAnswer()));

        expect((await analyze(u.token, 'U1')).statusCode).toBe(202);
        // Without the busy mark this would pass the quota count (no ok row yet) and overspend.
        const second = await analyze(u.token, 'U2');
        expect(second.statusCode).toBe(409);
        expect(second.json<AnalysisErrorBody>().code).toBe('ANALYSIS_IN_PROGRESS');

        gate.resolve();
        await vi.waitFor(async () =>
          expect((await status(u.token, 'U1')).json<StockAnalysisStatus>().cached).toBe(true),
        );
        expect((await analyze(u.token, 'U2')).statusCode).toBe(429);
        expect(llm.calls).toHaveLength(1);
      });

      it('reports a background failure through status', async () => {
        config.set('ANALYSIS_RESPONSE_WAIT_MS', 1_000);
        const u = await user();
        const gate = gated(async () => {
          throw new LlmError('TIMEOUT', 'slow', { reachedModel: true });
        });

        expect((await analyze(u.token, 'V1')).statusCode).toBe(202);
        gate.resolve();
        await vi.waitFor(async () =>
          expect((await status(u.token, 'V1')).json<StockAnalysisStatus>().generating).toBe(false),
        );
        const s = (await status(u.token, 'V1')).json<StockAnalysisStatus>();
        expect(s.cached).toBe(false);
        expect(s.lastFailure).toMatchObject({ code: 'ANALYSIS_TIMEOUT' });
        expect(Date.parse(s.lastFailure!.failedAt)).toBeLessThanOrEqual(Date.now());
        expect(s.usage.used).toBe(0);
      });

      it('gives a joiner 202 too, and clears an old failure when a new generation starts', async () => {
        config.set('ANALYSIS_RESPONSE_WAIT_MS', 1_000);
        const a = await user();
        const b = await user();
        llm.queue(new LlmError('UPSTREAM_ERROR', 'x', { reachedModel: false }));
        expect((await analyze(a.token, 'W1')).statusCode).toBe(502);
        expect((await status(a.token, 'W1')).json<StockAnalysisStatus>().lastFailure).not.toBeNull();

        const gate = gated(async () => completion(validAnswer()));
        expect((await analyze(a.token, 'W1')).statusCode).toBe(202);
        expect((await status(a.token, 'W1')).json<StockAnalysisStatus>().lastFailure).toBeNull();
        expect((await analyze(b.token, 'W1')).statusCode).toBe(202);
        gate.resolve();
        await vi.waitFor(async () =>
          expect((await status(b.token, 'W1')).json<StockAnalysisStatus>().cached).toBe(true),
        );
        expect(llm.calls).toHaveLength(2);
      });
    });

    it('rejects joiners with the leader’s failure', async () => {
      const a = await user();
      const b = await user();
      const gate = deferred<void>();
      llm.queue(async () => {
        await gate.promise;
        throw new LlmError('INVALID_OUTPUT', 'bad', { reachedModel: true });
      });
      const first = analyze(a.token, 'S1');
      await vi.waitFor(() => expect(llm.calls).toHaveLength(1));
      const second = analyze(b.token, 'S1');
      await new Promise((r) => setTimeout(r, 20));
      gate.resolve();
      const [ra, rb] = await Promise.all([first, second]);
      expect(ra.statusCode).toBe(502);
      expect(rb.statusCode).toBe(502);
    });
  });
});

describe('stock analysis analytics', () => {
  it('captures stock_analysis_generated on a generation only', async () => {
    const events: Array<{ event: string; properties?: Record<string, unknown> }> = [];
    const analytics = {
      capture: (e: { event: string; properties?: Record<string, unknown> }) => events.push(e),
      shutdown: async () => {},
    };
    const { createTestDb } = await import('../helpers/app.js');
    const { buildApp } = await import('../../src/app.js');
    const db = await createTestDb();
    await db.delete(schema.stockAnalyses);
    const app = await buildApp({
      logger: false,
      db,
      provider: new MockStockProvider(),
      disablePoller: true,
      disableRateLimit: true,
      loginThrottle: { disabled: true },
      limits: { disabled: true },
      analytics: analytics as unknown as AnalyticsClient,
      llmClient: new FakeLlmClient(),
    });
    try {
      const u = await registerUser(app, unique('tracked'));
      const headers = { authorization: `Bearer ${u.token}` };
      await app.inject({ method: 'POST', url: '/stocks/TSLA/analysis', headers });
      await app.inject({ method: 'POST', url: '/stocks/TSLA/analysis', headers });
      await vi.waitFor(() => expect(events.some((e) => e.event === 'stock_analysis_generated')).toBe(true));
      const generated = events.filter((e) => e.event === 'stock_analysis_generated');
      expect(generated).toHaveLength(1);
      expect(generated[0]!.properties).toMatchObject({ symbol: 'TSLA', verdict: 'BUY', model: 'openrouter/free' });
    } finally {
      await app.close();
    }
  });
});
