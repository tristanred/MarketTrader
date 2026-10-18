import { describe, it, expect } from 'vitest';
import { AnalysisBreaker } from '../../src/services/stock-analysis/breaker.js';
import { LlmError, type LlmErrorCode } from '../../src/providers/llm/interface.js';

const t0 = 1_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const err = (code: LlmErrorCode, retryAfterMs?: number) =>
  new LlmError(code, code, { reachedModel: false, retryAfterMs });

describe('AnalysisBreaker', () => {
  it('is closed until tripped, and closes again after the pause', () => {
    const b = new AnalysisBreaker();
    expect(b.openUntil('m', t0)).toBeUndefined();
    b.open(err('RATE_LIMITED', 30_000), 'm', t0);
    expect(b.openUntil('m', t0 + 29_000)).toBe(t0 + 30_000);
    expect(b.openUntil('m', t0 + 30_000)).toBeUndefined();
  });

  it.each([
    ['NO_CREDITS', 15 * MINUTE],
    ['AUTH', HOUR],
    ['RATE_LIMITED', MINUTE],
  ] as const)('pauses %s for its default when the upstream gives no delay', (code, pause) => {
    const b = new AnalysisBreaker();
    b.open(err(code), 'm', t0);
    expect(b.openUntil('m', t0)).toBe(t0 + pause);
  });

  it('caps an absurd delay at a day', () => {
    const b = new AnalysisBreaker();
    b.open(err('SPEND_LIMIT', 365 * 24 * HOUR), 'm', t0);
    expect(b.openUntil('m', t0)).toBe(t0 + 24 * HOUR);
  });

  it('keeps the later deadline when tripped twice', () => {
    const b = new AnalysisBreaker();
    b.open(err('AUTH'), 'm', t0);
    b.open(err('RATE_LIMITED', 1_000), 'm', t0);
    expect(b.openUntil('m', t0)).toBe(t0 + HOUR);
  });

  it('scopes a bad-request pause to the model that caused it', () => {
    const b = new AnalysisBreaker();
    b.open(err('BAD_REQUEST'), 'vendor/typo', t0);
    expect(b.openUntil('vendor/typo', t0)).toBeDefined();
    expect(b.openUntil('openrouter/free', t0)).toBeUndefined();
  });

  it('keeps account and model pauses independent', () => {
    const b = new AnalysisBreaker();
    b.open(err('AUTH'), 'm', t0);
    // A later bad-request trip must not let a model change lift the account pause.
    b.open(err('BAD_REQUEST', 2 * HOUR), 'm', t0);
    expect(b.openUntil('other', t0)).toBe(t0 + HOUR);
    expect(b.openUntil('m', t0)).toBe(t0 + 2 * HOUR);
    // A short account-wide trip must not shorten the model pause.
    const c = new AnalysisBreaker();
    c.open(err('BAD_REQUEST'), 'm', t0);
    c.open(err('RATE_LIMITED', 1_000), 'm', t0);
    expect(c.openUntil('m', t0)).toBe(t0 + 15 * MINUTE);
  });
});
