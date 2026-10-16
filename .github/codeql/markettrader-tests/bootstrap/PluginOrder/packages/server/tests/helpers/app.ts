declare function Fastify(o: unknown): any;
declare function healthRoutes(app: unknown): Promise<void>;

// Out of scope (tests/): never flagged even though no plugin is registered.
export async function buildApp() {
  const app = Fastify({});
  await app.register(healthRoutes);
  return app;
}
