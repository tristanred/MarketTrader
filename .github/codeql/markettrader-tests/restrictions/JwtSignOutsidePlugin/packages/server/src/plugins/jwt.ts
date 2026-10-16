import fastifyJwt from '@fastify/jwt'; // OK: registering the plugin is not signing
import { createSigner } from 'fast-jwt'; // OK: plugins/jwt.ts owns token minting

declare const app: { jwt: { sign(p: object, o?: object): string } };

// OK: the one place tokens are minted.
export function signAccessToken(payload: object): string {
  return app.jwt.sign({ ...payload, type: 'access' }, { expiresIn: '15m' });
}

export const plugin = [fastifyJwt, createSigner];
