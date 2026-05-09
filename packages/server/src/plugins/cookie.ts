import type { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';

export async function registerCookie(app: FastifyInstance): Promise<void> {
  await app.register(fastifyCookie);
}
