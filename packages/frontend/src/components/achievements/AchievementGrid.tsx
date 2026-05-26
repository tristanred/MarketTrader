import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AchievementCard } from './AchievementCard';
import { ALL_RARITIES, compareRarity, rarityLabel } from './rarity';
import type {
  AchievementDefinitionDTO,
  AchievementProgressDTO,
  AchievementRarity,
} from '@markettrader/shared';

export interface AchievementGridProps {
  definitions: AchievementDefinitionDTO[];
  /** Progress entries for the viewer (one optional row per definition). */
  progress: AchievementProgressDTO[];
  className?: string;
}

type StateFilter = 'all' | 'unlocked' | 'locked';

function parseRarityFilter(raw: string | null): Set<AchievementRarity> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .filter((v): v is AchievementRarity =>
        (['common', 'uncommon', 'rare', 'epic', 'legendary'] as const).includes(v as AchievementRarity),
      ),
  );
}

/**
 * Filterable, sorted grid of achievement cards. Rarity + state filters
 * sync to URL search params (`?rarity=epic,legendary&state=unlocked`).
 * Legendary unlocked cards span both columns to breathe.
 */
export function AchievementGrid({ definitions, progress, className }: AchievementGridProps) {
  const [params, setParams] = useSearchParams();
  const rarityFilter = parseRarityFilter(params.get('rarity'));
  const stateFilter = (params.get('state') as StateFilter | null) ?? 'all';

  const progressByKey = useMemo(() => {
    const m = new Map<string, AchievementProgressDTO>();
    for (const p of progress) m.set(p.achievementKey, p);
    return m;
  }, [progress]);

  const filtered = useMemo(() => {
    return definitions
      .filter((d) => {
        if (rarityFilter.size > 0 && !rarityFilter.has(d.rarity)) return false;
        const p = progressByKey.get(d.key);
        const unlocked = Boolean(p?.unlockedAt);
        if (stateFilter === 'unlocked' && !unlocked) return false;
        if (stateFilter === 'locked' && unlocked) return false;
        return true;
      })
      .sort((a, b) => {
        const ua = Boolean(progressByKey.get(a.key)?.unlockedAt);
        const ub = Boolean(progressByKey.get(b.key)?.unlockedAt);
        const r = compareRarity(a.rarity, b.rarity);
        if (r !== 0) return r;
        if (ua !== ub) return ua ? -1 : 1;
        return a.key.localeCompare(b.key);
      });
  }, [definitions, progressByKey, rarityFilter, stateFilter]);

  const toggleRarity = (r: AchievementRarity) => {
    const next = new Set(rarityFilter);
    if (next.has(r)) next.delete(r);
    else next.add(r);
    const newParams = new URLSearchParams(params);
    if (next.size === 0) newParams.delete('rarity');
    else newParams.set('rarity', [...next].join(','));
    setParams(newParams, { replace: true });
  };
  const setState = (s: StateFilter) => {
    const newParams = new URLSearchParams(params);
    if (s === 'all') newParams.delete('state');
    else newParams.set('state', s);
    setParams(newParams, { replace: true });
  };
  const clearRarity = () => {
    const newParams = new URLSearchParams(params);
    newParams.delete('rarity');
    setParams(newParams, { replace: true });
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip active={rarityFilter.size === 0} onClick={clearRarity}>
          All
        </Chip>
        {ALL_RARITIES.map((r) => (
          <Chip key={r} active={rarityFilter.has(r)} rarity={r} onClick={() => toggleRarity(r)}>
            {rarityLabel(r)}
          </Chip>
        ))}
        <div className="ml-auto flex gap-1.5">
          <Chip active={stateFilter === 'unlocked'} onClick={() => setState(stateFilter === 'unlocked' ? 'all' : 'unlocked')}>
            Unlocked
          </Chip>
          <Chip active={stateFilter === 'locked'} onClick={() => setState(stateFilter === 'locked' ? 'all' : 'locked')}>
            Locked
          </Chip>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {filtered.map((d) => {
          const p = progressByKey.get(d.key) ?? null;
          const featured = d.rarity === 'legendary' && Boolean(p?.unlockedAt);
          return (
            <AchievementCard
              key={d.key}
              definition={d}
              progress={p}
              {...(featured ? { className: 'md:col-span-2' } : {})}
            />
          );
        })}
      </div>
    </div>
  );
}

function Chip({
  children,
  active,
  rarity,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  rarity?: AchievementRarity;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-1 rounded-sm border',
        active
          ? 'text-text-strong'
          : 'text-muted hover:text-text border-hairline-strong',
        rarity && active && `rar-${rarity}`,
      )}
      style={
        rarity && active
          ? { background: 'var(--rarity-glow)', borderColor: 'color-mix(in srgb, var(--rarity) 35%, transparent)', color: 'var(--rarity)' }
          : active
            ? { background: 'var(--accent-bg)', borderColor: 'rgba(103,232,249,0.35)' }
            : undefined
      }
    >
      {children}
    </button>
  );
}
