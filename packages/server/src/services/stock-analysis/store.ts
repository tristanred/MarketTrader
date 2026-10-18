import { and, count, desc, eq, gte, lt, min } from 'drizzle-orm';
import type { StockAnalysis } from '@markettrader/shared';
import type { Db } from '../../db/index.js';
import { schema } from '../../db/index.js';
import { toIsoUtc } from '../../limits/account.js';
import type { Reader } from '../../limits/quota-counts.js';
import { modelOutputSchema, type AnalysisResult } from './schema.js';

/** What makes two analyses interchangeable: same stock, same prompt, same configured model. */
export interface AnalysisKey {
  symbol: string;
  model: string;
  promptVersion: number;
}

const { stockAnalyses } = schema;

function keyMatches(key: AnalysisKey) {
  return and(
    eq(stockAnalyses.symbol, key.symbol),
    eq(stockAnalyses.promptVersion, key.promptVersion),
    eq(stockAnalyses.model, key.model),
  );
}

/**
 * Newest successful analysis for `key` created at or after `since` (a
 * `toSqlTimestamp` value), or undefined. A row whose stored result no longer
 * validates is treated as absent — schema drift degrades to a cache miss.
 */
export async function findFreshAnalysis(
  db: Reader,
  key: AnalysisKey,
  since: string,
): Promise<StockAnalysis | undefined> {
  const [row] = await db
    .select()
    .from(stockAnalyses)
    .where(and(keyMatches(key), eq(stockAnalyses.status, 'ok'), gte(stockAnalyses.createdAt, since)))
    .orderBy(desc(stockAnalyses.createdAt))
    .limit(1);
  if (!row?.result) return undefined;
  const result = parseResult(row.result);
  if (!result) return undefined;
  return {
    symbol: row.symbol,
    ...result,
    generatedAt: toIsoUtc(row.createdAt),
    reportedModel: row.reportedModel,
    priceAtAnalysis: Number(row.priceAtAnalysis),
  };
}

/** Status and ISO creation time of the newest attempt for `key`, success or failure. */
export async function latestAttempt(
  db: Reader,
  key: AnalysisKey,
): Promise<{ status: 'ok' | 'failed'; createdAt: string } | undefined> {
  const [row] = await db
    .select({ status: stockAnalyses.status, createdAt: stockAnalyses.createdAt })
    .from(stockAnalyses)
    .where(keyMatches(key))
    .orderBy(desc(stockAnalyses.createdAt))
    .limit(1);
  return row ? { status: row.status, createdAt: toIsoUtc(row.createdAt) } : undefined;
}

/** Attempts by anyone, ok or failed, at or after `since`: what the global ceiling counts. */
export async function countAttemptsSince(db: Reader, since: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(stockAnalyses)
    .where(gte(stockAnalyses.createdAt, since));
  return Number(row?.n ?? 0);
}

/** ISO time of the oldest attempt at or after `since`; null when none. */
export async function oldestAttemptSince(db: Reader, since: string): Promise<string | null> {
  const [row] = await db
    .select({ at: min(stockAnalyses.createdAt) })
    .from(stockAnalyses)
    .where(gte(stockAnalyses.createdAt, since));
  return row?.at ? toIsoUtc(row.at) : null;
}

/**
 * One attempt to record. `result` is set exactly when `status` is `ok`; the usage
 * fields are known only when the model answered.
 */
export type AttemptRecord = AnalysisKey & {
  generatedBy: string;
  priceAtAnalysis: number;
  durationMs: number;
  reportedModel?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
} & ({ status: 'ok'; result: AnalysisResult } | { status: 'failed'; errorCode: string });

/** Inserts one attempt and returns its ISO creation time. */
export async function recordAttempt(db: Db, rec: AttemptRecord): Promise<string> {
  const [row] = await db
    .insert(stockAnalyses)
    .values({
      symbol: rec.symbol,
      model: rec.model,
      promptVersion: rec.promptVersion,
      generatedBy: rec.generatedBy,
      reportedModel: rec.reportedModel ?? null,
      priceAtAnalysis: rec.priceAtAnalysis,
      promptTokens: rec.promptTokens ?? null,
      completionTokens: rec.completionTokens ?? null,
      durationMs: rec.durationMs,
      status: rec.status,
      result: rec.status === 'ok' ? JSON.stringify(rec.result) : null,
      errorCode: rec.status === 'failed' ? rec.errorCode : null,
    })
    .returning({ createdAt: stockAnalyses.createdAt });
  return row ? toIsoUtc(row.createdAt) : new Date().toISOString();
}

/** Deletes attempts created before `cutoff` (a `toSqlTimestamp` value). */
export async function pruneAttemptsBefore(db: Db, cutoff: string): Promise<void> {
  await db.delete(stockAnalyses).where(lt(stockAnalyses.createdAt, cutoff));
}

function parseResult(json: string): AnalysisResult | undefined {
  try {
    const parsed = modelOutputSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
