import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../src/db/schema.sqlite.js';
import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';
import type { StockProvider } from '../../src/providers/index.js';
import { MockStockProvider } from './mock-provider.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dir, '../../drizzle');

export function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}

export async function createTestApp(provider?: StockProvider): Promise<FastifyInstance> {
  const db = createTestDb();
  return buildApp({ logger: false, db, provider: provider ?? new MockStockProvider() });
}
