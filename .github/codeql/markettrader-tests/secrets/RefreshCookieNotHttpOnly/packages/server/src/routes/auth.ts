export function cookies(reply: any, token: string, secure: boolean): void {
  reply.setCookie('refreshToken', token, { httpOnly: true, secure, path: '/auth/refresh' }); // OK
  const opts = { httpOnly: true, sameSite: 'lax' };
  reply.setCookie('refreshToken', token, opts); // OK: local literal
  reply.setCookie('refreshToken', token, { httpOnly: false }); // BAD: explicitly off
  reply.setCookie('refreshToken', token, { secure: true }); // BAD: httpOnly missing
  reply.setCookie('refreshToken', token); // BAD: no options
  reply.setCookie('refreshToken', token, { httpOnly: secure }); // BAD: not literally true
  reply.setCookie('theme', 'dark', { httpOnly: false }); // OK: not the refresh cookie
  const LOCAL_NAME = 'refreshToken';
  reply.setCookie(LOCAL_NAME, token, { sameSite: 'lax' }); // BAD: constant name, httpOnly missing
  reply.setCookie(COOKIE_NAME, token, { httpOnly: true }); // OK: module constant, httpOnly set
}

const COOKIE_NAME = 'refreshToken';

export function moduleConst(reply: any, token: string): void {
  if (token) {
    reply.setCookie(COOKIE_NAME, token, { path: '/auth/refresh' }); // BAD: module-level constant name, nested in if
  }
}
