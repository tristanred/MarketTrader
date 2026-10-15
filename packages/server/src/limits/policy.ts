import type { ConfigReader } from '../config/runtime-config.js';
import { parseCidrList } from './cidr.js';

export { parseCidrList, validateCidrList } from './cidr.js';

const DAY_MS = 86_400_000;

/**
 * When an account leaves probation. `createdAt` must be ISO-8601 with a zone
 * (`RequestAccount.createdAt` is normalised by `loadAccount`).
 */
export function maturityEndsAt(account: { createdAt: string }, config: ConfigReader): Date {
  return new Date(Date.parse(account.createdAt) + config.get('LIMITS_MATURITY_DAYS') * DAY_MS);
}

/**
 * True once the account is at least `LIMITS_MATURITY_DAYS` old. An unparseable
 * `createdAt` yields false, so a bad timestamp keeps the reduced limits.
 */
export function isMatureUser(
  account: { createdAt: string },
  config: ConfigReader,
  now: number = Date.now(),
): boolean {
  return now >= maturityEndsAt(account, config).getTime();
}

/** True when `ip` is inside `LIMITS_PRIVILEGED_CIDRS`. Only as trustworthy as `TRUST_PROXY`. */
export function isPrivilegedConnection(ip: string, config: ConfigReader): boolean {
  return parseCidrList(config.get('LIMITS_PRIVILEGED_CIDRS')).matches(ip);
}
