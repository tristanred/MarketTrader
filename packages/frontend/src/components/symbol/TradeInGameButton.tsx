import { useEffect, useRef, useState } from 'react';
import { useGames } from '@/api/games';
import { TradeOrderDialog } from '@/components/TradeOrderDialog';
import { useQuoteDialogStore } from '@/stores/quoteDialogStore';
import { cn } from '@/lib/utils';
import { getDayCounter } from '@/lib/gameDay';
import type { Game, TradeDirection } from '@markettrader/shared';

export interface TradeInGameButtonProps {
  /** Symbol to trade. Uppercased. */
  symbol: string;
  /** Direction the trade dialog opens on. Defaults to 'buy'. */
  defaultDirection?: TradeDirection;
  /** Called when the trade dialog opens — used by QuoteInfoDialog to close itself. */
  onTradeOpened?: () => void;
  className?: string;
}

/**
 * Surfaces a "Trade <SYMBOL> in <game>" affordance from any non-arena
 * context (e.g. {@link SymbolPage}). Filters the caller's games to those
 * with `status === 'active'`:
 *
 * - 0 active games → renders nothing.
 * - 1 active game → a single compound button that opens TradeOrderDialog.
 * - 2+ active games → a dropdown picker; choosing a game opens the dialog.
 *
 * The dialog is mounted by this component so callers don't need their own
 * state plumbing.
 */
export function TradeInGameButton({
  symbol,
  defaultDirection = 'buy',
  onTradeOpened,
  className,
}: TradeInGameButtonProps) {
  const games = useGames();
  const openQuote = useQuoteDialogStore((s) => s.openQuote);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeGame, setActiveGame] = useState<Game | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeGames = (games.data ?? []).filter((g) => g.status === 'active');

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  if (activeGames.length === 0) return null;

  const startTrade = (game: Game) => {
    setActiveGame(game);
    setMenuOpen(false);
    onTradeOpened?.();
  };

  const isMulti = activeGames.length > 1;
  const rightLabel = isMulti
    ? `${activeGames.length} GAMES`
    : (activeGames[0]?.name ?? '');

  return (
    <>
      <div ref={menuRef} className={cn('relative inline-flex', className)}>
        <button
          type="button"
          onClick={() => {
            if (isMulti) {
              setMenuOpen((v) => !v);
            } else if (activeGames[0]) {
              startTrade(activeGames[0]);
            }
          }}
          className="inline-flex items-stretch overflow-hidden rounded-chip border border-accent text-bg hover:brightness-110 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          aria-haspopup={isMulti ? 'menu' : undefined}
          aria-expanded={isMulti ? menuOpen : undefined}
        >
          <span className="bg-accent px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-[0.1em] text-bg">
            Trade {symbol}
          </span>
          <span className="flex items-center gap-1 border-l border-bg/30 bg-accent-bg px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-accent">
            <span aria-hidden>{isMulti ? '▾' : '·'}</span>
            <span className="normal-case tracking-normal">{rightLabel}</span>
          </span>
        </button>

        {isMulti && menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 min-w-[240px] overflow-hidden rounded-chip border border-hairline-strong bg-panel shadow-lg"
          >
            <ul>
              {activeGames.map((g) => {
                const day = getDayCounter(g.startDate, g.endDate, new Date());
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => startTrade(g)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-hairline"
                    >
                      <span className="font-mono text-text">{g.name}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                        DAY {day.dayCurrent}/{day.dayTotal}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>

      {activeGame ? (
        <TradeOrderDialog
          open={activeGame !== null}
          initialSymbol={symbol}
          initialDirection={defaultDirection}
          gameId={activeGame.id}
          allowShortSelling={activeGame.allowShortSelling}
          allowLimitOrders={activeGame.allowLimitOrders}
          allowStopOrders={activeGame.allowStopOrders}
          allowBracketOrders={activeGame.allowBracketOrders}
          allowGTC={activeGame.allowGTC}
          onOpenChange={(open) => {
            if (!open) setActiveGame(null);
          }}
          onSeeQuote={(s) => {
            setActiveGame(null);
            openQuote(s);
          }}
        />
      ) : null}
    </>
  );
}
