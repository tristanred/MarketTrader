declare function Fastify(o: unknown): any;
declare function registerWebsocket(app: unknown): Promise<void>;
declare function healthRoutes(app: unknown): Promise<void>;

// registerOtel is never called, and an inline route precedes the websocket plugin.
export async function buildApp() {
  const app = Fastify({});
  app.get('/early', async () => ({ ok: true }));
  await registerWebsocket(app);
  await app.register(healthRoutes);
  return app;
}
