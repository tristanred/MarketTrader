#!/usr/bin/env node
import { readFile, writeFile, access, copyFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dir, '..');
const serverRoot = path.join(repoRoot, 'packages/server');
// Resolution anchor: the server package owns @libsql/client and drizzle-orm.
const serverRequire = createRequire(path.join(serverRoot, 'package.json'));

async function importFromServer(specifier) {
  const resolved = serverRequire.resolve(specifier);
  return import(pathToFileURL(resolved).href);
}
const envPath = path.join(repoRoot, '.env');
const envExamplePath = path.join(repoRoot, '.env.example');
const PLACEHOLDER = 'replace-with-random-64-char-hex-string';

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function ensureEnvFile() {
  if (await exists(envPath)) return;
  if (!(await exists(envExamplePath))) {
    throw new Error(`.env.example missing at ${envExamplePath}`);
  }
  await copyFile(envExamplePath, envPath);
  console.log('[bootstrap] Created .env from .env.example');
}

async function ensureJwtSecret() {
  const raw = await readFile(envPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  let secretLineIndex = -1;
  let currentValue = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^JWT_SECRET\s*=\s*(.*)$/);
    if (m) { secretLineIndex = i; currentValue = m[1].trim(); break; }
  }
  const needsGenerate = secretLineIndex === -1 || currentValue === '' || currentValue === PLACEHOLDER;
  if (!needsGenerate) return;
  const newSecret = randomBytes(32).toString('hex');
  const newLine = `JWT_SECRET=${newSecret}`;
  if (secretLineIndex === -1) {
    const sep = lines.length && lines[lines.length - 1] !== '' ? '\n' : '';
    await writeFile(envPath, raw + sep + newLine + '\n', 'utf8');
  } else {
    lines[secretLineIndex] = newLine;
    await writeFile(envPath, lines.join('\n'), 'utf8');
  }
  console.log('[bootstrap] Generated a fresh JWT_SECRET in .env');
}

async function loadEnvFile() {
  const raw = await readFile(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function normalizeLibsqlUrl(url) {
  if (url === ':memory:') return url;
  if (/^(file|libsql|https?|wss?):/.test(url)) return url;
  return `file:${url}`;
}

async function runMigrations() {
  const dbUrl = process.env.DATABASE_URL ?? './dev.db';
  if (dbUrl.startsWith('postgres')) {
    console.log('[bootstrap] DATABASE_URL is Postgres — skipping migrations (run drizzle-kit migrate against your PG instance).');
    return;
  }
  const { createClient } = await importFromServer('@libsql/client');
  const { drizzle } = await importFromServer('drizzle-orm/libsql');
  const { migrate } = await importFromServer('drizzle-orm/libsql/migrator');
  const client = createClient({ url: normalizeLibsqlUrl(dbUrl) });
  const db = drizzle(client);
  const migrationsFolder = path.join(serverRoot, 'drizzle/sqlite');
  await migrate(db, { migrationsFolder });
  client.close();
  console.log('[bootstrap] Migrations up to date.');
}

async function main() {
  await ensureEnvFile();
  await ensureJwtSecret();
  await loadEnvFile();
  await runMigrations();
}

main().catch((err) => {
  console.error('[bootstrap] Failed:', err);
  process.exit(1);
});
