import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../src/lib/api';
import { useAuthStore } from '../src/stores/authStore';

describe('apiFetch', () => {
  beforeEach(() => {
    useAuthStore.setState({ token: 'old-token', user: { id: 'u1', username: 'alice' }, ready: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useAuthStore.getState().clear();
  });

  it('attaches Authorization header and parses JSON on 2xx', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiFetch<{ ok: boolean }>('/games');
    expect(result).toEqual({ ok: true });
    const firstCall = (fetchMock.mock.calls as unknown as [unknown, RequestInit][])[0];
    if (!firstCall) throw new Error('fetch was not called');
    const init = firstCall[1];
    if (!init) throw new Error('fetch called without init');
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer old-token');
  });

  it('on 401, attempts /auth/refresh and retries the original request once', async () => {
    let call = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      call += 1;
      if (call === 1) return new Response('unauthorized', { status: 401 });
      if (url.endsWith('/auth/refresh')) {
        return new Response(
          JSON.stringify({ token: 'new-token', user: { id: 'u1', username: 'alice' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiFetch<{ ok: boolean }>('/games');
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial 401, refresh, retry
    expect(useAuthStore.getState().token).toBe('new-token');
  });

  it('on refresh failure, clears the store and throws ApiError(401)', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/auth/refresh')) {
        return new Response('nope', { status: 401 });
      }
      return new Response('unauthorized', { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/games')).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().token).toBeNull();
  });
});
