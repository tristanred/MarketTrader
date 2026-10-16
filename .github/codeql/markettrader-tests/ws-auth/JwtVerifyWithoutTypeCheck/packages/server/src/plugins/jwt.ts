export const ACCESS_TOKEN_TYPE = 'access';
export const REFRESH_TOKEN_TYPE = 'refresh';

// GOOD: request.jwtVerify() followed by a type check on request.user.
export async function verifyAccessToken(request: any): Promise<boolean> {
  try {
    await request.jwtVerify();
  } catch {
    return false;
  }
  if (request.user.type !== ACCESS_TOKEN_TYPE) return false;
  return Boolean(request.user.id);
}

// BAD: jwtVerify() with no type check — a refresh token passes.
export async function looseVerify(request: any): Promise<string> {
  await request.jwtVerify(); // flagged
  return request.user.id;
}
