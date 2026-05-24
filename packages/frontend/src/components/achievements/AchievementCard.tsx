import { cn } from '@/lib/utils';
import { getAchievementIcon } from './icon';
import { rarityClass, rarityLabel } from './rarity';
import type {
  AchievementDefinitionDTO,
  AchievementProgressDTO,
} from '@markettrader/shared';

export interface AchievementCardProps {
  definition: AchievementDefinitionDTO;
  /** Player's progress on this achievement; null = never touched (treat as 0/target). */
  progress: AchievementProgressDTO | null;
  /** Controls padding + icon size; default 'grid'. */
  variant?: 'grid' | 'toast' | 'roster';
  className?: string;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Shared chrome for a single achievement, used by the grid and the toast.
 * The toast variant uses larger paddings and a wider icon; otherwise
 * identical so the visual language stays one card from anywhere.
 */
export function AchievementCard({ definition, progress, variant = 'grid', className }: AchievementCardProps) {
  const Icon = getAchievementIcon(definition.icon);
  const current = progress?.progress ?? 0;
  const unlocked = Boolean(progress?.unlockedAt);
  const isLocked = !unlocked && current === 0;
  const fillPct = unlocked ? 100 : Math.min(100, Math.round((current / definition.target) * 100));

  const tierLabel = isLocked
    ? 'Locked'
    : unlocked
      ? rarityLabel(definition.rarity)
      : `In progress · ${rarityLabel(definition.rarity)}`;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-panel border border-hairline-strong bg-panel',
        'grid items-start gap-3',
        variant === 'toast' ? 'p-4 grid-cols-[34px_1fr_auto]' : 'px-4 py-3 grid-cols-[28px_1fr]',
        !isLocked && rarityClass(definition.rarity),
        isLocked && 'opacity-55',
        !unlocked && current > 0 && 'opacity-85',
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: isLocked ? 'var(--hairline-strong)' : 'var(--rarity)' }}
      />
      {!isLocked && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(120% 70% at 50% -20%, var(--rarity-glow) 0%, transparent 60%)',
          }}
        />
      )}
      <span
        className="relative z-[1] flex items-center justify-center"
        style={{ color: isLocked ? 'var(--muted)' : 'var(--rarity)' }}
      >
        <Icon width={variant === 'toast' ? 26 : 22} height={variant === 'toast' ? 26 : 22} strokeWidth={1.6} />
      </span>
      <div className="relative z-[1] min-w-0">
        <div
          className="font-mono text-[9px] uppercase tracking-[0.22em] mb-1"
          style={{ color: isLocked ? 'var(--muted)' : 'var(--rarity)' }}
        >
          {tierLabel}
        </div>
        <div className="font-semibold text-text-strong leading-tight" style={{ fontSize: variant === 'toast' ? 15 : 13 }}>
          {definition.name}
        </div>
        <div className="text-[11px] text-muted leading-[1.3] mt-0.5">{definition.description}</div>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="flex-1 h-[3px] rounded-[2px] overflow-hidden" style={{ background: 'var(--hairline)' }}>
            <div className="h-full rounded-[2px]" style={{ width: `${fillPct}%`, background: isLocked ? 'var(--hairline)' : 'var(--rarity)' }} />
          </div>
          <div className="font-mono text-[10px] text-muted tabular-nums">
            {unlocked
              ? `unlocked · ${relativeTime(progress!.unlockedAt!)}`
              : `${current} / ${definition.target}`}
          </div>
        </div>
      </div>
    </div>
  );
}
