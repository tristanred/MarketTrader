import type { FastifyRequest } from 'fastify';
import type { LimitBasis, LimitKey } from '@markettrader/shared';
import type { ConfigReader } from '../config/runtime-config.js';
import type { RequestAccount } from './account.js';
import type { LimitOverridesService } from './overrides.js';
import { LIMIT_CATALOGUE } from './catalogue.js';
import { isMatureUser, isPrivilegedConnection } from './policy.js';

/** Who is asking: the account when authenticated, and always the connection's IP. */
export interface LimitSubject {
  account?: RequestAccount;
  ip: string;
}

/** A limit as it applies to one subject right now. `max: null` means unlimited. */
export interface ResolvedLimit {
  key: LimitKey;
  max: number | null;
  basis: LimitBasis;
  /** True when the privileged multiplier was applied. */
  privileged: boolean;
  /** True when the max was reduced because the account is new. */
  probation: boolean;
}

/** The reduced value for an account on probation: `percent`% of `base`, rounded up, at least 1. */
export function probationValue(base: number, percent: number): number {
  return Math.max(1, Math.ceil((base * percent) / 100));
}

/** The limit subject of an incoming request. */
export function subjectOf(request: FastifyRequest): LimitSubject {
  return { ip: request.ip, ...(request.account ? { account: request.account } : {}) };
}

/**
 * Decides one subject's limit, in this order: disabled, admin (unlimited),
 * per-user override (exact, no multiplier), base value reduced while the
 * account is on probation, then multiplied on a privileged IP.
 * Every value is read live on each call.
 */
export class LimitResolver {
  constructor(
    private readonly config: ConfigReader,
    private readonly overrides: Pick<LimitOverridesService, 'get'>,
    private readonly opts: { disabled?: boolean } = {},
  ) {}

  /** True when every limit is lifted: by the test fixture or by `LIMITS_ENABLED=false`. */
  isDisabled(): boolean {
    return this.opts.disabled === true || !this.config.get('LIMITS_ENABLED');
  }

  /** The global value of `key`, before probation, overrides, or multipliers. */
  baseValue(key: LimitKey): number {
    return this.config.get(LIMIT_CATALOGUE[key].configKey);
  }

  /** Resolves `key` for `subject`; see the class doc for precedence. */
  async resolve(subject: LimitSubject, key: LimitKey): Promise<ResolvedLimit> {
    if (this.isDisabled()) return unlimited(key, 'disabled');
    const { account } = subject;
    if (account?.isAdmin) return unlimited(key, 'admin');

    const descriptor = LIMIT_CATALOGUE[key];
    if (account && descriptor.overridable) {
      const override = await this.overrides.get(account.id, key);
      if (override !== undefined) {
        return { key, max: override, basis: 'override', privileged: false, probation: false };
      }
    }

    let max = this.baseValue(key);
    let basis: LimitBasis = 'base';
    let probation = false;
    if (account && descriptor.probation && !isMatureUser(account, this.config)) {
      max = probationValue(max, this.config.get('LIMITS_PROBATION_PERCENT'));
      basis = 'probation';
      probation = true;
    }

    const privileged = isPrivilegedConnection(subject.ip, this.config);
    if (privileged) max *= this.config.get('LIMITS_PRIVILEGED_MULTIPLIER');
    return { key, max, basis, privileged, probation };
  }

  /**
   * The limit for `account` on an ordinary connection. For admin views, where
   * privilege depends on where a request comes from, not who sent it.
   */
  resolveForUser(account: RequestAccount, key: LimitKey): Promise<ResolvedLimit> {
    return this.resolve({ account, ip: '' }, key);
  }
}

function unlimited(key: LimitKey, basis: 'disabled' | 'admin'): ResolvedLimit {
  return { key, max: null, basis, privileged: false, probation: false };
}
