import { describe, it, expect } from 'vitest';
import { KeyedLock } from '../../src/limits/keyed-lock.js';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

describe('KeyedLock', () => {
  it('runs work on one key strictly one at a time', async () => {
    const lock = new KeyedLock();
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        lock.run('a', async () => {
          running += 1;
          peak = Math.max(peak, running);
          await tick();
          order.push(n);
          running -= 1;
        }),
      ),
    );
    expect(peak).toBe(1);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('lets different keys run together', async () => {
    const lock = new KeyedLock();
    let running = 0;
    let peak = 0;
    await Promise.all(
      ['a', 'b'].map((key) =>
        lock.run(key, async () => {
          running += 1;
          peak = Math.max(peak, running);
          await tick();
          running -= 1;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it('releases the key when the work throws, and forgets idle keys', async () => {
    const lock = new KeyedLock();
    await expect(
      lock.run('a', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(lock.run('a', async () => 'next')).resolves.toBe('next');
    expect(lock.size).toBe(0);
  });
});
