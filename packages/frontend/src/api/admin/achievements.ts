import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  AdminGameAchievementsView,
  AdminGlobalAchievementsView,
  AchievementProgressDTO,
} from '@markettrader/shared';

export const adminAchievementsKeys = {
  all: ['admin', 'achievements'] as const,
  game: (gameId: string) => [...adminAchievementsKeys.all, 'game', gameId] as const,
  global: () => [...adminAchievementsKeys.all, 'global'] as const,
};

export function useAdminGameAchievements(gameId: string) {
  return useQuery({
    queryKey: adminAchievementsKeys.game(gameId),
    queryFn: () =>
      apiFetch<AdminGameAchievementsView>(`/admin/games/${gameId}/achievements`),
    enabled: !!gameId,
  });
}

export function useAdminGlobalAchievements() {
  return useQuery({
    queryKey: adminAchievementsKeys.global(),
    queryFn: () => apiFetch<AdminGlobalAchievementsView>('/admin/achievements'),
  });
}

/** Player-facing cache key shared with `useAchievements` in api/achievements.ts. */
function playerAchievementsKey(gameId: string) {
  return ['achievements', gameId, 'all'] as const;
}

interface PlayerKeyArgs {
  gamePlayerId: string;
  key: string;
}

export function useAdminUnlockAchievement(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ gamePlayerId, key }: PlayerKeyArgs) =>
      apiFetch<AchievementProgressDTO>(
        `/admin/games/${gameId}/players/${gamePlayerId}/achievements/${key}/unlock`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminAchievementsKeys.all });
      void qc.invalidateQueries({ queryKey: playerAchievementsKey(gameId) });
    },
  });
}

export function useAdminResetAchievement(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ gamePlayerId, key }: PlayerKeyArgs) =>
      apiFetch<AchievementProgressDTO>(
        `/admin/games/${gameId}/players/${gamePlayerId}/achievements/${key}/reset`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminAchievementsKeys.all });
      void qc.invalidateQueries({ queryKey: playerAchievementsKey(gameId) });
    },
  });
}

export function useAdminSetAchievementProgress(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ gamePlayerId, key, progress }: PlayerKeyArgs & { progress: number }) =>
      apiFetch<AchievementProgressDTO>(
        `/admin/games/${gameId}/players/${gamePlayerId}/achievements/${key}`,
        { method: 'PATCH', body: { progress } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminAchievementsKeys.all });
      void qc.invalidateQueries({ queryKey: playerAchievementsKey(gameId) });
    },
  });
}

export function useAdminSetGameAchievementEnabled(gameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      apiFetch<{ enabled: boolean }>(
        `/admin/games/${gameId}/achievements/${key}`,
        { method: 'PATCH', body: { enabled } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminAchievementsKeys.all });
      void qc.invalidateQueries({ queryKey: playerAchievementsKey(gameId) });
    },
  });
}

export function useAdminSetGlobalAchievementEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      apiFetch<{ enabled: boolean }>(
        `/admin/achievements/${key}`,
        { method: 'PATCH', body: { enabled } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminAchievementsKeys.all });
      // Player-facing achievements list may change game-wide on global toggle.
      void qc.invalidateQueries({ queryKey: ['achievements'] });
    },
  });
}
