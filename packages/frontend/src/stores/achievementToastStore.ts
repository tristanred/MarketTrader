import { create } from 'zustand';
import type { WsAchievementUnlockedEvent } from '@markettrader/shared';

export interface AchievementToast {
  id: string;
  unlock: WsAchievementUnlockedEvent['data'];
  enqueuedAt: number;
}

interface AchievementToastStore {
  current: AchievementToast | null;
  queue: AchievementToast[];
  enqueue(unlock: WsAchievementUnlockedEvent['data']): void;
  dismiss(id: string): void;
  promoteNext(): void;
}

function dedupKey(u: WsAchievementUnlockedEvent['data']): string {
  return `${u.achievementKey}:${u.unlockedAt}`;
}

/**
 * Strict serial queue for own-unlock toasts. The host displays `current`.
 * `dismiss(id)` clears `current` to null; the host then waits out the
 * inter-toast gap and calls `promoteNext()` to pull the queue head in. The
 * null gap doubles as the remount boundary for the toast component, so each
 * unlock plays a fresh entrance animation. Enqueues that match an existing
 * (key, unlockedAt) are dropped — protects against StrictMode double-mounts,
 * WS reconnect replays, and multi-tab races.
 */
export const useAchievementToastStore = create<AchievementToastStore>((set, get) => ({
  current: null,
  queue: [],
  enqueue(unlock) {
    const { current, queue } = get();
    const k = dedupKey(unlock);
    if (current && dedupKey(current.unlock) === k) return;
    if (queue.some((t) => dedupKey(t.unlock) === k)) return;
    const entry: AchievementToast = {
      id: crypto.randomUUID(),
      unlock,
      enqueuedAt: Date.now(),
    };
    // Only jump straight to `current` when nothing is in flight. A null
    // `current` with a non-empty queue means we're mid inter-toast gap — a
    // newcomer must wait its turn, not cut the line.
    if (current === null && queue.length === 0) {
      set({ current: entry });
    } else {
      set({ queue: [...queue, entry] });
    }
  },
  dismiss(id) {
    const { current } = get();
    if (!current || current.id !== id) return;
    set({ current: null });
  },
  promoteNext() {
    const { current, queue } = get();
    const next = queue[0];
    if (current !== null || next === undefined) return;
    set({ current: next, queue: queue.slice(1) });
  },
}));
