import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAchievementIcon } from './icon';
import { rarityClass, rarityLabel } from './rarity';
import { useAchievementToastStore, type AchievementToast as ToastEntry } from '@/stores/achievementToastStore';
import { advanceSeenMarker } from '@/lib/achievementSeenMarker';
import { ackAchievementUnlock } from '@/api/achievements';
import styles from './AchievementToast.module.css';

const DISPLAY_MS = 6_000;
const EXIT_MS = 220;

interface AchievementToastProps {
  gameId: string;
  toast: ToastEntry;
}

function relativeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Single in-flight unlock toast. Owns its own auto-dismiss timer and exit
 * animation. On dismissal: marks the localStorage seen marker, fires the
 * server ack (best-effort), then asks the store to advance.
 */
export function AchievementToast({ gameId, toast }: AchievementToastProps) {
  const dismiss = useAchievementToastStore((s) => s.dismiss);
  const promoteNext = useAchievementToastStore((s) => s.promoteNext);
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<number | null>(null);

  // `manual` is true for the × button: it skips the inter-toast gap and
  // advances the stack immediately, per the design spec. The auto-dismiss
  // path leaves `current` null so the host can hold the 1s beat.
  const finish = (manual = false) => {
    if (exiting) return;
    setExiting(true);
    advanceSeenMarker(gameId, toast.unlock.gamePlayerId, toast.unlock.unlockedAt);
    void Promise.resolve(
      ackAchievementUnlock(gameId, toast.unlock.gamePlayerId, toast.unlock.unlockedAt),
    ).catch((err) => {
      // TODO(achievements-ack-retry): spec requires one silent retry on failure;
      // replay-on-reconnect is the fallback if both attempts fail.
      console.warn('[AchievementToast] ack failed — replay on reconnect will cover it', err);
    });
    exitTimerRef.current = window.setTimeout(() => {
      dismiss(toast.id);
      if (manual) promoteNext();
    }, EXIT_MS);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => finish(), DISPLAY_MS);
    return () => {
      window.clearTimeout(timer);
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
    };
  }, [toast.id]);

  const Icon = getAchievementIcon(toast.unlock.icon);
  const eyebrow = toast.unlock.replayed
    ? `${rarityLabel(toast.unlock.rarity).toUpperCase()} · UNLOCKED · ${relativeAgo(toast.unlock.unlockedAt).toUpperCase()}`
    : `${rarityLabel(toast.unlock.rarity).toUpperCase()} · UNLOCKED`;

  return (
    <div className={cn(styles.toast, exiting && styles.toastExit, rarityClass(toast.unlock.rarity))} role="status">
      <span className={styles.icon}>
        <Icon width={26} height={26} strokeWidth={1.6} />
      </span>
      <div className={styles.body}>
        <div className={cn(styles.eyebrow, 'font-mono text-[9px] tracking-[0.22em]')} style={{ color: 'var(--rarity)' }}>
          {eyebrow}
        </div>
        <div className={cn(styles.name, 'text-[15px] font-semibold text-text-strong leading-tight mt-0.5')}>
          {toast.unlock.name}
        </div>
        <div className={cn(styles.desc, 'text-[11px] text-muted leading-snug mt-0.5')}>
          {toast.unlock.description}
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => finish(true)}
        className="self-start text-muted hover:text-text p-1"
      >
        <X size={14} />
      </button>
      <span className={styles.ring} aria-hidden />
    </div>
  );
}
