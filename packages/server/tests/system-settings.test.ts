import { describe, expect, it, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SystemSettingsService } from '../src/services/system-settings.js';
import type { Db } from '../src/db/index.js';
import { schema } from '../src/db/index.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));

async function makeDb(): Promise<Db> {
  // `file::memory:?cache=shared` is the only libsql in-memory URL that
  // lets pool connections share state — required for db.transaction() to
  // see the migrated schema. The shared DB persists across tests in the
  // same vitest worker, so the suite truncates system_settings in
  // beforeEach instead of building a fresh DB per test.
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  await migrate(db, {
    migrationsFolder: path.resolve(__dir, '..', 'drizzle', 'sqlite'),
  });
  return db as unknown as Db;
}

describe('SystemSettingsService', () => {
  let db: Db;
  let svc: SystemSettingsService;

  beforeEach(async () => {
    db = await makeDb();
    // The shared in-memory DB persists across tests; truncate so each test
    // starts from an empty system_settings table.
    await db.delete(schema.systemSettings);
    svc = new SystemSettingsService(db);
  });

  it('returns null when key is missing', async () => {
    expect(await svc.getTickerTapeSymbols()).toBeNull();
  });

  it('seeds the default tape on first call to ensureSeeded', async () => {
    await svc.ensureSeeded();
    const tape = await svc.getTickerTapeSymbols();
    expect(tape).not.toBeNull();
    expect(tape!.symbols).toContain('^GSPC');
    expect(tape!.symbols).toContain('AAPL');
    expect(tape!.symbols.length).toBeGreaterThanOrEqual(8);
  });

  it('ensureSeeded is idempotent — does not overwrite existing config', async () => {
    await svc.setTickerTapeSymbols(['CUSTOM'], 'user-1');
    await svc.ensureSeeded();
    const tape = await svc.getTickerTapeSymbols();
    expect(tape!.symbols).toEqual(['CUSTOM']);
  });

  it('persists symbols on setTickerTapeSymbols', async () => {
    await svc.setTickerTapeSymbols(['AAPL', 'NVDA'], 'admin-42');
    const tape = await svc.getTickerTapeSymbols();
    expect(tape!.symbols).toEqual(['AAPL', 'NVDA']);
    expect(tape!.updatedAt).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('uppercases and trims symbols on write', async () => {
    await svc.setTickerTapeSymbols(['  aapl ', 'msft'], 'user');
    const tape = await svc.getTickerTapeSymbols();
    expect(tape!.symbols).toEqual(['AAPL', 'MSFT']);
  });

  it('silently drops whitespace-only entries', async () => {
    await svc.setTickerTapeSymbols(['  ', 'AAPL'], 'user');
    const tape = await svc.getTickerTapeSymbols();
    expect(tape!.symbols).toEqual(['AAPL']);
  });

  it('rejects an empty list', async () => {
    await expect(svc.setTickerTapeSymbols([], 'user')).rejects.toThrow(/empty/i);
  });

  it('emits a change event after setTickerTapeSymbols', async () => {
    const events: string[][] = [];
    svc.on('change', (symbols) => events.push(symbols));
    await svc.setTickerTapeSymbols(['AAPL'], 'user');
    await svc.setTickerTapeSymbols(['MSFT'], 'user');
    expect(events).toEqual([['AAPL'], ['MSFT']]);
  });

  it('emits a change event on first ensureSeeded', async () => {
    const events: string[][] = [];
    svc.on('change', (s) => events.push(s));
    await svc.ensureSeeded();
    expect(events.length).toBe(1);
    expect(events[0]).toContain('^GSPC');
  });

  it('setTickerTapeSymbolsInTx rolls back when the surrounding tx fails', async () => {
    await expect(
      db.transaction(async (tx) => {
        await svc.setTickerTapeSymbolsInTx(tx, ['CUSTOM-TX'], 'tx-user');
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    const after = await svc.getTickerTapeSymbols();
    expect(after).toBeNull();
  });

  it('setTickerTapeSymbolsInTx persists + emits when the tx commits', async () => {
    const events: string[][] = [];
    svc.on('change', (s) => events.push(s));
    await db.transaction(async (tx) => {
      await svc.setTickerTapeSymbolsInTx(tx, ['  msft ', 'AAPL'], 'admin-1');
    });
    const after = await svc.getTickerTapeSymbols();
    expect(after!.symbols).toEqual(['MSFT', 'AAPL']);
    expect(events).toEqual([['MSFT', 'AAPL']]);
  });
});
