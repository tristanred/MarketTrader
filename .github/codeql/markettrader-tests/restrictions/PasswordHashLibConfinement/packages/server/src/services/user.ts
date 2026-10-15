import { hash } from '@node-rs/argon2'; // BAD: not an allowed file
import bcrypt from 'bcrypt'; // BAD: never bcrypt
export { verify } from '@node-rs/argon2'; // BAD: re-export leaks it everywhere

import argon2 from 'argon2'; // BAD: a second argon2 binding
import { timingSafeEqual } from 'node:crypto'; // OK: unrelated

export async function lazy() {
  const b = await import('bcryptjs'); // BAD
  return [hash, bcrypt, b, argon2, timingSafeEqual];
}
