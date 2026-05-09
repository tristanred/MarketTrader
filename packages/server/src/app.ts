import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerCors } from './plugins/cors.js';
import { registerSensible } from './plugins/sensible.js';
import { healthRoutes } from './routes/health.js';

export async function buildApp(opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify(opts);

  await registerCors(app);
  await registerSensible(app);
  await app.register(healthRoutes);

  return app;
}
