import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from '../env.js';

export async function registerCors(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });
}
