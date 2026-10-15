import { ACCESS_TOKEN_TYPE } from '../plugins/jwt.js';

declare const app: any;

interface Claims { id: string; type?: string; exp?: number }

// GOOD: the verified payload's type is compared with the constant.
export function admit(token: string): string | null {
  let payload: Claims;
  try {
    payload = app.jwt.verify(token);
  } catch {
    return null;
  }
  if (payload.type !== ACCESS_TOKEN_TYPE || typeof payload.exp !== 'number') return null;
  return payload.id;
}

// GOOD: literal comparison is accepted too.
export function admitLiteral(token: string): string | null {
  const payload: Claims = app.jwt.verify(token);
  return payload.type === 'access' ? payload.id : null;
}

// BAD: claims used without any type check.
export function admitAnything(token: string): string {
  const payload: Claims = app.jwt.verify(token); // flagged
  return payload.id;
}

// BAD: a type comparison exists, but on a different object.
export function admitWrongObject(token: string, other: Claims): string {
  const payload: Claims = app.jwt.verify(token); // flagged
  if (other.type !== ACCESS_TOKEN_TYPE) throw new Error('no');
  return payload.id;
}

// GOOD: the type claim is destructured and then compared.
export function admitDestructured(token: string): string | null {
  const { id, type } = app.jwt.verify(token);
  if (type !== ACCESS_TOKEN_TYPE) return null;
  return id;
}

// BAD: destructured claims, but the type is never compared.
export function admitDestructuredLoose(token: string): string {
  const { id } = app.jwt.verify(token); // flagged
  return id;
}

// GOOD: optional chaining on the verified payload, check nested in an if.
export function admitOptional(token: string): string | null {
  const payload: Claims | undefined = app.jwt.verify(token);
  if (payload) {
    if (payload?.type === ACCESS_TOKEN_TYPE) return payload.id;
  }
  return null;
}
