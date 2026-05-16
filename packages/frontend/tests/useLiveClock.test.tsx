import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLiveClock } from '@/hooks/useLiveClock';

describe('useLiveClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T14:23:08-04:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current ET time as HH:MM:SS', () => {
    const { result } = renderHook(() => useLiveClock());
    expect(result.current).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('updates every second', () => {
    const { result } = renderHook(() => useLiveClock());
    const before = result.current;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).not.toBe(before);
  });
});
