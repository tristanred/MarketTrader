import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

describe('GET /version', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the build stamp without authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/version' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ version: string; commit: string; buildTime: string }>();

    // Proves the vitest `define` block actually substituted — the dev fallback
    // in src/build-info.ts would report '0.0.0-dev' here.
    expect(body.version).toBe(pkg.version);
    expect(body.commit).not.toBe('');
    expect(Number.isNaN(Date.parse(body.buildTime))).toBe(false);
  });
});
