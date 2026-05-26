import type { AchievementRarity } from '@markettrader/shared';

/**
 * Display order — used for sorting cards in the grid: legendary first.
 * Mirrors the visual weight of rarities (rarer = more prominent).
 */
const RARITY_ORDER: Record<AchievementRarity, number> = {
  legendary: 0,
  epic: 1,
  rare: 2,
  uncommon: 3,
  common: 4,
};

/** Title-cased label, e.g. 'Legendary'. Used in the tier eyebrow. */
export function rarityLabel(rarity: AchievementRarity): string {
  return rarity.charAt(0).toUpperCase() + rarity.slice(1);
}

/** Tailwind className that sets --rarity and --rarity-glow via .rar-* utility. */
export function rarityClass(rarity: AchievementRarity): string {
  return `rar-${rarity}`;
}

/** Comparator suitable for Array.sort — legendary first. */
export function compareRarity(a: AchievementRarity, b: AchievementRarity): number {
  return RARITY_ORDER[a] - RARITY_ORDER[b];
}

/** Iteration order, e.g. for rendering filter chips. Legendary first. */
export const ALL_RARITIES: readonly AchievementRarity[] = [
  'legendary',
  'epic',
  'rare',
  'uncommon',
  'common',
];
