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
import { stockRoutes } from './routes/stocks.js';
import { tradingRoutes } from './routes/trading.js';
import type { StockProvider } from './providers/index.js';
import { CachedProvider, createProvider } from './providers/index.js';

export async function buildApp(
  opts: FastifyServerOptions & { db?: Db; provider?: StockProvider } = {},
): Promise<FastifyInstance> {
  const { db = globalDb, provider: injectedProvider, ...fastifyOpts } = opts;
  const provider = injectedProvider ?? new CachedProvider(db, createProvider());
  const app = Fastify(fastifyOpts);

  await registerCors(app);
  await registerSensible(app);
  await registerCookie(app);
  await registerJwt(app);
  await registerRateLimit(app);

  await app.register(healthRoutes);
  await app.register(authRoutes(db));
  await app.register(gameRoutes(db));
  await app.register(stockRoutes(db, provider));
  await app.register(tradingRoutes(db, provider));

  return app;
}
