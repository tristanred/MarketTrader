import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useGame } from '@/api/games';
import { usePortfolio, useTradeHistory } from '@/api/trades';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useLiveStore } from '@/stores/liveStore';
import { useWatchlists } from '@/api/watchlists';
import { useWatchlistUiStore } from '@/stores/watchlistUiStore';
import { useStockQuote } from '@/api/stocks';
import { useAuthStore } from '@/stores/authStore';
import { useCommandKStore } from '@/stores/commandKStore';
import {
  useSelectedSymbol,
  useSetSelectedSymbol,
} from '@/contexts/SelectedSymbolContext';
import {
  LeaderboardPanel,
  PortfolioPanel,
  QuoteHeader,
  ChartPanel,
  OhlcStrip,
  HoldingsPanel,
  WatchlistPanel,
  ActivityPanel,
  SymbolSearchPanel,
} from '@/components/game/arena';
import { JoinGameCard } from '@/components/game/arena/JoinGameCard';
import { OpenOrdersList } from '@/components/OpenOrdersList';
import { TradeOrderDialog } from '@/components/TradeOrderDialog';
import { QuoteInfoDialog } from '@/components/QuoteInfoDialog';
import { useQuoteDialogStore } from '@/stores/quoteDialogStore';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import type { ActivityEvent } from '@/components/game/arena';
import type { TradeDirection } from '@markettrader/shared';

/**
 * Game-detail "arena" page: three-pane grid composed of nine panels with a
 * single SelectedSymbolContext driving the center column. Holdings, watchlist,
 * search, and the ticker tape all write to the context; QuoteHeader and
 * ChartPanel read from it.
 */
export function GameDetailPage() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const game = useGame(gameId);
  const portfolio = usePortfolio(gameId);
  const watchlists = useWatchlists();
  const selectedWatchlistId = useWatchlistUiStore((s) => s.selectedWatchlistId);
  const tradeHistory = useTradeHistory(gameId);

  const heldSymbols = useMemo(
    () => portfolio.data?.holdings.map((h) => h.symbol) ?? [],
    [portfolio.data],
  );

  const activeWatchlist = useMemo(() => {
    const lists = watchlists.data ?? [];
    return lists.find((l) => l.id === selectedWatchlistId) ?? lists[0] ?? null;
  }, [watchlists.data, selectedWatchlistId]);
  const watchlistSymbols = activeWatchlist?.symbols ?? [];
  const activeWatchlistId = activeWatchlist?.id ?? null;

  // Derive a stable key from the sorted symbol set, then materialize the
  // array from that key. Same key → same array identity → the WS effect
  // doesn't re-fire subscribe just because portfolio.data was refetched
  // into an equal-but-new object.
  const subscribedKey = useMemo(
    () => [...new Set([...heldSymbols, ...watchlistSymbols])].sort().join(','),
    [heldSymbols, watchlistSymbols],
  );
  const subscribedSymbols = useMemo(
    () => (subscribedKey ? subscribedKey.split(',') : []),
    [subscribedKey],
  );
  useGameSocket(gameId, subscribedSymbols);

  const initialSymbol = heldSymbols[0] ?? null;

  // 404 → join prompt
  if (game.isError && game.error instanceof ApiError && game.error.status === 404) {
    return <JoinGameCard gameId={gameId} onJoined={() => game.refetch()} />;
  }

  if (game.isLoading || !game.data) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <Skeleton className="h-7 w-48" />
      </main>
    );
  }

  return (
    <ArenaBody
      gameId={gameId}
      gameData={game.data}
      portfolioData={portfolio.data}
      watchlistSymbols={watchlistSymbols}
      watchlists={watchlists.data ?? []}
      activeWatchlistId={activeWatchlistId}
      tradeHistory={tradeHistory.data ?? []}
      initialSymbol={initialSymbol}
    />
  );
}

interface ArenaBodyProps {
  gameId: string;
  gameData: NonNullable<ReturnType<typeof useGame>['data']>;
  portfolioData: ReturnType<typeof usePortfolio>['data'];
  watchlistSymbols: string[];
  watchlists: NonNullable<ReturnType<typeof useWatchlists>['data']>;
  activeWatchlistId: string | null;
  tradeHistory: NonNullable<ReturnType<typeof useTradeHistory>['data']>;
  /** Symbol to seed the arena's center column when nothing is selected yet. */
  initialSymbol: string | null;
}

