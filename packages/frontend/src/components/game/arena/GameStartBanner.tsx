import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const SECOND_MS = 1_000;
const HOUR_S = 3_600;
const DAY_S = 86_400;

const pad = (n: number) => String(n).padStart(2, '0');

function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return 'Starting…';
  const totalSeconds = Math.ceil(remainingMs / SECOND_MS);
  const days = Math.floor(totalSeconds / DAY_S);
  const hours = Math.floor((totalSeconds % DAY_S) / HOUR_S);
  if (days > 0) return `in ${days}d ${hours}h`;
  const minutes = Math.floor((totalSeconds % HOUR_S) / 60);
  return `in ${pad(hours)}:${pad(minutes)}:${pad(totalSeconds % 60)}`;
}

export interface GameStartBannerProps {
  /** ISO 8601 datetime the game starts at. */
  startDate: string;
  className?: string;
}

/**
 * Full-width strip telling members of a `pending` game when trading opens.
 * Owns the one-second tick so the countdown never re-renders the arena, and
 * shows `Starting…` at zero until the next poll of the game flips its status.
 */
export function GameStartBanner({ startDate, className }: GameStartBannerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(id);
  }, []);

  const startsAt = new Date(startDate);

  return (
    <section
      aria-label="Game start"
      className={cn(
        'flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-panel border border-accent bg-accent-bg px-3 py-2 font-mono text-xs text-text-strong',
        className,
      )}
    >
      <span>
        Game starts{' '}
        {startsAt.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}
      </span>
      <span aria-hidden className="text-muted">·</span>
      <span className="tabular-nums text-accent">{formatCountdown(startsAt.getTime() - now)}</span>
      <span aria-hidden className="text-muted">·</span>
      <span className="text-muted">Trading opens then</span>
    </section>
  );
}
