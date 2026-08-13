import { randomBytes } from 'node:crypto';

// I, L, O, U, 0 and 1 are omitted so codes survive being read aloud or
// copied by hand without transcription errors.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 8;

// Largest multiple of the alphabet size that fits in a byte. Values at or
// above this are discarded so every character is uniformly distributed.
const UNBIASED_CEILING = Math.floor(256 / ALPHABET.length) * ALPHABET.length;

/**
 * Generates a short, URL-safe, case-insensitive-friendly invite code.
 * Uses rejection sampling so no character is more likely than another.
 */
export function generateInviteCode(): string {
  let out = '';
  while (out.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (byte >= UNBIASED_CEILING) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}
