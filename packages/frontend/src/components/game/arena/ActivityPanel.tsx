import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import type { TradeDirection } from '@markettrader/shared';
import { cn } from '@/lib/utils';

export interface ActivityEvent {
  /** Server-provided unique id; preferred as the React key when present. */
  id?: string;
  at: string;
  player: string;
  direction: TradeDirection;
  quantity: number;
  symbol: string;
  price: number;
}

export interface ActivityPanelProps {
  events: ActivityEvent[];
  className?: string;
}

/**
 * Right-column terminal-style scrolling feed of trade events in the
 * current game. Player names in accent, BUY in gain, SELL in loss.
 * Times rendered in the user's local timezone as HH:MM.
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
                key={e.id ?? `${e.at}-${e.player}-${e.symbol}-${e.direction}-${e.quantity}-${e.price}`}
                className="grid grid-cols-[auto_1fr] gap-2 border-b border-hairline pb-1 last:border-0 last:pb-0"
              >
                <span className="text-muted">{formatTime(e.at)}</span>
                <span className="text-text">
                  <span className="text-accent">{e.player}</span>{' '}
                  <span className={cn(e.direction === 'buy' ? 'text-gain' : 'text-loss')}>
                    {e.direction.toUpperCase()}
                  </span>{' '}
                  {e.quantity} {e.symbol} @ {e.price.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
