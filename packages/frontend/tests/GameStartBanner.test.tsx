import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameStartBanner } from '@/components/game/arena/GameStartBanner';

const NOW = Date.parse('2026-11-06T12:00:00.000Z');
const SECOND = 1_000;
const HOUR = 3_600 * SECOND;
const DAY = 24 * HOUR;

const startingIn = (ms: number) => new Date(NOW + ms).toISOString();

describe('GameStartBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['days and hours from a day out', 2 * DAY + 4 * HOUR, 'in 2d 4h'],
    ['days and hours at exactly one day', DAY, 'in 1d 0h'],
    ['a clock just under a day out', DAY - SECOND, 'in 23:59:59'],
    ['a zero-padded clock', 3 * HOUR + 5 * SECOND, 'in 03:00:05'],
    ['the last second', SECOND, 'in 00:00:01'],
    ['no zero clock while time remains', 400, 'in 00:00:01'],
    ['Starting… at zero', 0, 'Starting…'],
    ['Starting… past the start', -5 * SECOND, 'Starting…'],
  ])('shows %s', (_name, remaining, expected) => {
    render(<GameStartBanner startDate={startingIn(remaining)} />);
    expect(screen.getByRole('region', { name: 'Game start' })).toHaveTextContent(expected);
  });

  it('counts down each second', () => {
    render(<GameStartBanner startDate={startingIn(10 * SECOND)} />);
    act(() => {
      vi.advanceTimersByTime(3 * SECOND);
    });
    expect(screen.getByRole('region', { name: 'Game start' })).toHaveTextContent('in 00:00:07');
  });

  it('reaches Starting… without being re-rendered by its parent', () => {
    render(<GameStartBanner startDate={startingIn(SECOND)} />);
    act(() => {
      vi.advanceTimersByTime(SECOND);
    });
    expect(screen.getByRole('region', { name: 'Game start' })).toHaveTextContent('Starting…');
  });

  it('stops ticking on unmount', () => {
    const { unmount } = render(<GameStartBanner startDate={startingIn(HOUR)} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
