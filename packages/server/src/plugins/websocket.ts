import type { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { handleWsProtocols } from '../ws/subprotocol.js';

/**
 * Registers `@fastify/websocket`. Must come before every route — the plugin
 * wraps route definitions as they are declared.
 *
 * `maxPayload` replaces ws's 100 MiB default: `subscribe` is the only frame a
 * client may send, and an unbounded one lets a single peer materialise the
 * whole buffer as a JS string on a one-process deployment.
 */
export async function registerWebsocket(app: FastifyInstance): Promise<void> {
  await app.register(fastifyWebsocket, {
    options: { maxPayload: 16 * 1024, handleProtocols: handleWsProtocols },
  });
}
