import type { FastifyInstance } from 'fastify';
import fastifyHelmet from '@fastify/helmet';

/**
 * Registers @fastify/helmet with sane production defaults. CSP is left to the
 * Nginx reverse proxy (`nginx.conf`) so the SPA can configure script/style
 * sources without touching server code.
 */
export async function registerHelmet(app: FastifyInstance): Promise<void> {
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false,
  });
}
