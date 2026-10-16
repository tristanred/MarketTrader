import { env } from '../env.js';

declare const fastifyJwt: unknown;
declare class PostHog {
  constructor(key: string, opts: unknown);
}
declare function postgres(url: string): unknown;
declare class TradeError extends Error {
  constructor(code: string, msg: string);
}

export async function registerJwt(app: any): Promise<void> {
  await app.register(fastifyJwt, { secret: env.JWT_SECRET }); // OK: the consumer
  new PostHog(env.POSTHOG_KEY, { host: 'h' }); // OK: the consumer
  postgres(env.DATABASE_URL); // OK: the consumer
  const headers = { Authorization: `Bearer ${env.POSTHOG_KEY}` }; // OK: auth header
  app.log.info({ jwtSecretLength: env.JWT_SECRET.length }, 'jwt ready'); // OK: length only
  app.log.info({ secret: env.JWT_SECRET }, 'jwt ready'); // BAD: secret logged
  console.error('db', env.DATABASE_URL); // BAD: DATABASE_URL may embed a password

  app.get('/debug', async (request: any, reply: any) => {
    return reply.status(200).send({ key: env.ALPACA_API_SECRET_KEY }); // BAD: response
  });
  app.get('/debug2', async () => {
    return { url: env.DATABASE_URL }; // BAD: handler return value
  });
  void headers;
}

export function fail(): never {
  throw new TradeError('X', `bad key ${env.ALPACA_API_SECRET_KEY}`); // BAD: error message
}