function ArenaBody({
  gameId,
  gameData,
  portfolioData,
  watchlistSymbols,
  watchlists,
  activeWatchlistId,
  tradeHistory,
  initialSymbol,
}: ArenaBodyProps) {
  const setSelectedSymbol = useSetSelectedSymbol();
  const selectedSymbol = useSelectedSymbol();

  // The SelectedSymbolProvider lives at shell level so global chrome can
  // pivot the arena. Seed the context from the user's first holding (or
  // whatever the caller passed) once data is available. Reacting to
  // `initialSymbol` matters because portfolio.data resolves after the
  // first paint — a mount-only effect would fire before holdings load.
  // Once the user picks anything explicitly, `selectedSymbol` is set
  // and the guard stops this effect from clobbering their choice.
  useEffect(() => {
    if (selectedSymbol === null && initialSymbol) {
      setSelectedSymbol(initialSymbol);
    }
  }, [selectedSymbol, initialSymbol, setSelectedSymbol]);

  // Register the arena's selected-symbol setter with the cmd+k store so the
  // AppShell-level overlay can write back into our context instead of
  // navigating to /symbols/:symbol. Clean up on unmount.
  useEffect(() => {
    const { setArenaSelect } = useCommandKStore.getState();
    setArenaSelect(setSelectedSymbol);
    return () => setArenaSelect(null);
  }, [setSelectedSymbol]);

  // The trade/quote dialogs live in a global store so chrome (ticker tape,
  // status strip) can open them. Reset on unmount so a leftover open state
  // doesn't follow the user to another game or out of arena.
  useEffect(() => {
    return () => {
      const s = useQuoteDialogStore.getState();
      s.closeTradeOrder();
      s.closeQuote();
    };
  }, []);
  const user = useAuthStore((s) => s.user);
  const quoteDialog = useQuoteDialogStore();
  const openTradeOrder = useQuoteDialogStore((s) => s.openTradeOrder);
  const closeTradeOrder = useQuoteDialogStore((s) => s.closeTradeOrder);
  const tradeOrderOpen = useQuoteDialogStore((s) => s.tradeOrderOpen);
  const tradeOrderSymbol = useQuoteDialogStore((s) => s.tradeOrderSymbol);
  const tradeOrderDirection = useQuoteDialogStore((s) => s.tradeOrderDirection);

  // Watchlist rows: only the symbol; each row subscribes to its own live
  // price inside <WatchlistPanel> so a tick on one symbol doesn't
  // re-render its siblings.
  const watchlistRows = watchlistSymbols.map((symbol) => ({ symbol }));

  // Holdings rows: ship the server-side last-known price + P&L as a baseline.
  // <HoldingsPanel> rows subscribe to their own symbol's live tick to override
  // marketValue/pnlPct on the fly without re-rendering siblings.
  const holdingRows =
    portfolioData?.holdings.map((h) => ({
      symbol: h.symbol,
      // Server doesn't return company names with holdings yet; fall back to
      // the symbol so the Name column isn't a row of empty cells.
      name: h.symbol,
      quantity: h.quantity,
      avgCost: h.avgCostBasis,
      marketValue: h.currentPrice * h.quantity,
      pnlPct:
        h.avgCostBasis > 0 ? ((h.currentPrice - h.avgCostBasis) / h.avgCostBasis) * 100 : 0,
    })) ?? [];

  // Selected-symbol quote: subscribe only to the selected symbol's live tick
  // (not the whole prices map) so ticks on other symbols don't re-render
  // the parent. Fall back to a fresh REST quote when no live tick exists.
  const liveTick = useLiveStore((s) =>
    selectedSymbol ? s.pricesBySymbol[selectedSymbol] : undefined,
  );
  const freshQuote = useStockQuote(selectedSymbol ?? '');
  const quoteData:
    | { last: number; changeAbs: number; changePct: number }
    | undefined = liveTick
    ? {
        last: liveTick.price,
        changeAbs: liveTick.change ?? 0,
        changePct: liveTick.changePercent ?? 0,
      }
    : freshQuote.data
      ? {
          last: freshQuote.data.price,
          changeAbs: freshQuote.data.change,
          changePct: freshQuote.data.changePercent,
        }
      : undefined;

  // Trade history → activity feed events. The GET /games/:id/trades endpoint
  // returns only executed Trade rows, so no status filtering is needed.
  const activityEvents: ActivityEvent[] = tradeHistory
    .slice(0, 25)
    .map((t) => ({
      at: t.executedAt,
      // History endpoint returns this user's trades only for now.
      player: user?.username ?? '—',
      direction: t.direction,
      quantity: t.quantity,
      symbol: t.symbol,
      price: t.price,
    }));

  const myPortfolioValue = portfolioData?.totalValue ?? gameData.startingBalance;
  const myCash = portfolioData?.cashBalance ?? 0;
  const myPnlPct =
    gameData.startingBalance > 0
      ? ((myPortfolioValue - gameData.startingBalance) / gameData.startingBalance) * 100
      : 0;
  // Day P&L not available from server yet.
  const myDayPnl = 0;

  return (
    <main className="mx-auto grid w-full max-w-[1600px] grid-cols-1 gap-2 p-3 lg:grid-cols-[280px_1fr_300px]">
      <aside className="flex flex-col gap-2">
        <PortfolioPanel value={myPortfolioValue} pnlPct={myPnlPct} cash={myCash} dayPnl={myDayPnl} />
      </aside>

      <section className="flex flex-col gap-2">
        <QuoteHeader
          symbol={selectedSymbol}
          {...quoteData}
          {...(selectedSymbol
            ? { onTrade: (direction: TradeDirection) => openTradeOrder(selectedSymbol, direction) }
            : {})}
        />
        <ChartPanel symbol={selectedSymbol} />
        <OhlcStrip />
        <HoldingsPanel rows={holdingRows} onSelect={setSelectedSymbol} />
        <OpenOrdersList gameId={gameId} />
        {/* Leaderboard moved here from the left rail to gain horizontal room
            for per-row sparklines and full-length usernames. */}
        <LeaderboardPanel
          gameId={gameId}
          entries={gameData.leaderboard ?? []}
          startingBalance={gameData.startingBalance}
        />
      </section>

      <aside className="flex flex-col gap-2">
        <SymbolSearchPanel onSelect={setSelectedSymbol} />
        <WatchlistPanel
          rows={watchlistRows}
          onSelect={setSelectedSymbol}
          watchlistId={activeWatchlistId}
          lists={watchlists}
          onSelectList={(id) => useWatchlistUiStore.getState().setSelected(id)}
        />
        <ActivityPanel events={activityEvents} />
      </aside>

      <QuoteInfoDialog
        open={quoteDialog.open}
        symbol={quoteDialog.symbol}
        gameId={gameId}
        onOpenChange={(open) => {
          if (!open) quoteDialog.closeQuote();
        }}
        onTradeClick={(s) => {
          // QuoteInfoDialog auto-closes after this handler; pivot the
          // arena's selected symbol to whichever ticker the user clicked
          // Trade on (the modal lets them jump symbols mid-quote) so
          // TradeOrderDialog opens for the right one.
          setSelectedSymbol(s);
          openTradeOrder(s, 'buy');
        }}
      />
      <TradeOrderDialog
        open={tradeOrderOpen}
        initialSymbol={tradeOrderSymbol ?? selectedSymbol}
        initialDirection={tradeOrderDirection}
        gameId={gameId}
        allowShortSelling={gameData.allowShortSelling ?? false}
        allowLimitOrders={gameData.allowLimitOrders ?? false}
        allowStopOrders={gameData.allowStopOrders ?? false}
        allowBracketOrders={gameData.allowBracketOrders ?? false}
        allowGTC={gameData.allowGTC ?? false}
        onOpenChange={(open) => {
          if (!open) closeTradeOrder();
        }}
        onSeeQuote={(s) => {
          closeTradeOrder();
          quoteDialog.openQuote(s);
        }}
      />
    </main>
  );
}
