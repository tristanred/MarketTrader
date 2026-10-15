import { REFRESH_TOKEN_TYPE } from '../plugins/jwt.js';

declare const app: any;

// GOOD: POST /auth/refresh is the one place a refresh token is accepted.
export function refresh(token: string): string | null {
  const payload = app.jwt.verify(token);
  if (payload.type !== REFRESH_TOKEN_TYPE) return null;
  return payload.id;
}
