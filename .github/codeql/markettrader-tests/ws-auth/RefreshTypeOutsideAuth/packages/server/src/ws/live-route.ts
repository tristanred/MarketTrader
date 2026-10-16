import { ACCESS_TOKEN_TYPE, REFRESH_TOKEN_TYPE } from '../plugins/jwt.js';

declare const app: any;

// BAD: deny-listing refresh instead of requiring access.
export function admitDenyList(token: string): boolean {
  const payload = app.jwt.verify(token);
  return payload.type !== REFRESH_TOKEN_TYPE; // flagged
}

// BAD: same, with the literal.
export function admitLiteral(token: string): boolean {
  const payload = app.jwt.verify(token);
  return payload.type != 'refresh'; // flagged
}

// GOOD: positive access check.
export function admit(token: string): boolean {
  const payload = app.jwt.verify(token);
  return payload.type === ACCESS_TOKEN_TYPE;
}

// GOOD: a 'refresh' string that is not compared with a `.type`.
export function label(kind: string): boolean {
  return kind === 'refresh';
}
