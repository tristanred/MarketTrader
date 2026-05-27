import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
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
  /** Game's total enabled achievement count — drives the "N more locked" tile. */
  totalEnabledCount: number;
  className?: string;
}

type StateFilter = 'all' | 'unlocked';

const CATEGORY_OPTIONS = [
  { value: 'trading', label: 'Trading' },
  { value: 'pnl', label: 'P&L' },
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'standing', label: 'Standing' },
  { value: 'behavior', label: 'Behavior' },
  { value: 'finale', label: 'Finale' },
] as const;
type Category = (typeof CATEGORY_OPTIONS)[number]['value'];
const ALL_CATEGORIES: readonly Category[] = CATEGORY_OPTIONS.map((c) => c.value);

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

function parseCategoryFilter(raw: string | null): Set<Category> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .filter((v): v is Category => ALL_CATEGORIES.includes(v as Category)),
  );
}

/**
 * Filterable, sorted grid of achievement cards. Rarity + state filters
 * sync to URL search params (`?rarity=epic,legendary&state=unlocked`).
 * Legendary unlocked cards span both columns to breathe.
 */
export function AchievementGrid({ definitions, progress, totalEnabledCount, className }: AchievementGridProps) {
  const [params, setParams] = useSearchParams();
  const rarityFilter = parseRarityFilter(params.get('rarity'));
  const categoryFilter = parseCategoryFilter(params.get('category'));
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
        if (categoryFilter.size > 0 && (!d.category || !categoryFilter.has(d.category as Category))) return false;
        const p = progressByKey.get(d.key);
        const unlocked = Boolean(p?.unlockedAt);
        if (stateFilter === 'unlocked' && !unlocked) return false;
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
  }, [definitions, progressByKey, rarityFilter, categoryFilter, stateFilter]);

  // Locked-tile count is computed off the raw definitions array (visible
  // unlocked cards) vs the game total — independent of the rarity/category
  // filters so the user always sees the full undiscovered count.
  const lockedRemaining = Math.max(0, totalEnabledCount - definitions.length);
  const showLockedTile = stateFilter !== 'unlocked' && lockedRemaining > 0;

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
  const toggleCategory = (c: Category) => {
    const next = new Set(categoryFilter);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    const newParams = new URLSearchParams(params);
    if (next.size === 0) newParams.delete('category');
    else newParams.set('category', [...next].join(','));
    setParams(newParams, { replace: true });
  };
  const clearCategory = () => {
    const newParams = new URLSearchParams(params);
    newParams.delete('category');
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
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip active={categoryFilter.size === 0} onClick={clearCategory}>
          All
        </Chip>
        {CATEGORY_OPTIONS.map((c) => (
          <Chip key={c.value} active={categoryFilter.has(c.value)} onClick={() => toggleCategory(c.value)}>
            {c.label}
          </Chip>
        ))}
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
        {showLockedTile && <LockedSlotTile count={lockedRemaining} />}
      </div>
    </div>
  );
}

/**
 * Placeholder tile shown after the unlocked cards. Reveals only the count
 * of locked achievements — never their names, descriptions, or icons.
 */
function LockedSlotTile({ count }: { count: number }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-panel border border-hairline-strong bg-panel',
        'grid items-start gap-3 px-4 py-3 grid-cols-[28px_1fr] opacity-55',
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: 'var(--hairline-strong)' }}
      />
      <span className="relative z-[1] flex items-center justify-center text-muted">
        <HelpCircle width={22} height={22} strokeWidth={1.6} />
      </span>
      <div className="relative z-[1] min-w-0">
        <div className="font-mono text-[9px] uppercase tracking-[0.22em] mb-1 text-muted">
          Locked
        </div>
        <div className="font-semibold text-text-strong leading-tight text-[13px]">
          {count} more locked
        </div>
        <div className="text-[11px] text-muted leading-[1.3] mt-0.5">
          Keep playing to discover what's left.
        </div>
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
