import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useGame, useJoinGame } from '@/api/games';
import { usePortfolio } from '@/api/trades';
import { useGameSocket } from '@/hooks/useGameSocket';
import { AppHeader } from '@/components/AppHeader';
import { TradePanel } from '@/components/TradePanel';
import { PendingOrdersList } from '@/components/PendingOrdersList';
import { TradeHistoryTable } from '@/components/TradeHistoryTable';
import { StockChart } from '@/components/StockChart';
import { YourProfileCard } from '@/components/game/YourProfileCard';
import { AboutThisGameCard } from '@/components/game/AboutThisGameCard';
import { GameLeaderboardCard } from '@/components/game/GameLeaderboardCard';
import { HoldingsSidebar } from '@/components/game/HoldingsSidebar';
import { QuoteInfoDialog } from '@/components/QuoteInfoDialog';
import { useQuoteDialogStore } from '@/stores/quoteDialogStore';
import { useWatchlists } from '@/api/watchlists';
import { useWatchlistUiStore } from '@/stores/watchlistUiStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { toast } from '@/components/ui/toast';

/**
 * Returns a human-readable phrase describing how long until `endIso`, e.g.
 * "Game ends in 16 days", "Game ends in 4 hours", "Game has ended".
 */
function timeUntilEnd(status: string | undefined, endIso: string | undefined): string {
  if (!endIso) return '';
  if (status === 'ended') return 'Game has ended';
  const now = Date.now();
  const end = new Date(endIso).getTime();
  const ms = end - now;
  if (ms <= 0) return 'Game has ended';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `Game ends in ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `Game ends in ${hours} hour${hours === 1 ? '' : 's'}`;
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  return `Game ends in ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export function GameDetailPage() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const game = useGame(gameId);
  const portfolio = usePortfolio(gameId);
  const join = useJoinGame();
  const quoteDialog = useQuoteDialogStore();

  const heldSymbols = useMemo(
    () => portfolio.data?.holdings.map((h) => h.symbol) ?? [],
    [portfolio.data],
  );

  // Include the currently-selected watchlist's symbols in the WS subscription
  // so watchlist rows tick live alongside Holdings.
  const watchlists = useWatchlists();
  const selectedWatchlistId = useWatchlistUiStore((s) => s.selectedWatchlistId);
  const watchlistSymbols = useMemo(() => {
    const lists = watchlists.data ?? [];
    const active = lists.find((l) => l.id === selectedWatchlistId) ?? lists[0];
    return active?.symbols ?? [];
  }, [watchlists.data, selectedWatchlistId]);

  const subscribedSymbols = useMemo(
    () => [...new Set([...heldSymbols, ...watchlistSymbols])],
    [heldSymbols, watchlistSymbols],
  );
  useGameSocket(gameId, subscribedSymbols);

  // 404 => either game doesn't exist or caller isn't a member.
  if (game.isError && game.error instanceof ApiError && game.error.status === 404) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-3xl p-6">
          <Card>
            <CardHeader>
              <CardTitle>Join this game?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                You're not a member yet, or this game doesn't exist. Try joining — if the ID is invalid
                you'll get an error.
              </p>
              <Button
                onClick={async () => {
                  try {
                    await join.mutateAsync(gameId);
                    toast({ title: 'Joined', variant: 'success' });
                    game.refetch();
                  } catch (err) {
                    const msg =
                      err instanceof ApiError
                        ? typeof err.body === 'object' && err.body && 'error' in err.body
                          ? String((err.body as { error: unknown }).error)
                          : `Error ${err.status}`
                        : 'Failed to join';
                    toast({ title: 'Could not join', description: msg, variant: 'destructive' });
                  }
                }}
                disabled={join.isPending}
              >
                {join.isPending ? 'Joining…' : 'Join game'}
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="mx-auto max-w-6xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
          {game.isLoading ? (
            <Skeleton className="h-7 w-48" />
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">{game.data?.name}</h1>
          )}
          <p className="text-sm text-muted-foreground">
            {timeUntilEnd(game.data?.status, game.data?.endDate)}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <YourProfileCard gameId={gameId} />
            <AboutThisGameCard gameId={gameId} />
            <GameLeaderboardCard gameId={gameId} />

            <Card>
              <CardHeader>
                <CardTitle className="uppercase tracking-wide text-xs text-muted-foreground">
                  Trade desk
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="trade">
                  <TabsList>
                    <TabsTrigger value="trade">Trade</TabsTrigger>
                    <TabsTrigger value="history">History</TabsTrigger>
                    <TabsTrigger value="chart">Chart</TabsTrigger>
                  </TabsList>
                  <TabsContent value="trade" className="pt-3 space-y-4">
                    <TradePanel gameId={gameId} />
                    <PendingOrdersList gameId={gameId} />
                  </TabsContent>
                  <TabsContent value="history" className="pt-3">
                    <TradeHistoryTable gameId={gameId} />
                  </TabsContent>
                  <TabsContent value="chart" className="pt-3">
                    <StockChart symbols={heldSymbols} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-4">
            <HoldingsSidebar gameId={gameId} />
          </aside>
        </div>
      </main>
      <QuoteInfoDialog
        open={quoteDialog.open}
        symbol={quoteDialog.symbol}
        onOpenChange={(open) => {
          if (!open) quoteDialog.closeQuote();
        }}
        onTradeClick={(s) => quoteDialog.setSelectedTradeSymbol(s)}
      />
    </div>
  );
}
