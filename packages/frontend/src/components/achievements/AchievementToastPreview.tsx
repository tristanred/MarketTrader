import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAchievementIcon } from './icon';
import { rarityClass, rarityLabel } from './rarity';
import type { AchievementRarity } from '@markettrader/shared';
import styles from './AchievementToast.module.css';

export interface AchievementToastPreviewProps {
  name: string;
  description: string;
  rarity: AchievementRarity;
  icon: string;
}

/**
 * Static, side-effect-free visual twin of {@link AchievementToast}.
 * Reuses the same module.css so the rendered output matches the real
 * runtime toast pixel-for-pixel. Intended for the doc-generation
 * preview route — no auto-dismiss, no WS ack, no store wiring.
 */
export function AchievementToastPreview({ name, description, rarity, icon }: AchievementToastPreviewProps) {
  const Icon = getAchievementIcon(icon);
  const eyebrow = `${rarityLabel(rarity).toUpperCase()} · UNLOCKED`;

  return (
    <div className={cn(styles.toast, rarityClass(rarity))} role="status">
      <span className={styles.icon}>
        <Icon width={26} height={26} strokeWidth={1.6} />
      </span>
      <div className={styles.body}>
        <div className={cn(styles.eyebrow, 'font-mono text-[9px] tracking-[0.22em]')} style={{ color: 'var(--rarity)' }}>
          {eyebrow}
        </div>
        <div className={cn(styles.name, 'text-[15px] font-semibold text-text-strong leading-tight mt-0.5')}>
          {name}
        </div>
        <div className={cn(styles.desc, 'text-[11px] text-muted leading-snug mt-0.5')}>
          {description}
        </div>
      </div>
      <button type="button" aria-label="Dismiss" className="self-start text-muted hover:text-text p-1">
        <X size={14} />
      </button>
      <span className={styles.ring} aria-hidden />
    </div>
  );
}
