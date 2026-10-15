declare function Fastify(o: unknown): any;
declare function registerWebsocket(app: unknown): Promise<void>;
declare function registerOtel(app: unknown): Promise<void>;
declare function registerSwagger(app: unknown, o?: { exposeDocs: boolean }): Promise<void>;
declare function registerAdminGuard(app: unknown, db: unknown): Promise<void>;
declare function registerCors(app: unknown): Promise<void>;
declare function healthRoutes(app: unknown): Promise<void>;
declare const env: { NODE_ENV: string };

export async function buildApp(db: unknown, opts: { exposeDocs?: boolean } = {}) {
  const { exposeDocs = env.NODE_ENV !== 'production' } = opts;
  const app = Fastify({});
  // Not the Fastify instance: never a route mount.
  const registry = { register: (x: unknown) => x };
  registry.register(healthRoutes);
  await registerWebsocket(app);
  await registerOtel(app);
  await registerCors(app);
  // Live app.ts shape: the production switch is an argument, not an if.
  await registerSwagger(app, { exposeDocs });
  // Nested in an if, but after both plugins: fine.
  if (env.NODE_ENV !== 'production') {
    await registerSwagger(app);
  }
  await app.register(healthRoutes);
  await registerAdminGuard(app, db);
  app.get('/inline', async () => ({ ok: true }));
  return app;
}
