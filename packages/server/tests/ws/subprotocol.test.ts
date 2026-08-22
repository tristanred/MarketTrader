import { describe, it, expect } from 'vitest';
import {
  WS_AUTH_SUBPROTOCOL,
  extractSubprotocolToken,
  handleWsProtocols,
} from '../../src/ws/subprotocol.js';

describe('WS_AUTH_SUBPROTOCOL', () => {
  it('pins the wire value', () => {
    // Duplicated in packages/frontend/src/lib/wsAuth.ts — `shared` carries types
    // only, so nothing else makes a one-sided rename fail.
    expect(WS_AUTH_SUBPROTOCOL).toBe('markettrader.auth.v1');
  });
});

describe('extractSubprotocolToken', () => {
  it('reads the token that follows the marker', () => {
    expect(extractSubprotocolToken(`${WS_AUTH_SUBPROTOCOL}, jwt.token.here`)).toBe(
      'jwt.token.here',
    );
  });

  it('accepts the marker in either position', () => {
    expect(extractSubprotocolToken(`jwt.token.here,${WS_AUTH_SUBPROTOCOL}`)).toBe(
      'jwt.token.here',
    );
  });

  it('joins a header the runtime split into multiple values', () => {
    expect(extractSubprotocolToken([WS_AUTH_SUBPROTOCOL, 'jwt.token.here'])).toBe(
      'jwt.token.here',
    );
  });

  it('returns undefined without a header', () => {
    expect(extractSubprotocolToken(undefined)).toBeUndefined();
  });

  it('returns undefined when the marker is absent', () => {
    expect(extractSubprotocolToken('some.other.scheme, jwt.token.here')).toBeUndefined();
  });

  it('returns undefined for the marker alone', () => {
    expect(extractSubprotocolToken(WS_AUTH_SUBPROTOCOL)).toBeUndefined();
  });

  it('returns undefined when more than one value accompanies the marker', () => {
    expect(extractSubprotocolToken(`${WS_AUTH_SUBPROTOCOL}, a, b`)).toBeUndefined();
  });
});

describe('handleWsProtocols', () => {
  it('echoes the marker, never the token', () => {
    const offered = new Set([WS_AUTH_SUBPROTOCOL, 'jwt.token.here']);
    expect(handleWsProtocols(offered)).toBe(WS_AUTH_SUBPROTOCOL);
  });

  it('selects nothing when the marker was not offered', () => {
    expect(handleWsProtocols(new Set(['jwt.token.here']))).toBe(false);
  });
});
