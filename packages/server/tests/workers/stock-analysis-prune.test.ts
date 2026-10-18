import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/app.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';
import { schema } from '../../src/db/index.js';
import { toSqlTimestamp } from '../../src/limits/quota-counts.js';
import { runAnalysisPruneTick } from '../../src/workers/stock-analysis-prune.js';
import { CONFIG_REGISTRY } from '../../src/config/registry.js';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-10-17T12:00:00Z');

type Db = Awaited<ReturnType<typeof createTestDb>>;

async function insertAged(db: Db, symbol: string, ageMs: number) {
  await db.insert(schema.stockAnalyses).values({
    symbol,
    model: 'openrouter/free',
    promptVersion: 1,
    status: 'ok',
    result: '{}',
    priceAtAnalysis: 1,
    durationMs: 1,
    createdAt: toSqlTimestamp(new Date(NOW.getTime() - ageMs)),
  });
}

async function symbols(db: Db): Promise<string[]> {
  const rows = await db.select({ s: schema.stockAnalyses.symbol }).from(schema.stockAnalyses);
  return rows.map((r) => r.s).sort();
}

describe('stock-analysis prune worker', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
    await db.delete(schema.stockAnalyses);
  });

  it('deletes rows past ANALYSIS_RETENTION_DAYS and keeps the rest', async () => {
    await insertAged(db, 'OLD', 31 * DAY_MS);
    await insertAged(db, 'KEEP', 29 * DAY_MS);
    const config = RuntimeConfig.fromEnvironment({ ANALYSIS_RETENTION_DAYS: 30 });
    await runAnalysisPruneTick({ db, config, now: () => NOW });
    expect(await symbols(db)).toEqual(['KEEP']);
  });

  it('never prunes inside the cache TTL, even if retention says so', async () => {
    await insertAged(db, 'CACHED', 9 * DAY_MS);
    const config = RuntimeConfig.fromEnvironment({ ANALYSIS_RETENTION_DAYS: 8 });
    // Simulates an env value the registry bounds would refuse as an override.
    config.set('ANALYSIS_CACHE_TTL_MS', 7 * DAY_MS);
    await runAnalysisPruneTick({ db, config, now: () => NOW });
    expect(await symbols(db)).toEqual([]);

    await insertAged(db, 'CACHED', 6 * DAY_MS);
    await runAnalysisPruneTick({ db, config, now: () => NOW });
    expect(await symbols(db)).toEqual(['CACHED']);
  });

  it('keeps the retention floor above the TTL ceiling in the registry', () => {
    const retentionMinMs = CONFIG_REGISTRY.ANALYSIS_RETENTION_DAYS.min * DAY_MS;
    expect(retentionMinMs).toBeGreaterThan(CONFIG_REGISTRY.ANALYSIS_CACHE_TTL_MS.max);
  });
});
