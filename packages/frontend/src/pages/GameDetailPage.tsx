import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useGame, useJoinGame } from '@/api/games';
import { usePortfolio } from '@/api/trades';
import { useGameSocket } from '@/hooks/useGameSocket';
import { AppHeader } from '@/components/AppHeader';
import { PortfolioTable } from '@/components/PortfolioTable';
import { TradePanel } from '@/components/TradePanel';
import { TradeHistoryTable } from '@/components/TradeHistoryTable';
import { Leaderboard } from '@/components/Leaderboard';
import { StockChart } from '@/components/StockChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

export function GameDetailPage() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const game = useGame(gameId);
  const portfolio = usePortfolio(gameId);
  const join = useJoinGame();

  const heldSymbols = useMemo(
    () => portfolio.data?.holdings.map((h) => h.symbol) ?? [],
    [portfolio.data],
  );
  useGameSocket(gameId, heldSymbols);

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
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            {game.isLoading ? (
              <Skeleton className="h-7 w-48" />
            ) : (
              <h1 className="text-2xl font-semibold tracking-tight">{game.data?.name}</h1>
            )}
            {game.data && (
              <p className="text-sm text-muted-foreground">
                Status:{' '}
                <span
                  className={cn(
                    game.data.status === 'active' && 'text-green-600 dark:text-green-400 font-medium',
                  )}
                >
                  {game.data.status}
                </span>
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Tabs defaultValue="portfolio">
              <TabsList>
                <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
                <TabsTrigger value="trade">Trade</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
                <TabsTrigger value="chart">Chart</TabsTrigger>
              </TabsList>
              <TabsContent value="portfolio">
                <PortfolioTable gameId={gameId} />
              </TabsContent>
              <TabsContent value="trade">
                <TradePanel gameId={gameId} />
              </TabsContent>
              <TabsContent value="history">
                <TradeHistoryTable gameId={gameId} />
              </TabsContent>
              <TabsContent value="chart">
                <StockChart symbols={heldSymbols} />
              </TabsContent>
            </Tabs>
          </div>
          <div className="space-y-4">
            <Leaderboard gameId={gameId} />
          </div>
        </div>
      </main>
    </div>
  );
}
