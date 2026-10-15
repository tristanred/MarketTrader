declare const useAuthStore: any;
declare function wsAuthProtocols(token: string): [string, string];
declare function capture(event: string, props?: Record<string, unknown>): void;

export async function apiFetch(path: string): Promise<Response> {
  const token = useAuthStore.getState().token;
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`); // OK: bearer header
  return fetch(path, { headers }); // OK: token is not in the URL
}

export async function leakyFetch(path: string): Promise<Response> {
  const token = useAuthStore.getState().token;
  return fetch(`${path}?access_token=${token}`); // BAD: token in a URL
}

export function useSocket(url: string): void {
  const token: string = useAuthStore((s: any) => s.token);
  new WebSocket(url, wsAuthProtocols(token)); // OK: subprotocol offer
  new WebSocket(`${url}?token=${token}`); // BAD: token in the socket URL
  const u = new URL(url);
  u.searchParams.set('t', 'x');
  new URL(`/x?t=${token}`, url); // BAD: token in a URL
  localStorage.setItem('token', token); // BAD: web storage
  capture('socket_opened', { token }); // BAD: analytics
  capture('socket_opened', { hasToken: token.length > 0 }); // OK: derived boolean
}

export function sourceShapes(): void {
  const { token } = useAuthStore.getState();
  console.warn('destructured', token); // BAD: destructured from getState()
  const state = useAuthStore.getState();
  if (state.token) {
    sessionStorage.setItem('t', state.token); // BAD: aliased store state, nested in if
  }
  const maybe = useAuthStore.getState()?.token;
  window.localStorage.setItem('t', maybe); // BAD: optional chaining, window.localStorage
  const headers = { Authorization: `Bearer ${maybe}` }; // OK: header object
  void headers;
}

declare function useEffect(fn: () => void, deps: unknown[]): void;

export function useLeakInEffect(): void {
  const token = useAuthStore((s: any) => s.token);
  useEffect(() => {
    console.debug('effect token', token); // BAD: captured token logged inside an effect
  }, [token]);
}
