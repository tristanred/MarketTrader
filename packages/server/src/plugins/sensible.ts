import type { FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';

export async function registerSensible(app: FastifyInstance): Promise<void> {
  await app.register(sensible);
}
