import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { db as globalDb, type Db } from './db/index.js';
import { registerCors } from './plugins/cors.js';
import { registerSensible } from './plugins/sensible.js';
import { healthRoutes } from './routes/health.js';

export async function buildApp(
  opts: FastifyServerOptions & { db?: Db } = {},
): Promise<FastifyInstance> {
  const { db = globalDb, ...fastifyOpts } = opts;
  const app = Fastify(fastifyOpts);

  await registerCors(app);
  await registerSensible(app);
  await app.register(healthRoutes);

  return app;
}
