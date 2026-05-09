import { buildApp } from './app.js';
import { env } from './env.js';

const loggerOptions =
  env.NODE_ENV === 'test'
    ? false
    : env.NODE_ENV === 'development'
      ? {
          level: 'debug',
          transport: { target: 'pino-pretty', options: { colorize: true } },
        }
      : { level: 'info' };

try {
  const app = await buildApp({ logger: loggerOptions });
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (err) {
  console.error(err);
  process.exit(1);
}
