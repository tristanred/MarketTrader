import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AchievementToast } from './AchievementToast';
import { useAchievementToastStore } from '@/stores/achievementToastStore';

// Beat between one toast finishing its exit and the next one entering.
const GAP_MS = 1_000;

/**
 * Single instance, mounted in AppShell. Renders the currently-displayed
 * toast in a top-center fixed slot below the ticker tape. The store enforces
 * strict serial display — only one toast is rendered at a time.
 *
 * Drives serial playback of a multi-unlock stack: when the active toast
 * dismisses (store `current` → null) and more are queued, this waits out a
 * one-second gap, then promotes the next. The null window also remounts the
 * toast component, guaranteeing each unlock replays its entrance animation.
 */
export function AchievementToastHost() {
  const current = useAchievementToastStore((s) => s.current);
  const hasQueued = useAchievementToastStore((s) => s.queue.length > 0);
  const promoteNext = useAchievementToastStore((s) => s.promoteNext);
  const { gameId } = useParams<{ gameId?: string }>();

  useEffect(() => {
    if (current !== null || !hasQueued) return;
    const timer = window.setTimeout(promoteNext, GAP_MS);
    return () => window.clearTimeout(timer);
  }, [current, hasQueued, promoteNext]);

  if (!current || !gameId) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-50"
      style={{ top: 76 }}
      aria-live="polite"
      aria-atomic="true"
    >
      <AchievementToast key={current.id} gameId={gameId} toast={current} />
    </div>
  );
}
