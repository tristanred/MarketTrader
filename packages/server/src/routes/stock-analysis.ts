import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type {
  AnalysisErrorBody,
  StockAnalysisPending,
  StockAnalysisResponse,
  StockAnalysisStatus,
} from '@markettrader/shared';
import type { ConfigReader } from '../config/runtime-config.js';
import { withPrivilegedIp } from '../limits/rate.js';
import { StockProviderError } from '../providers/index.js';
import {
  AnalysisError,
  type AnalysisCaller,
  type StockAnalysisService,
} from '../services/stock-analysis/service.js';
import { setRetryAfter } from './retry-after.js';
import { symbolParamsSchema } from './stocks.js';

/**
 * Registers the LLM stock-analysis routes (authenticated):
 * - `GET  /stocks/:symbol/analysis/status` — enabled/available, whether a cached analysis exists, and the caller's allowance.
 * - `POST /stocks/:symbol/analysis` — the cached analysis, or a fresh one (spends one of the caller's daily allowance).
 *   202 `{ status: 'generating' }` when the model has not answered within `ANALYSIS_RESPONSE_WAIT_MS`.
 *
 * Refusals: 409 one already running, 429 `LIMIT_EXCEEDED` (via the root limit handler),
 * 503 disabled/unavailable/capacity, 502 generation failed, 504 timeout. Price-provider
 * errors map as on the stock routes (404/429/502).
 */
export function stockAnalysisRoutes(service: StockAnalysisService, config: ConfigReader) {
  return async function (rawApp: FastifyInstance): Promise<void> {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();

    app.get(
      '/stocks/:symbol/analysis/status',
      {
        onRequest: rawApp.authenticate,
        schema: {
          tags: ['Stocks'],
          summary: 'Whether an analysis can be requested for a symbol, and the caller’s daily allowance.',
          security: [{ bearerAuth: [] }],
          params: symbolParamsSchema,
        },
      },
      async (request, reply) => {
        const status: StockAnalysisStatus = await service.status(callerOf(request), request.params.symbol);
        return reply.send(status);
      },
    );

    app.post(
      '/stocks/:symbol/analysis',
      {
        onRequest: rawApp.authenticate,
        // Second layer under the per-user daily quota, as on every user-reachable route.
        config: { rateLimit: withPrivilegedIp(config, { max: 20, timeWindow: '1 minute' }) },
        schema: {
          tags: ['Stocks'],
          summary: 'LLM buy/hold/sell analysis of a symbol; cached and shared across users.',
          security: [{ bearerAuth: [] }],
          params: symbolParamsSchema,
        },
      },
      async (request, reply) => {
        try {
          const body: StockAnalysisResponse | StockAnalysisPending = await service.analyze(
            callerOf(request),
            request.params.symbol,
          );
          // 202: the model is still working; the client polls the status route.
          return reply.status('status' in body ? 202 : 200).send(body);
        } catch (err) {
          if (err instanceof AnalysisError) return sendAnalysisError(reply, err);
          if (err instanceof StockProviderError) {
            if (err.code === 'SYMBOL_NOT_FOUND') return reply.status(404).send({ error: err.message });
            if (err.code === 'RATE_LIMITED') {
              setRetryAfter(reply, config);
              return reply.status(429).send({ code: err.code, message: err.message });
            }
            return reply.status(502).send({ error: err.message });
          }
          throw err;
        }
      },
    );
  };
}

function callerOf(request: FastifyRequest): AnalysisCaller {
  // `authenticate` sets the account on every request that reaches a handler.
  if (!request.account) throw new Error('stock-analysis route reached without an account');
  return { ip: request.ip, account: request.account };
}

function sendAnalysisError(reply: FastifyReply, err: AnalysisError) {
  if (err.retryAfterSeconds !== undefined) reply.header('Retry-After', err.retryAfterSeconds);
  const body: AnalysisErrorBody = {
    error: err.message,
    code: err.code,
    ...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
  };
  return reply.status(err.status).send(body);
}
