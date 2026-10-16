import { createSign } from 'node:crypto';
import { createSigner } from 'fast-jwt'; // BAD: standalone JWT library
import type { JWTPayload } from 'jose'; // OK: type-only
import { signAccessToken } from '../plugins/jwt';

declare const app: { jwt: { sign(p: object): string } };
declare const maybeApp: { jwt?: { sign(p: object): string } };
declare const request: { server: { jwt: { sign(p: object): string } } };
declare const reply: { jwtSign(p: object): Promise<string> };
declare const keyring: { sign(p: object): string };

export function bad1() {
  return app.jwt.sign({ sub: 'u' }); // BAD
}

export function bad2() {
  const j = app.jwt;
  return j.sign({ sub: 'u' }); // BAD: alias of app.jwt
}

export function bad3() {
  return reply.jwtSign({ sub: 'u' }); // BAD: same secret, no type claim
}

export function bad4() {
  const { sign } = app.jwt;
  return sign({ sub: 'u' }); // BAD: destructured sign
}

export function bad5() {
  const { jwt } = app;
  return jwt.sign({ sub: 'u' }); // BAD: destructured namespace
}

export function bad6() {
  return maybeApp.jwt?.sign({ sub: 'u' }); // BAD: optional chaining
}

export function bad7() {
  return request.server.jwt.sign({ sub: 'u' }); // BAD: via request.server
}

export function good(p: JWTPayload) {
  createSign('sha256').sign('key'); // OK: not a JWT namespace
  keyring.sign({}); // OK: receiver is not `.jwt`
  void createSigner;
  return signAccessToken({ sub: 'u', p }); // OK
}
