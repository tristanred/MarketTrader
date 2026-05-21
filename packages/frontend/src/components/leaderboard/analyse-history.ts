import type { LeaderboardHistoryResponse } from '@markettrader/shared';

export interface HighlightEvent {
  /** Human label like "D-3" or "D-12" relative to "now". */
  dayLabel: string;
  /** ISO 8601 timestamp of the event for ordering. */
  at: string;
  /** Rich text — short prose describing the event. */
  text: string;
  /** Optional accent — usually one of the involved players' usernames. */
  emphasis?: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayLabel(at: string, anchorMs: number): string {
  const diff = Math.round((anchorMs - new Date(at).getTime()) / MS_PER_DAY);
  if (diff <= 0) return 'NOW';
  return `D-${diff}`;
}

/**
 * Derives a short list of notable events from a leaderboard history payload.
 * Pure — no I/O. Used by the dedicated page's "Race highlights" panel. Caps
 * at 6 results to keep the panel scannable.
 *
 * Currently surfaces:
 *  - Lead changes (#1 swaps player)
 *  - Big rank drops (≥ 5 ranks over any 48h window)
 *  - All-time peaks (each player's best value point)
 */
export function analyseHistory(
  history: LeaderboardHistoryResponse,
  maxEvents = 6,
): HighlightEvent[] {
  const out: HighlightEvent[] = [];
  const anchorMs = history.endedAt
    ? new Date(history.endedAt).getTime()
    : Date.now();

  // Lead changes: build a unified timeline of (t, rank-1 player). Whenever
  // the player at rank 1 changes, emit an event.
  type Pt = { t: string; rank: number; v: number; playerId: string; username: string };
  const allPoints: Pt[] = [];
  for (const s of history.series) {
    for (const p of s.points) {
      allPoints.push({ t: p.t, rank: p.r, v: p.v, playerId: s.playerId, username: s.username });
    }
  }
  allPoints.sort((a, b) => a.t.localeCompare(b.t));

  let lastLeader: string | null = null;
  for (const p of allPoints) {
    if (p.rank !== 1) continue;
    if (lastLeader === null) {
      lastLeader = p.playerId;
      continue;
    }
    if (p.playerId !== lastLeader) {
      const previous = history.series.find((s) => s.playerId === lastLeader);
      out.push({
        dayLabel: dayLabel(p.t, anchorMs),
        at: p.t,
        emphasis: p.username,
        text: `${p.username} took #1 from ${previous?.username ?? 'previous leader'}.`,
      });
      lastLeader = p.playerId;
    }
  }

  // Rank drops: for each player, scan windows up to 48h and report a single
  // worst drop ≥ 5 ranks. One emit per player to avoid spam.
  for (const s of history.series) {
    if (s.points.length < 2) continue;
    let worstDrop = 0;
    let worstAt: string | null = null;
    let worstFromRank = 0;
    let worstToRank = 0;
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i - 1];
      const b = s.points[i];
      if (!a || !b) continue;
      const dt = new Date(b.t).getTime() - new Date(a.t).getTime();
      if (dt > 48 * 60 * 60 * 1000) continue;
      const drop = b.r - a.r;
      if (drop > worstDrop) {
        worstDrop = drop;
        worstAt = b.t;
        worstFromRank = a.r;
        worstToRank = b.r;
      }
    }
    if (worstDrop >= 5 && worstAt) {
      out.push({
        dayLabel: dayLabel(worstAt, anchorMs),
        at: worstAt,
        emphasis: s.username,
        text: `${s.username} dropped from #${worstFromRank} to #${worstToRank}.`,
      });
    }
  }

  // Peaks: emit each player's all-time best value point, but cap aggressively
  // so this category doesn't crowd out the others.
  const peaks: HighlightEvent[] = [];
  for (const s of history.series) {
    if (s.points.length === 0) continue;
    let peak = s.points[0]!;
    for (const p of s.points) {
      if (p.v > peak.v) peak = p;
    }
    peaks.push({
      dayLabel: dayLabel(peak.t, anchorMs),
      at: peak.t,
      emphasis: s.username,
      text: `${s.username} peaked at $${peak.v.toLocaleString('en-US', { maximumFractionDigits: 0 })}.`,
    });
  }
  // Keep only the top-2 peaks (highest absolute value).
  peaks.sort((a, b) => {
    const av = Number(a.text.match(/\$([\d,]+)/)?.[1]?.replace(/,/g, '') ?? 0);
    const bv = Number(b.text.match(/\$([\d,]+)/)?.[1]?.replace(/,/g, '') ?? 0);
    return bv - av;
  });
  out.push(...peaks.slice(0, 2));

  // Most recent first, capped to maxEvents.
  out.sort((a, b) => b.at.localeCompare(a.at));
  return out.slice(0, maxEvents);
}
