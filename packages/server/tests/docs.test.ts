import { describe, it, expect } from 'vitest';
import { createTestApp } from './helpers/app.js';

// Guards the @fastify/swagger-ui mount. The nginx site proxies the whole /docs
// prefix on the assumption that the UI's assets stay absolute under
// /docs/static/, so a plugin upgrade that relocates them breaks production
// without breaking anything else.
describe('swagger ui', () => {
  it('serves the UI at /docs', async () => {
    const app = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    await app.close();
  });

  it('serves the OpenAPI spec at /docs/json', async () => {
    const app = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json() as { info?: { title?: string }; paths?: Record<string, unknown> };
    expect(spec.info?.title).toBe('MarketTrader API');
    expect(Object.keys(spec.paths ?? {}).length).toBeGreaterThan(0);
    await app.close();
  });

  it('keeps its assets under /docs/static', async () => {
    const app = await createTestApp();
    const html = (await app.inject({ method: 'GET', url: '/docs/' })).body;
    const refs = [...html.matchAll(/(?:src|href)="\.\/(static\/[^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);

    for (const ref of refs) {
      const res = await app.inject({ method: 'GET', url: `/docs/${ref}` });
      expect(res.statusCode, `/docs/${ref}`).toBe(200);
    }
    await app.close();
  });
});
