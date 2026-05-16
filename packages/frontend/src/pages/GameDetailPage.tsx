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
  SelectedSymbolProvider,
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

  const subscribedSymbols = useMemo(
    () => [...new Set([...heldSymbols, ...watchlistSymbols])],
    [heldSymbols, watchlistSymbols],
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
    <SelectedSymbolProvider initial={initialSymbol}>
      <ArenaBody
        gameId={gameId}
        gameData={game.data}
        portfolioData={portfolio.data}
        watchlistSymbols={watchlistSymbols}
        watchlists={watchlists.data ?? []}
        activeWatchlistId={activeWatchlistId}
        tradeHistory={tradeHistory.data ?? []}
      />
    </SelectedSymbolProvider>
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
}

function ArenaBody({
  gameId,
  gameData,
  portfolioData,
  watchlistSymbols,
  watchlists,
  activeWatchlistId,
  tradeHistory,
}: ArenaBodyProps) {
  const setSelectedSymbol = useSetSelectedSymbol();
  const selectedSymbol = useSelectedSymbol();

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
  const livePrices = useLiveStore((s) => s.pricesBySymbol);
  const user = useAuthStore((s) => s.user);
  const quoteDialog = useQuoteDialogStore();
  const openTradeOrder = useQuoteDialogStore((s) => s.openTradeOrder);
  const closeTradeOrder = useQuoteDialogStore((s) => s.closeTradeOrder);
  const tradeOrderOpen = useQuoteDialogStore((s) => s.tradeOrderOpen);
  const tradeOrderSymbol = useQuoteDialogStore((s) => s.tradeOrderSymbol);
  const tradeOrderDirection = useQuoteDialogStore((s) => s.tradeOrderDirection);

  // Watchlist quote rows: read from the live store. Omit price fields when
  // no live tick has arrived yet — exactOptionalPropertyTypes forbids
  // assigning `undefined` to an optional numeric field.
  const watchlistRows = watchlistSymbols.map((symbol) => {
    const tick = livePrices[symbol];
    return tick
      ? { symbol, last: tick.price, changePct: tick.changePercent }
      : { symbol };
  });

  // Holdings rows: enrich with the live price when available.
  // Company names are not yet returned by the holdings endpoint; the name
  // column is left empty until the server provides them.
  const holdingRows =
    portfolioData?.holdings.map((h) => {
      const tick = livePrices[h.symbol];
      const price = tick?.price ?? h.currentPrice;
      return {
        symbol: h.symbol,
        // Server doesn't return company names with holdings yet; fall back to
        // the symbol so the Name column isn't a row of empty cells.
        name: h.symbol,
        quantity: h.quantity,
        avgCost: h.avgCostBasis,
        marketValue: price * h.quantity,
        pnlPct: h.avgCostBasis > 0 ? ((price - h.avgCostBasis) / h.avgCostBasis) * 100 : 0,
      };
    }) ?? [];

  // Selected-symbol quote: pull from live store first, else fetch fresh.
  // Fields are kept in a typed struct so the spread into QuoteHeader is
  // explicit — exactOptionalPropertyTypes rejects `prop: undefined`.
  const liveTick = selectedSymbol ? livePrices[selectedSymbol] : undefined;
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
        <LeaderboardPanel entries={gameData.leaderboard ?? []} startingBalance={gameData.startingBalance} />
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
