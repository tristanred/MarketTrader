import { defineConfig } from 'drizzle-kit';

const url = process.env['DATABASE_URL'] ?? './dev.db';
const isPg = url.startsWith('postgres');

export default defineConfig({
  schema: isPg ? './src/db/schema.pg.ts' : './src/db/schema.sqlite.ts',
  out: './drizzle',
  dialect: isPg ? 'postgresql' : 'sqlite',
  dbCredentials: { url },
});
