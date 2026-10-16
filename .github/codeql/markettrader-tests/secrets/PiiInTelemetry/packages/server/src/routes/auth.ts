declare const meters: any;
declare const span: any;

export async function authRoutes(app: any): Promise<void> {
  const recordFailedLogin = (username: string): void => {
    app.log.warn({ username }, 'login throttled'); // BAD: username in a log
  };

  app.post('/auth/login', {}, async (request: any, reply: any) => {
    const { username, email } = request.body;
    recordFailedLogin(username);
    span.setAttribute('user.email', email); // BAD: span attribute
    meters.logins.add(1, { user: username }); // BAD: metric attribute
    const user = { id: 'u1', username };
    app.log.info({ userId: user.id }, 'login ok'); // OK: opaque id
    return reply.send({ user });
  });

  app.post('/auth/rename', {}, async (request: any) => {
    const u = request.body.username;
    const alias = u;
    if (alias.length > 3) {
      request.log?.warn({ alias }, 'rename'); // BAD: aliased body field, optional-chained logger, nested in if
    }
    return {};
  });
}
