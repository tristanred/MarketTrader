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
}

function dedupKey(u: WsAchievementUnlockedEvent['data']): string {
  return `${u.achievementKey}:${u.unlockedAt}`;
}

/**
 * Strict serial queue for own-unlock toasts. The host displays `current`;
 * `dismiss(id)` promotes the head of `queue` into `current`. Enqueues that
 * match an existing (key, unlockedAt) are dropped — protects against
 * StrictMode double-mounts, WS reconnect replays, and multi-tab races.
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
    if (current === null) {
      set({ current: entry });
    } else {
      set({ queue: [...queue, entry] });
    }
  },
  dismiss(id) {
    const { current, queue } = get();
    if (!current || current.id !== id) return;
    const [next, ...rest] = queue;
    set({ current: next ?? null, queue: rest });
  },
}));
