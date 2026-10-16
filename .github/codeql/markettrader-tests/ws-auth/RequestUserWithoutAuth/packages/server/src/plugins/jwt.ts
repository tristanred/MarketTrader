// GOOD: the guard itself populates and reads request.user.
export async function verifyAccessToken(request: any): Promise<boolean> {
  await request.jwtVerify();
  return request.user.type === 'access';
}
