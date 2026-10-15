import { describe, it, expect } from 'vitest';
import { SlidingWindowCounter } from '../../src/limits/sliding-window.js';

describe('SlidingWindowCounter', () => {
  function clock(start = 0) {
    let t = start;
    return { now: () => t, set: (v: number) => { t = v; } };
  }

  it('counts hits inside the window', () => {
    const c = clock();
    const counter = new SlidingWindowCounter(60_000, c.now);
    expect(counter.hit('u1')).toBe(1);
    expect(counter.hit('u1')).toBe(2);
    expect(counter.hit('u1')).toBe(3);
    expect(counter.peek('u1')).toBe(3);
    expect(counter.peek('u2')).toBe(0);
  });

  it('keeps counts separate per key', () => {
    const c = clock();
    const counter = new SlidingWindowCounter(60_000, c.now);
    counter.hit('a');
    counter.hit('a');
    counter.hit('b');
    expect(counter.peek('a')).toBe(2);
    expect(counter.peek('b')).toBe(1);
  });

  it('decays the oldest half-window linearly and forgets it after a full window', () => {
    const c = clock();
    const counter = new SlidingWindowCounter(60_000, c.now);
    counter.hit('u');
    counter.hit('u');
    counter.hit('u'); // bucket 0: 3
    c.set(30_000);
    expect(counter.hit('u')).toBe(4); // bucket 1: 1, bucket 0 still fully inside
    c.set(60_000);
    expect(counter.peek('u')).toBe(4); // bucket 0 is now the oldest, weight 1
    c.set(75_000);
    expect(counter.peek('u')).toBe(2.5); // 1 + 3 × 0.5
    c.set(90_000);
    expect(counter.peek('u')).toBe(1); // bucket 0 gone, bucket 1 is the oldest
    c.set(200_000);
    expect(counter.peek('u')).toBe(0);
  });

  it('prunes keys idle for more than a window', () => {
    const c = clock();
    const counter = new SlidingWindowCounter(60_000, c.now);
    counter.hit('stale');
    c.set(120_000);
    counter.hit('fresh');
    counter.prune();
    expect(counter.size).toBe(1);
    expect(counter.peek('fresh')).toBe(1);
  });
});
