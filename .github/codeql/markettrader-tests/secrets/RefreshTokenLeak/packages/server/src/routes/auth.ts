declare function signRefreshToken(app: unknown, p: unknown): string;
declare function signAccessToken(app: unknown, p: unknown): string;
declare const posthog: any;

function issueRefreshCookie(app: any, reply: any): void {
  const refreshToken = signRefreshToken(app, { id: '1', username: 'u' });
  reply.setCookie('refreshToken', refreshToken, { httpOnly: true }); // OK: the only delivery
}

export async function authRoutes(app: any): Promise<void> {
  app.post('/auth/login', {}, async (request: any, reply: any) => {
    issueRefreshCookie(app, reply);
    const token = signAccessToken(app, { id: '1', username: 'u' });
    return reply.status(200).send({ token }); // OK: access token in the body is intended
  });

  app.post('/auth/leaky', {}, async (request: any, reply: any) => {
    const refresh = signRefreshToken(app, { id: '1', username: 'u' });
    request.log.info({ refresh }, 'issued'); // BAD: logged
    posthog.capture({ distinctId: '1', event: 'x', properties: { refresh } }); // BAD: analytics
    return reply.status(200).send({ refreshToken: refresh }); // BAD: in the body
  });

  app.post('/auth/leaky2', {}, async () => {
    return { refreshToken: signRefreshToken(app, {}) }; // BAD: handler return value
  });
}
