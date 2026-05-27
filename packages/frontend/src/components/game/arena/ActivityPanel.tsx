import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import type { AchievementRarity, TradeDirection } from '@markettrader/shared';
import { cn } from '@/lib/utils';
import { getAchievementIcon } from '@/components/achievements/icon';
import { rarityClass } from '@/components/achievements/rarity';

export type ActivityEvent =
  | {
      kind: 'trade';
      /** Server-provided unique id; preferred as the React key when present. */
      id?: string;
      at: string;
      player: string;
      direction: TradeDirection;
      quantity: number;
      symbol: string;
      price: number;
    }
  | {
      kind: 'achievement';
      /** `${gamePlayerId}:${achievementKey}` — stable across replay and live. */
      id?: string;
      at: string;
      player: string;
      achievementKey: string;
      name: string;
      rarity: AchievementRarity;
      icon: string;
    };

export interface ActivityPanelProps {
  events: ActivityEvent[];
  className?: string;
}

/**
 * Right-column terminal-style feed of game events: trades and achievement
 * unlocks merged chronologically. Trades show BUY/SELL with quantity/price;
 * achievement rows show the rarity-tinted achievement name and icon.
 */
export function ActivityPanel({ events, className }: ActivityPanelProps) {
  return (
    <Panel className={className}>
      <PanelHeader>Activity</PanelHeader>
      <PanelBody>
        {events.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted">No activity yet.</p>
        ) : (
          <ul className="space-y-1 font-mono text-[11px]">
            {events.map((e) => (
              <li
                key={e.id ?? eventFallbackKey(e)}
                className="grid grid-cols-[auto_1fr] gap-2 border-b border-hairline pb-1 last:border-0 last:pb-0"
              >
                <span className="text-muted">{formatTime(e.at)}</span>
                {e.kind === 'trade' ? <TradeRow e={e} /> : <AchievementRow e={e} />}
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function TradeRow({ e }: { e: Extract<ActivityEvent, { kind: 'trade' }> }) {
  return (
    <span className="text-text">
      <span className="text-accent">{e.player}</span>{' '}
      <span className={cn(e.direction === 'buy' ? 'text-gain' : 'text-loss')}>
        {e.direction.toUpperCase()}
      </span>{' '}
      {e.quantity} {e.symbol} @ {e.price.toFixed(2)}
    </span>
  );
}

function AchievementRow({ e }: { e: Extract<ActivityEvent, { kind: 'achievement' }> }) {
  const Icon = getAchievementIcon(e.icon);
  return (
    <span className={cn('text-text inline-flex items-center gap-1', rarityClass(e.rarity))}>
      <span className="text-accent">{e.player}</span>
      <span className="text-muted">unlocked</span>
      <Icon className="h-3 w-3" style={{ color: 'var(--rarity)' }} aria-hidden />
      <span className="font-semibold" style={{ color: 'var(--rarity)' }}>
        {e.name}
      </span>
    </span>
  );
}

function eventFallbackKey(e: ActivityEvent): string {
  if (e.kind === 'trade') {
    return `t:${e.at}-${e.player}-${e.symbol}-${e.direction}-${e.quantity}-${e.price}`;
  }
  return `a:${e.at}-${e.player}-${e.achievementKey}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
