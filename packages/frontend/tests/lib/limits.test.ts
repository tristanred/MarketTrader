import { beforeEach, describe, expect, it } from 'vitest';
import type { LimitExceededBody } from '@markettrader/shared';
import { ApiError } from '@/lib/api';
import { formatLimitMessage, formatRetryAfter, isLimitExceeded } from '@/lib/limits';
import { extractApiMessage } from '@/lib/extractApiMessage';
import { toastApiError } from '@/lib/toastApiError';
import { useToastStore } from '@/components/ui/toast';

const body: LimitExceededBody = {
  error: 'Game creation limit reached (3 per week)',
  code: 'LIMIT_EXCEEDED',
  limit: 'gamesCreated',
  max: 3,
  probation: false,
  retryAfterSeconds: 2 * 86_400,
};

describe('isLimitExceeded', () => {
  it('recognises a limit body on an ApiError', () => {
    expect(isLimitExceeded(new ApiError(429, body, '429 Too Many Requests'))).toBe(true);
  });

  it('rejects other errors and other bodies', () => {
    expect(isLimitExceeded(new ApiError(409, { error: 'nope' }, '409'))).toBe(false);
    expect(isLimitExceeded(new ApiError(429, null, '429'))).toBe(false);
    expect(isLimitExceeded(new Error('x'))).toBe(false);
  });
});

describe('formatRetryAfter', () => {
  it.each([
    [1, 'in 1 second'],
    [45, 'in 45 seconds'],
    [60, 'in 1 minute'],
    [150, 'in 3 minutes'],
    [3_600, 'in 1 hour'],
    [7_200, 'in 2 hours'],
    [86_400, 'in 1 day'],
    [2 * 86_400 + 5, 'in 3 days'],
  ])('%i s → %s', (seconds, text) => {
    expect(formatRetryAfter(seconds)).toBe(text);
  });
});

describe('formatLimitMessage', () => {
  it('states the limit and when to retry', () => {
    expect(formatLimitMessage(body)).toBe(
      'Game creation limit reached (3 per week). You can try again in 2 days.',
    );
  });

  it('omits the retry sentence when the limit is a concurrent cap', () => {
    const concurrent: LimitExceededBody = {
      error: body.error,
      code: body.code,
      limit: body.limit,
      max: body.max,
      probation: body.probation,
    };
    expect(formatLimitMessage(concurrent)).toBe('Game creation limit reached (3 per week).');
  });

  it('explains probation when it is the reason', () => {
    expect(formatLimitMessage({ ...body, probation: true, maturityDays: 7 })).toBe(
      'Game creation limit reached (3 per week). You can try again in 2 days. ' +
        'New accounts have lower limits for their first 7 days.',
    );
    expect(formatLimitMessage({ ...body, probation: true })).toContain(
      'New accounts have lower limits for their first few days.',
    );
  });
});

describe('error surfaces', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it('extractApiMessage formats a limit body', () => {
    expect(extractApiMessage(new ApiError(429, body, '429'))).toBe(
      'Game creation limit reached (3 per week). You can try again in 2 days.',
    );
  });

  // apiFetch already builds the message as "<status> <statusText>".
  it('extractApiMessage does not repeat the status of a body-less error', () => {
    expect(extractApiMessage(new ApiError(502, null, '502 Bad Gateway'))).toBe('502 Bad Gateway');
    expect(extractApiMessage(new ApiError(400, null, 'Bad Request'))).toBe('400 Bad Request');
  });

  it('toastApiError titles a limit toast "Limit reached"', () => {
    toastApiError(new ApiError(429, body, '429'), 'Failed to create game');
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      title: 'Limit reached',
      description: 'Game creation limit reached (3 per week). You can try again in 2 days.',
      variant: 'destructive',
    });
  });

  it('toastApiError keeps the caller title for other errors', () => {
    toastApiError(new ApiError(409, { error: 'Already joined' }, '409'), 'Failed to join');
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      title: 'Failed to join',
      description: 'Already joined',
    });
  });
});
