import type { CSSProperties } from 'react';
import type { DiscoverItem, DiscoverList, DiscoverSectionKind } from '@markettrader/shared';

/** Player-facing name of each Discover section. */
export const SECTION_LABELS: Record<DiscoverSectionKind, string> = {
  picks: 'Daily picks',
  gainers: 'Top gainers',
  losers: 'Top losers',
  active: 'Most active',
  trending: 'Trending',
};

/** Label each teaser row carries, naming why the stock is there. */
const TEASER_REASONS: Record<DiscoverSectionKind, string> = {
  picks: 'Daily pick',
  gainers: 'Top gainer',
  losers: 'Top loser',
  active: 'Most active',
  trending: 'Trending',
};

export interface TeaserItem extends DiscoverItem {
  reason: string;
}

/**
 * Picks the arena teaser's rows: the first daily pick, the top gainer and the
 * most active stock, skipping repeats and topping up from the remaining picks
 * when a movers list is missing.
 */
export function teaserItems(list: DiscoverList, count = 3): TeaserItem[] {
  const byKind = new Map(list.sections.map((s) => [s.kind, s.items]));
  const picks = byKind.get('picks') ?? [];
  const candidates: Array<[DiscoverSectionKind, DiscoverItem | undefined]> = [
    ['picks', picks[0]],
    ['gainers', byKind.get('gainers')?.[0]],
    ['active', byKind.get('active')?.[0]],
    ...picks.slice(1).map((p): [DiscoverSectionKind, DiscoverItem] => ['picks', p]),
  ];

  const out: TeaserItem[] = [];
  const seen = new Set<string>();
  for (const [kind, item] of candidates) {
    if (!item || seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    out.push({ ...item, reason: TEASER_REASONS[kind] });
    if (out.length === count) break;
  }
  return out;
}

/** Moves beyond this many percent get the strongest tint. */
const HEAT_FULL_SCALE_PCT = 5;
/** Strongest tint, as a share of gain/loss mixed into the panel surface. Kept low so tile text stays legible. */
const HEAT_MAX_MIX_PCT = 20;
const HEAT_MIN_MIX_PCT = 4;

/**
 * Background tint for a heat-grid tile: the day's move mixed into the panel
 * surface, scaled by magnitude. Built from the theme tokens so both themes
 * follow. Unknown or flat moves stay untinted.
 */
export function heatStyle(changePct: number | null): CSSProperties | undefined {
  if (changePct === null || Math.abs(changePct) < 0.005) return undefined;
  const intensity = Math.min(Math.abs(changePct) / HEAT_FULL_SCALE_PCT, 1);
  const mix = Math.round(HEAT_MIN_MIX_PCT + intensity * (HEAT_MAX_MIX_PCT - HEAT_MIN_MIX_PCT));
  const token = changePct > 0 ? '--gain' : '--loss';
  return { backgroundColor: `color-mix(in srgb, var(${token}) ${mix}%, var(--panel))` };
}

/** `2026-05-18` → `Mon, May 18`. The date is a calendar day, so it is formatted in UTC to avoid a timezone shift. */
export function formatSessionDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** Sorts by the day's move, biggest gain first; stocks without a quote go last. */
export function byChangeDesc(a: DiscoverItem, b: DiscoverItem): number {
  if (a.changePct === null) return b.changePct === null ? 0 : 1;
  if (b.changePct === null) return -1;
  return b.changePct - a.changePct;
}

/** ISO timestamp → `Tue, 4:05 PM EDT`, in market time. */
export function formatMarketTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  }).format(d);
}
