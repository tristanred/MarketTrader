import { describe, expect, it } from 'vitest';
import { parseInviteCode } from '@/lib/inviteCode';

describe('parseInviteCode', () => {
  it('accepts a bare code', () => {
    expect(parseInviteCode('K7QM4XTP')).toBe('K7QM4XTP');
  });

  it('uppercases and strips the spaces and dashes people add when quoting a code', () => {
    expect(parseInviteCode('  k7qm 4xtp ')).toBe('K7QM4XTP');
    expect(parseInviteCode('K7QM-4XTP')).toBe('K7QM4XTP');
  });

  it('pulls the code out of a pasted invite link', () => {
    expect(parseInviteCode('https://markettrader.example/join/k7qm4xtp')).toBe('K7QM4XTP');
    expect(parseInviteCode('https://markettrader.example/join/K7QM4XTP/?ref=chat#x')).toBe(
      'K7QM4XTP',
    );
    expect(parseInviteCode('/join/K7QM4XTP')).toBe('K7QM4XTP');
  });

  it('rejects input that cannot be a code', () => {
    expect(parseInviteCode('')).toBeNull();
    expect(parseInviteCode('   ')).toBeNull();
    expect(parseInviteCode('K7QM?4XTP')).toBeNull();
    expect(parseInviteCode('https://markettrader.example/games/abc')).toBeNull();
    expect(parseInviteCode('A'.repeat(33))).toBeNull();
  });
});
