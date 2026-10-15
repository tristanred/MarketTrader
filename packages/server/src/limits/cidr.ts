import { BlockList, isIP } from 'node:net';

/** True for `10.0.0.0/8`, `::1/128`, and bare addresses in either family. */
export function isAddressOrSubnet(token: string): boolean {
  const slash = token.indexOf('/');
  if (slash === -1) return isIP(token) !== 0;
  const address = token.slice(0, slash);
  const prefix = token.slice(slash + 1);
  const family = isIP(address);
  if (family === 0 || !/^\d+$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

/** An error message naming every entry that is not an address or CIDR subnet; undefined when valid. */
export function validateCidrList(raw: string): string | undefined {
  const bad = splitList(raw).filter((t) => !isAddressOrSubnet(t));
  return bad.length === 0 ? undefined : `not an IP address or CIDR subnet: ${bad.join(', ')}`;
}

/**
 * Strips the `::ffff:` prefix a dual-stack socket puts on IPv4 peers, so an
 * IPv4 allowlist entry matches them.
 */
export function normaliseIp(ip: string): string {
  return ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

/** A compiled allowlist. */
export interface CidrMatcher {
  readonly size: number;
  matches(ip: string): boolean;
}

let memo: { raw: string; matcher: CidrMatcher } | undefined;

/**
 * Compiles a comma-separated address/CIDR list. Memoised on the raw string
 * because the source is a live option read on every limited request. Invalid
 * entries are skipped; the option's validator rejects them before they persist.
 */
export function parseCidrList(raw: string): CidrMatcher {
  if (memo?.raw === raw) return memo.matcher;
  const list = new BlockList();
  let size = 0;
  for (const token of splitList(raw)) {
    if (!isAddressOrSubnet(token)) continue;
    const slash = token.indexOf('/');
    const address = slash === -1 ? token : token.slice(0, slash);
    const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
    if (slash === -1) list.addAddress(address, family);
    else list.addSubnet(address, Number(token.slice(slash + 1)), family);
    size++;
  }
  const matcher: CidrMatcher = {
    size,
    matches(ip: string): boolean {
      const candidate = normaliseIp(ip);
      const family = isIP(candidate);
      if (family === 0) return false;
      return list.check(candidate, family === 6 ? 'ipv6' : 'ipv4');
    },
  };
  memo = { raw, matcher };
  return matcher;
}
