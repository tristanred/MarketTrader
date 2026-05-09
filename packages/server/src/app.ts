import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { db as globalDb, type Db } from './db/index.js';
import { registerCors } from './plugins/cors.js';
import { registerSensible } from './plugins/sensible.js';
import { registerCookie } from './plugins/cookie.js';
import { registerJwt } from './plugins/jwt.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { gameRoutes } from './routes/games.js';

export async function buildApp(
  opts: FastifyServerOptions & { db?: Db } = {},
): Promise<FastifyInstance> {
  const { db = globalDb, ...fastifyOpts } = opts;
  const app = Fastify(fastifyOpts);

  await registerCors(app);
  await registerSensible(app);
  await registerCookie(app);
  await registerJwt(app);
  await registerRateLimit(app);

  await app.register(healthRoutes);
  await app.register(authRoutes(db));
  await app.register(gameRoutes(db));

  return app;
}
