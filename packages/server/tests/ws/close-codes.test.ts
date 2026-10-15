import { describe, it, expect } from 'vitest';
import {
  WS_INVALID_FRAME_CLOSE_CODE,
  WS_LIMIT_EXCEEDED_CLOSE_CODE,
  WS_POLICY_CLOSE_CODE,
} from '../../src/ws/close-codes.js';

/**
 * Both values are duplicated in `packages/frontend/src/lib/wsAuth.ts`, which
 * branches on them — `shared` carries types only, so a literal assertion on
 * each side is what makes a one-sided change fail loudly.
 */
describe('WebSocket close codes', () => {
  it('pins the credential close code', () => {
    expect(WS_POLICY_CLOSE_CODE).toBe(1008);
  });

  it('pins the invalid-frame close code', () => {
    expect(WS_INVALID_FRAME_CLOSE_CODE).toBe(4400);
  });

  it('keeps frame refusals distinguishable from credential refusals', () => {
    expect(WS_INVALID_FRAME_CLOSE_CODE).not.toBe(WS_POLICY_CLOSE_CODE);
  });

  it('stays inside the range ws will send', () => {
    // ws's isValidStatusCode: 1000–1014 minus 1004/1005/1006, or 3000–4999.
    // A code outside it throws from socket.close() instead of closing.
    const valid =
      (WS_INVALID_FRAME_CLOSE_CODE >= 3000 && WS_INVALID_FRAME_CLOSE_CODE <= 4999) ||
      (WS_INVALID_FRAME_CLOSE_CODE >= 1000 &&
        WS_INVALID_FRAME_CLOSE_CODE <= 1014 &&
        ![1004, 1005, 1006].includes(WS_INVALID_FRAME_CLOSE_CODE));
    expect(valid).toBe(true);
  });
  it('pins the limit-exceeded close code', () => {
    expect(WS_LIMIT_EXCEEDED_CLOSE_CODE).toBe(4429);
  });

  it('keeps the three codes disjoint', () => {
    expect(new Set([WS_POLICY_CLOSE_CODE, WS_INVALID_FRAME_CLOSE_CODE, WS_LIMIT_EXCEEDED_CLOSE_CODE]).size).toBe(3);
  });

  it('keeps the limit code inside the private range ws will send', () => {
    expect(WS_LIMIT_EXCEEDED_CLOSE_CODE).toBeGreaterThanOrEqual(3000);
    expect(WS_LIMIT_EXCEEDED_CLOSE_CODE).toBeLessThanOrEqual(4999);
  });
});
