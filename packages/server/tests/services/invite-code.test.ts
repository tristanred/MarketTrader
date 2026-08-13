import { describe, it, expect } from 'vitest';
import { generateInviteCode } from '../../src/services/invite-code.js';

describe('generateInviteCode', () => {
  it('returns an 8-character code', () => {
    expect(generateInviteCode()).toHaveLength(8);
  });

  it('uses only unambiguous uppercase characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateInviteCode()).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/);
    }
  });

  it('does not repeat within a large sample', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateInviteCode());
    expect(seen.size).toBe(1000);
  });
});
