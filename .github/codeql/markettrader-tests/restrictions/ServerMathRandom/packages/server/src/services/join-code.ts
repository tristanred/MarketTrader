import { randomInt } from 'node:crypto';

export function badCode(): string {
  return Math.random().toString(36).slice(2, 8); // BAD
}

export const rng: () => number = Math.random; // BAD: passed as a function

export function goodCode(): string {
  return String(randomInt(0, 1_000_000)); // OK
}

export const floor = Math.floor(1.5); // OK: not random
