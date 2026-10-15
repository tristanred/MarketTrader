declare const app: any;
declare const span: any;
declare function extractSubprotocolToken(h: unknown): string | undefined;
declare function signAccessToken(app: unknown, p: unknown): string;
declare function signRefreshToken(app: unknown, p: unknown): string;
declare function closeSocket(s: unknown, code: number, reason: string): void;

export function liveRoute(): void {
  app.get('/games/:id/live', { websocket: true }, async (socket: any, request: any) => {
    const token = extractSubprotocolToken(request.headers['sec-websocket-protocol']);
    if (!token) {
      socket.close(1008, 'Missing token'); // OK: constant reason
      return;
    }
    request.log.warn({ token }, 'got token'); // BAD: token in a log object
    socket.close(1008, `bad token ${token}`); // BAD: close reason
    closeSocket(socket, 1008, token); // BAD: close helper reason
    span.setAttribute('ws.token', token); // BAD: span attribute

    const payload = app.jwt.verify(token); // OK: verification is the intended use
    request.log.info({ userId: payload.id }, 'connected'); // OK: claims, not the token
  });

  app.get('/raw', async (request: any) => {
    const raw = request.headers['sec-websocket-protocol'];
    console.log('offer', raw); // BAD: raw offer carries the token
  });
}

export function minted(reply: any): void {
  const access = signAccessToken(app, { id: '1', username: 'u' });
  app.log.debug(`minted ${access}`); // BAD: signed JWT in a log
  reply.send({ token: access }); // OK: the auth response is the intended delivery
  reply.status(200).send({ token: access }); // OK: same, chained form
  const refresh = signRefreshToken(app, { id: '1', username: 'u' });
  reply.setCookie('refreshToken', refresh, { httpOnly: true }); // OK
}
