import { describe, it, expect } from 'vitest';
import {
  analyzeButtonCaption,
  confidenceWord,
  type AnalyzeButtonState,
} from '@/components/analysis/analysisCopy';

describe('analyzeButtonCaption', () => {
  it.each<[AnalyzeButtonState, string | null]>([
    [{ kind: 'pending' }, null],
    [{ kind: 'generating' }, null],
    [{ kind: 'cached' }, 'Already analyzed — free to view'],
    [{ kind: 'unavailable', retryInSeconds: null }, 'Analysis unavailable'],
    [
      { kind: 'unavailable', retryInSeconds: 12 * 60 },
      'Analysis unavailable · try again in 12 minutes',
    ],
    [{ kind: 'exhausted', resetInSeconds: null }, 'Daily limit reached'],
    [{ kind: 'exhausted', resetInSeconds: 5 * 3_600 }, 'Daily limit reached · resets in 5 hours'],
    [{ kind: 'ready', caption: '7 of 10 left today' }, '7 of 10 left today'],
    [{ kind: 'ready', caption: null }, null],
  ])('%o → %s', (state, caption) => {
    expect(analyzeButtonCaption(state)).toBe(caption);
  });
});

describe('confidenceWord', () => {
  it.each([
    [0, 'Low'],
    [39, 'Low'],
    [40, 'Moderate'],
    [69, 'Moderate'],
    [70, 'High'],
    [100, 'High'],
  ] as const)('%i → %s', (n, word) => {
    expect(confidenceWord(n)).toBe(word);
  });
});
