export async function authRoutes(app: any): Promise<void> {
  app.post('/auth/refresh', {}, async (request: any) => {
    const token = request.cookies['refreshToken']; // OK: the one allowed reader
    const again = request.cookies.refreshToken; // OK: same file
    return { ok: Boolean(token && again) };
  });
}
