import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlpacaMarketStatus } from '../../../src/providers/market-status/alpaca.js';
import { StockProviderError } from '../../../src/providers/index.js';

describe('AlpacaMarketStatus', () => {
  let originalFetch: typeof globalThis.fetch;
  let provider: AlpacaMarketStatus;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    provider = new AlpacaMarketStatus('test-key-id', 'test-secret');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stub(status: number, body: unknown) {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
  }

  it('maps is_open=true to REGULAR with next_close as nextChangeAt', async () => {
    stub(200, {
      timestamp: '2026-05-12T14:30:00-04:00',
      is_open: true,
      next_open: '2026-05-13T09:30:00-04:00',
      next_close: '2026-05-12T16:00:00-04:00',
    });
    const s = await provider.getStatus();
    expect(s.state).toBe('REGULAR');
    expect(s.nextChangeAt).toBe('2026-05-12T16:00:00-04:00');
    expect(s.source).toBe('alpaca');
  });

  it('maps is_open=false to CLOSED with next_open as nextChangeAt', async () => {
    stub(200, {
      timestamp: '2026-05-12T22:00:00-04:00',
      is_open: false,
      next_open: '2026-05-13T09:30:00-04:00',
      next_close: '2026-05-13T16:00:00-04:00',
    });
    const s = await provider.getStatus();
    expect(s.state).toBe('CLOSED');
    expect(s.nextChangeAt).toBe('2026-05-13T09:30:00-04:00');
  });

  it('maps HTTP 429 to RATE_LIMITED', async () => {
    stub(429, {});
    await expect(provider.getStatus()).rejects.toMatchObject({
      name: 'StockProviderError',
      code: 'RATE_LIMITED',
    });
  });

  it('maps non-ok responses to PROVIDER_ERROR', async () => {
    stub(500, {});
    await expect(provider.getStatus()).rejects.toBeInstanceOf(StockProviderError);
  });

  it('sends both the key-id and secret auth headers', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ is_open: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await provider.getStatus();

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['APCA-API-KEY-ID']).toBe('test-key-id');
    // Regression: without the secret header, every authenticated Alpaca call
    // is rejected 401/403 in production.
    expect(headers['APCA-API-SECRET-KEY']).toBe('test-secret');
  });
});
