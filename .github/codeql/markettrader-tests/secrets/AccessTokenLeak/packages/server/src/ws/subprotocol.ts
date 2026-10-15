const MARKER = 'markettrader.auth.v1';

export const good = { maxPayload: 1024, handleProtocols: handleWsProtocols };

// OK: echoes the marker only.
export function handleWsProtocols(protocols: Set<string>): string | false {
  return protocols.has(MARKER) ? MARKER : false;
}

export const bad = { handleProtocols: echoAll };

// BAD: echoes whatever was offered, the token included.
function echoAll(protocols: Set<string>): string | false {
  for (const p of protocols) {
    if (p !== MARKER) return p;
  }
  return false;
}
