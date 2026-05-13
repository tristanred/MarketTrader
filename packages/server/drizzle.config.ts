import { defineConfig } from 'drizzle-kit';

const rawUrl = process.env['DATABASE_URL'] ?? './dev.db';
const isPg = rawUrl.startsWith('postgres');

function normalizeLibsqlUrl(url: string): string {
  if (url === ':memory:') return url;
  if (url.startsWith('file:') || url.startsWith('libsql:') || url.startsWith('http:') || url.startsWith('https:') || url.startsWith('ws:') || url.startsWith('wss:')) {
    return url;
  }
  return `file:${url}`;
}

export default defineConfig({
  schema: isPg ? './src/db/schema.pg.ts' : './src/db/schema.sqlite.ts',
  out: isPg ? './drizzle/pg' : './drizzle/sqlite',
  dialect: isPg ? 'postgresql' : 'turso',
  dbCredentials: { url: isPg ? rawUrl : normalizeLibsqlUrl(rawUrl) },
});
