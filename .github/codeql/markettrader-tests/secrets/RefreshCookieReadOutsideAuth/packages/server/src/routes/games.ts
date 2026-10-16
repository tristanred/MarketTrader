export async function gameRoutes(app: any): Promise<void> {
  app.get('/games', {}, async (request: any) => {
    const a = request.cookies.refreshToken; // BAD
    const b = request.cookies['refreshToken']; // BAD
    const { refreshToken } = request.cookies; // BAD: destructured
    const theme = request.cookies.theme; // OK: another cookie
    const c = request.cookies?.refreshToken; // BAD: optional chaining
    const jar = request.cookies;
    const d = jar.refreshToken; // BAD: aliased cookie jar
    return { a, b, refreshToken, theme, c, d };
  });
  app.get('/games/legacy', {}, async (req: any) => {
    if (req.cookies) {
      return { t: req.cookies[COOKIE] }; // BAD: `req` alias, constant key, nested in if
    }
    return {};
  });
}

const COOKIE = 'refreshToken';
