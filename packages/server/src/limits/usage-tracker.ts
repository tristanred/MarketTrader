import type { FastifyRequest } from 'fastify';
import { SlidingWindowCounter } from './sliding-window.js';
import type { LimitSubject } from './resolver.js';

/** Who a request or denial is attributed to: an account, or the client IP when logged out. */
export interface UsageSubject {
  type: 'user' | 'ip';
  id: string;
}

/** Buffered request count for one subject, route pattern and UTC hour. */
export interface RequestUsageRow {
  subjectType: UsageSubject['type'];
  subjectId: string;
  /** `METHOD /registered/:pattern`, or `* <unmatched>` for a 404. */
  route: string;
  /** ISO 8601 start of the UTC hour. */
  hourStart: string;
  count: number;
}

/** Buffered denial count for one subject, limit and UTC hour. */
export interface DenialUsageRow {
  subjectType: UsageSubject['type'];
  subjectId: string;
  /** A `LimitKey`, or `ip:<METHOD /route>` for a per-IP rate config. */
  limitKey: string;
  hourStart: string;
  count: number;
  firstAt: string;
  lastAt: string;
}

/**
 * Everything buffered since the last {@link UsageTracker.swap}. `overflow`
 * counts increments diverted to {@link OVERFLOW_SUBJECT_ID} because the key bound was hit.
 */
export interface UsageSnapshot {
  requests: RequestUsageRow[];
  denials: DenialUsageRow[];
  overflow: { requests: number; denials: number };
}

/** Subject id that absorbs increments for new keys once a buffer is full. */
export const OVERFLOW_SUBJECT_ID = '*overflow*';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** ISO start of the UTC hour containing `ms`. */
export function hourStartOf(ms: number): string {
  return new Date(Math.floor(ms / HOUR_MS) * HOUR_MS).toISOString();
}

/** The account behind a request, or its IP when it carries none. */
export function subjectForUsage(request: FastifyRequest): UsageSubject {
  return request.account
    ? { type: 'user', id: request.account.id }
    : { type: 'ip', id: request.ip };
}

/** The same attribution for a limit subject (used by the denial recorder). */
export function usageSubjectOf(subject: LimitSubject): UsageSubject {
  return subject.account
    ? { type: 'user', id: subject.account.id }
    : { type: 'ip', id: subject.ip };
}

function rowKey(...parts: string[]): string {
  return parts.join('\u0000');
}

/**
 * In-process request and denial counters, flushed to the hourly rollup tables
 * by the usage-rollup worker. Writing a row per request would put a database
 * write on every call, and a row per denial would let a script hammering a
 * limit turn its refusals into a write flood — so both aggregate here first.
 *
 * Bounded: past `maxRequestKeys` / `maxDenialKeys` distinct keys, new subjects
 * are counted under {@link OVERFLOW_SUBJECT_ID} until the next swap.
 */
export class UsageTracker {
  private requests = new Map<string, RequestUsageRow>();
  private denials = new Map<string, DenialUsageRow>();
  private overflow = { requests: 0, denials: 0 };
  private readonly minute: SlidingWindowCounter;
  private readonly maxRequestKeys: number;
  private readonly maxDenialKeys: number;
  private readonly now: () => number;

  constructor(opts: { maxRequestKeys?: number; maxDenialKeys?: number; now?: () => number } = {}) {
    this.maxRequestKeys = opts.maxRequestKeys ?? 50_000;
    this.maxDenialKeys = opts.maxDenialKeys ?? 10_000;
    this.now = opts.now ?? Date.now;
    this.minute = new SlidingWindowCounter(MINUTE_MS, this.now);
  }

  recordRequest(subject: UsageSubject, route: string): void {
    const hourStart = hourStartOf(this.now());
    let subjectId = subject.id;
    let key = rowKey(subject.type, subjectId, route, hourStart);
    if (!this.requests.has(key) && this.requests.size >= this.maxRequestKeys) {
      subjectId = OVERFLOW_SUBJECT_ID;
      key = rowKey(subject.type, subjectId, route, hourStart);
      this.overflow.requests += 1;
    }
    const row = this.requests.get(key);
    if (row) row.count += 1;
    else this.requests.set(key, { subjectType: subject.type, subjectId, route, hourStart, count: 1 });
  }

  recordDenial(subject: UsageSubject, limitKey: string): void {
    const at = this.now();
    const hourStart = hourStartOf(at);
    const iso = new Date(at).toISOString();
    let subjectId = subject.id;
    let key = rowKey(subject.type, subjectId, limitKey, hourStart);
    if (!this.denials.has(key) && this.denials.size >= this.maxDenialKeys) {
      subjectId = OVERFLOW_SUBJECT_ID;
      key = rowKey(subject.type, subjectId, limitKey, hourStart);
      this.overflow.denials += 1;
    }
    const row = this.denials.get(key);
    if (row) {
      row.count += 1;
      row.lastAt = iso;
    } else {
      this.denials.set(key, {
        subjectType: subject.type, subjectId, limitKey, hourStart, count: 1, firstAt: iso, lastAt: iso,
      });
    }
  }

  /**
   * Drops every buffered row attributed to `userId`, so a flush after the
   * account is deleted cannot write its usage back. IP-subject rows are kept.
   */
  forgetUser(userId: string): void {
    for (const [key, row] of this.requests) {
      if (row.subjectType === 'user' && row.subjectId === userId) this.requests.delete(key);
    }
    for (const [key, row] of this.denials) {
      if (row.subjectType === 'user' && row.subjectId === userId) this.denials.delete(key);
    }
  }

  /** Counts one request toward `userId`'s sliding minute and returns the total including it. */
  hitMinute(userId: string): number {
    return this.minute.hit(userId);
  }

  peekMinute(userId: string): number {
    return this.minute.peek(userId);
  }

  /** Hands the buffers to the caller and starts fresh ones, so no increment is lost mid-flush. */
  swap(): UsageSnapshot {
    const snapshot: UsageSnapshot = {
      requests: [...this.requests.values()],
      denials: [...this.denials.values()],
      overflow: this.overflow,
    };
    this.requests = new Map();
    this.denials = new Map();
    this.overflow = { requests: 0, denials: 0 };
    return snapshot;
  }

  /** A copy of what is buffered but not yet flushed — merged into admin reads so they are current. */
  snapshotView(): UsageSnapshot {
    return {
      requests: [...this.requests.values()].map((row) => ({ ...row })),
      denials: [...this.denials.values()].map((row) => ({ ...row })),
      overflow: { ...this.overflow },
    };
  }
}
