import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FailedLoginTracker } from '../../src/services/failed-login.js';
import { RuntimeConfig } from '../../src/config/runtime-config.js';

const OPTS = { maxAttempts: 3, windowMs: 60_000, lockoutMs: 300_000 };

const limits = () =>
  RuntimeConfig.fromEnvironment({
    LOGIN_MAX_FAILED_ATTEMPTS: OPTS.maxAttempts,
    LOGIN_FAILURE_WINDOW_MS: OPTS.windowMs,
    LOGIN_LOCKOUT_MS: OPTS.lockoutMs,
  });

describe('FailedLoginTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays quiet below the threshold', () => {
    const tracker = new FailedLoginTracker(limits());
    expect(tracker.recordFailure('alice')).toBe(false);
    expect(tracker.recordFailure('alice')).toBe(false);
    expect(tracker.retryAfterMs('alice')).toBeNull();
  });

  it('engages on the nth failure and reports the remaining lockout', () => {
    const tracker = new FailedLoginTracker(limits());
    tracker.recordFailure('alice');
    tracker.recordFailure('alice');
    expect(tracker.recordFailure('alice')).toBe(true);
    expect(tracker.retryAfterMs('alice')).toBe(OPTS.lockoutMs);
  });

  it('throttles only the account that failed', () => {
    const tracker = new FailedLoginTracker(limits());
    for (let i = 0; i < OPTS.maxAttempts; i++) tracker.recordFailure('alice');
    expect(tracker.retryAfterMs('alice')).not.toBeNull();
    expect(tracker.retryAfterMs('bob')).toBeNull();
  });

  it('releases the account once the lockout expires', () => {
    const tracker = new FailedLoginTracker(limits());
    for (let i = 0; i < OPTS.maxAttempts; i++) tracker.recordFailure('alice');

    vi.advanceTimersByTime(OPTS.lockoutMs - 1);
    expect(tracker.retryAfterMs('alice')).toBe(1);

    vi.advanceTimersByTime(1);
    expect(tracker.retryAfterMs('alice')).toBeNull();
  });

  it('starts the count over after the lockout, rather than re-locking immediately', () => {
    const tracker = new FailedLoginTracker(limits());
    for (let i = 0; i < OPTS.maxAttempts; i++) tracker.recordFailure('alice');

    vi.advanceTimersByTime(OPTS.lockoutMs);
    expect(tracker.retryAfterMs('alice')).toBeNull();

    expect(tracker.recordFailure('alice')).toBe(false);
    expect(tracker.retryAfterMs('alice')).toBeNull();
  });

  it('forgets failures older than the window', () => {
    const tracker = new FailedLoginTracker(limits());
    tracker.recordFailure('alice');
    tracker.recordFailure('alice');

    vi.advanceTimersByTime(OPTS.windowMs);

    // Third failure, but the first two have aged out — the count restarts at 1.
    expect(tracker.recordFailure('alice')).toBe(false);
    expect(tracker.retryAfterMs('alice')).toBeNull();
  });

  it('clears the count on reset', () => {
    const tracker = new FailedLoginTracker(limits());
    tracker.recordFailure('alice');
    tracker.recordFailure('alice');
    tracker.reset('alice');
    expect(tracker.recordFailure('alice')).toBe(false);
    expect(tracker.retryAfterMs('alice')).toBeNull();
  });

  it('reports engagement once, not on every subsequent failure', () => {
    const tracker = new FailedLoginTracker(limits());
    tracker.recordFailure('alice');
    tracker.recordFailure('alice');
    expect(tracker.recordFailure('alice')).toBe(true);
    expect(tracker.recordFailure('alice')).toBe(false);
  });

  it('is inert when disabled', () => {
    const tracker = new FailedLoginTracker(limits(), { disabled: true });
    for (let i = 0; i < OPTS.maxAttempts * 5; i++) {
      expect(tracker.recordFailure('alice')).toBe(false);
    }
    expect(tracker.retryAfterMs('alice')).toBeNull();
  });

  it('stays bounded while an attacker enumerates usernames', () => {
    // Failures are recorded for names that do not exist, so an unbounded map
    // would be a memory-exhaustion vector rather than a defence.
    const tracker = new FailedLoginTracker(limits());
    for (let i = 0; i < 20_000; i++) {
      tracker.recordFailure(`user-${i}`);
      // Keep the sweep from finding anything expired to reclaim.
      vi.advanceTimersByTime(1);
    }
    expect(size(tracker)).toBeLessThanOrEqual(5000);

    // Eviction is oldest-first, so a currently locked account survives the churn.
    const victim = new FailedLoginTracker(limits());
    for (let i = 0; i < OPTS.maxAttempts; i++) victim.recordFailure('alice');
    for (let i = 0; i < 6000; i++) victim.recordFailure(`user-${i}`);
    expect(victim.retryAfterMs('alice')).not.toBeNull();
  });
});

/** Reaches into the private map — the bound is the invariant under test. */
function size(tracker: FailedLoginTracker): number {
  return (tracker as unknown as { entries: Map<string, unknown> }).entries.size;
}

describe('FailedLoginTracker with a runtime override', () => {
  it('applies a lowered threshold to an existing tracker', () => {
    const config = RuntimeConfig.fromEnvironment({
      LOGIN_MAX_FAILED_ATTEMPTS: 5,
      LOGIN_FAILURE_WINDOW_MS: OPTS.windowMs,
      LOGIN_LOCKOUT_MS: OPTS.lockoutMs,
    });
    const tracker = new FailedLoginTracker(config);
    config.set('LOGIN_MAX_FAILED_ATTEMPTS', 3);
    expect(tracker.recordFailure('alice')).toBe(false);
    expect(tracker.recordFailure('alice')).toBe(false);
    expect(tracker.recordFailure('alice')).toBe(true);
    expect(tracker.retryAfterMs('alice')).not.toBeNull();
  });
});
