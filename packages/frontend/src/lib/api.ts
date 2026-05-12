import { useAuthStore } from '@/stores/authStore';
import type { AuthResponse } from '@markettrader/shared';

/** Base URL prefix for backend requests; Vite proxies /api → http://localhost:3000. */
export const API_BASE = '/api';

/** Error thrown by {@link apiFetch} for non-2xx responses. Carries the parsed JSON body if any. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  /** Internal flag — set when we are already inside a refresh-retry attempt. */
  _retried?: boolean;
  /** When true, skip the auth header even if a token exists. */
  skipAuth?: boolean;
};

/**
 * Typed fetch wrapper that attaches the access token as a Bearer header,
 * sends cookies (for the refresh endpoint), and transparently retries once
 * after a 401 by hitting /auth/refresh. On refresh failure, clears the
 * auth store so the app routes back to /login.
 */
export async function apiFetch<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, headers, _retried, skipAuth, ...rest } = options;
  const token = useAuthStore.getState().token;

  const finalHeaders = new Headers(headers);
  if (body !== undefined) finalHeaders.set('Content-Type', 'application/json');
  if (token && !skipAuth) finalHeaders.set('Authorization', `Bearer ${token}`);

  const init: RequestInit = {
    ...rest,
    headers: finalHeaders,
    credentials: 'include',
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, init);

  if (res.status === 401 && !_retried && path !== '/auth/refresh' && !skipAuth) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, _retried: true });
    }
  }

  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // ignore — body may be empty
    }
    throw new ApiError(res.status, parsed, `${res.status} ${res.statusText}`);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Attempt to refresh the access token using the HttpOnly refresh cookie.
 * On success, writes the new token into the auth store and returns true.
 * On failure, clears the auth store and returns false.
 */
export async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      useAuthStore.getState().clear();
      return false;
    }
    const data = (await res.json()) as AuthResponse;
    useAuthStore.getState().setSession(data.token, data.user);
    return true;
  } catch {
    useAuthStore.getState().clear();
    return false;
  }
}
