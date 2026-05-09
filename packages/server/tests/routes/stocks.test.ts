import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { MockStockProvider } from '../helpers/mock-provider.js';
import { StockProviderError } from '../../src/providers/index.js';

describe('GET /stocks/:symbol', () => {
  let app: FastifyInstance;
  let provider: MockStockProvider;

  beforeAll(async () => {
    provider = new MockStockProvider();
    provider.setQuote('AAPL', { price: 175.5, change: 2.1, changePercent: 1.2 });
    app = await createTestApp(provider);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with a stock quote', async () => {
    const res = await app.inject({ method: 'GET', url: '/stocks/AAPL' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ symbol: string; price: number }>();
    expect(body.symbol).toBe('AAPL');
    expect(body.price).toBe(175.5);
  });

  it('normalizes symbol to uppercase', async () => {
    const res = await app.inject({ method: 'GET', url: '/stocks/aapl' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ symbol: string }>().symbol).toBe('AAPL');
  });

  it('returns 404 when provider throws SYMBOL_NOT_FOUND', async () => {
    const errorProvider = new MockStockProvider();
    const errorApp = await createTestApp(errorProvider);
    errorProvider.getQuote = async () => {
      throw new StockProviderError('SYMBOL_NOT_FOUND', 'Not found');
    };
    const res = await errorApp.inject({ method: 'GET', url: '/stocks/FAKE' });
    expect(res.statusCode).toBe(404);
    await errorApp.close();
  });
});

describe('GET /stocks/search', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with search results', async () => {
    const res = await app.inject({ method: 'GET', url: '/stocks/search?q=apple' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('returns 400 when query is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/stocks/search' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when query is empty string', async () => {
    const res = await app.inject({ method: 'GET', url: '/stocks/search?q=' });
    expect(res.statusCode).toBe(400);
  });
});
