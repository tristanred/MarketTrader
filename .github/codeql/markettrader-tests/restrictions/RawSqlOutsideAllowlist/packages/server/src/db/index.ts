import { drizzle } from 'drizzle-orm/libsql';

declare const env: { SQLITE_BUSY_TIMEOUT_MS: number };

export async function createDatabase(url: string) {
  const { createClient } = await import('@libsql/client');
  const client = createClient({ url });
  await client.execute('PRAGMA foreign_keys = ON'); // OK: allowlisted PRAGMA
  await client.execute('PRAGMA journal_mode = WAL'); // OK
  await client.execute(`PRAGMA busy_timeout = ${env.SQLITE_BUSY_TIMEOUT_MS}`); // OK
  await client.execute('DELETE FROM sessions'); // BAD: not a PRAGMA
  return drizzle(client);
}
