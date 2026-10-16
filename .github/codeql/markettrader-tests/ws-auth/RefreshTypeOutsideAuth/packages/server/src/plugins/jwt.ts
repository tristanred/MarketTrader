export const ACCESS_TOKEN_TYPE = 'access';
export const REFRESH_TOKEN_TYPE = 'refresh';

// GOOD: the token helpers may name the refresh type.
export function isRefresh(claims: { type?: string }): boolean {
  return claims.type === REFRESH_TOKEN_TYPE;
}
