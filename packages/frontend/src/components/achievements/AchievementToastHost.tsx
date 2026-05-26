import { useParams } from 'react-router-dom';
import { AchievementToast } from './AchievementToast';
import { useAchievementToastStore } from '@/stores/achievementToastStore';

/**
 * Single instance, mounted in AppShell. Renders the currently-displayed
 * toast in a top-center fixed slot below the ticker tape. The store enforces
 * strict serial display — only one toast is rendered at a time.
 */
export function AchievementToastHost() {
  const current = useAchievementToastStore((s) => s.current);
  const { gameId } = useParams<{ gameId?: string }>();

  if (!current || !gameId) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-50"
      style={{ top: 76 }}
      aria-live="polite"
      aria-atomic="true"
    >
      <AchievementToast gameId={gameId} toast={current} />
    </div>
  );
}
