import { create } from 'zustand';
import type { AchievementRarity } from '@markettrader/shared';

/**
 * Persistable achievement-unlock event shown in the Activity panel.
 * Sourced from REST (persisted history) and from live WS broadcasts.
 */
export interface AchievementActivityEvent {
  gamePlayerId: string;
  achievementKey: string;
  name: string;
  rarity: AchievementRarity;
  icon: string;
  unlockedAt: string;
}

interface ActivityFeedState {
  unlocks: Record<string, AchievementActivityEvent[]>;
  addUnlock(gameId: string, event: AchievementActivityEvent): void;
  seedUnlocks(gameId: string, events: AchievementActivityEvent[]): void;
  resetForGame(gameId: string): void;
}

function dedupKey(e: AchievementActivityEvent): string {
  return `${e.gamePlayerId}:${e.achievementKey}`;
}

/**
 * Cross-component store for achievement-unlock activity, keyed by gameId.
 * Both `addUnlock` and `seedUnlocks` dedupe by `(gamePlayerId, achievementKey)`
 * so REST seeds, WS replays, and live broadcasts merge idempotently.
 */
export const useActivityFeedStore = create<ActivityFeedState>((set, get) => ({
  unlocks: {},
  addUnlock(gameId, event) {
    const existing = get().unlocks[gameId] ?? [];
    const k = dedupKey(event);
    if (existing.some((e) => dedupKey(e) === k)) return;
    set({ unlocks: { ...get().unlocks, [gameId]: [...existing, event] } });
  },
  seedUnlocks(gameId, events) {
    const existing = get().unlocks[gameId] ?? [];
    const seen = new Set(existing.map(dedupKey));
    const merged = [...existing];
    for (const e of events) {
      const k = dedupKey(e);
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(e);
    }
    if (merged.length === existing.length) return;
    set({ unlocks: { ...get().unlocks, [gameId]: merged } });
  },
  resetForGame(gameId) {
    const next = { ...get().unlocks };
    delete next[gameId];
    set({ unlocks: next });
  },
}));
