declare function Fastify(o: unknown): any;
declare function registerWebsocket(app: unknown): Promise<void>;
declare function registerOtel(app: unknown): Promise<void>;
declare function registerSwagger(app: unknown): Promise<void>;
declare function healthRoutes(app: unknown): Promise<void>;
declare function authRoutes(app: unknown): Promise<void>;
declare const env: { NODE_ENV: string };

export async function buildApp() {
  const app = Fastify({});
  await registerWebsocket(app);
  // Swagger mounts /docs before otel: flagged even though nested in an if.
  if (env.NODE_ENV !== 'production') {
    await registerSwagger(app);
  }
  await registerOtel(app);
  await app.register(healthRoutes);
  return app;
}
