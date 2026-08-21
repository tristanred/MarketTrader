import { describe, expect, it } from 'vitest';
import {
  WS_AUTH_SUBPROTOCOL,
  WS_CREDENTIAL_STALE_AFTER_MS,
  WS_INVALID_FRAME_CLOSE_CODE,
  WS_POLICY_CLOSE_CODE,
  isStaleCredentialClose,
  wsAuthProtocols,
} from '@/lib/wsAuth';

/**
 * These values are the wire contract with the server and are duplicated in
 * `packages/server/src/ws/subprotocol.ts` and `close-codes.ts` — `shared`
 * carries types only, so a literal assertion on each side is what makes a
 * one-sided change fail loudly instead of silently breaking reconnects.
 */
describe('the WebSocket wire contract', () => {
  it('pins the auth subprotocol', () => {
    expect(WS_AUTH_SUBPROTOCOL).toBe('markettrader.auth.v1');
  });

  it('pins the credential close code', () => {
    expect(WS_POLICY_CLOSE_CODE).toBe(1008);
  });

  it('pins the invalid-frame close code', () => {
    expect(WS_INVALID_FRAME_CLOSE_CODE).toBe(4400);
  });

  it('keeps the two codes distinct', () => {
    expect(WS_INVALID_FRAME_CLOSE_CODE).not.toBe(WS_POLICY_CLOSE_CODE);
  });

  it('offers the marker first and the token second', () => {
    expect(wsAuthProtocols('jwt.token.here')).toEqual([WS_AUTH_SUBPROTOCOL, 'jwt.token.here']);
  });
});

describe('isStaleCredentialClose', () => {
  const longAgo = () => Date.now() - WS_CREDENTIAL_STALE_AFTER_MS - 1;

  it('reads a policy close on a long-open socket as an expired token', () => {
    expect(isStaleCredentialClose(WS_POLICY_CLOSE_CODE, longAgo())).toBe(true);
  });

  it('reads a policy close right after open as an authorization refusal', () => {
    expect(isStaleCredentialClose(WS_POLICY_CLOSE_CODE, Date.now())).toBe(false);
  });

  it('never spends a refresh on a rejected frame', () => {
    // The server closes a malformed or over-cap `subscribe` with its own code.
    // Sharing 1008 with the credential paths made a long-open socket burn a
    // token refresh, reconnect, re-send the same bad frame, and only then back
    // off — and every future non-credential 1008 would inherit that.
    expect(isStaleCredentialClose(WS_INVALID_FRAME_CLOSE_CODE, longAgo())).toBe(false);
  });

  it('ignores a close on a socket that never opened', () => {
    expect(isStaleCredentialClose(WS_POLICY_CLOSE_CODE, 0)).toBe(false);
  });

  it('ignores a close that carried no code', () => {
    expect(isStaleCredentialClose(undefined, longAgo())).toBe(false);
  });
});
