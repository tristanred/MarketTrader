import type { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';

export async function registerWebsocket(app: FastifyInstance): Promise<void> {
  await app.register(fastifyWebsocket);
}
