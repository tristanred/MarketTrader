import { Link, useParams } from 'react-router-dom';
import type { DiscoverList } from '@markettrader/shared';
import { useGame } from '@/api/games';
import { useDiscover } from '@/api/discover';
import { Panel, PanelBody, PanelHeader } from '@/components/panel';
import { GameCrumb } from '@/components/GameCrumb';
import { GameTradeDialogs } from '@/components/GameTradeDialogs';
import { PicksHeatGrid } from '@/components/discover/PicksHeatGrid';
import { MoversList } from '@/components/discover/MoversList';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMaybeSetSelectedSymbol } from '@/contexts/SelectedSymbolContext';
import { useQuoteDialogStore } from '@/stores/quoteDialogStore';
import { ApiError } from '@/lib/api';
import { formatMarketTime, formatSessionDate, SECTION_LABELS } from '@/lib/discover';

/**
 * Game-scoped Discover page at `/games/:gameId/discover`: the game's daily
 * picks as a heat grid, then the market-wide movers lists. Every stock opens
 * the quote dialog, and from there the trade dialog.
 */
export function DiscoverPage() {
  const { gameId = '' } = useParams<{ gameId: string }>();
  const game = useGame(gameId);
  const discover = useDiscover(gameId);
  const openQuote = useQuoteDialogStore((s) => s.openQuote);
  // Trading from here also pivots the arena, so heading back lands on that stock.
  const setSelectedSymbol = useMaybeSetSelectedSymbol();

  const notFound =
    (game.isError && game.error instanceof ApiError && game.error.status === 404) ||
    (discover.isError && discover.error instanceof ApiError && discover.error.status === 404);
  if (notFound) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold text-text-strong">Game not found</h1>
        <p className="mt-2 text-sm text-muted">
          You may not be a member of this game, or it may have been deleted.
        </p>
        <Link to="/" className="mt-4 inline-block text-sm text-accent hover:underline">
          Back to games
        </Link>
      </main>
    );
  }

  const data = discover.data;
  const list = data?.status === 'ready' ? data.list : null;

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-3">
      {game.data ? (
        <GameCrumb gameId={gameId} gameName={game.data.name} current="Discover" />
      ) : (
        <Skeleton className="h-3 w-48" />
      )}

      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div className="max-w-prose">
          <h1 className="text-[22px] font-semibold tracking-tight text-text-strong">Discover</h1>
          <p className="mt-1 text-sm text-muted">
            Twenty S&amp;P 500 stocks drawn for this game, plus what moved the whole market. A new
            draw arrives after each market close.
          </p>
        </div>
        {list ? (
          <p className="text-xs text-muted">
            Prices as of{' '}
            <time dateTime={list.generatedAt} className="text-text">
              {formatMarketTime(list.generatedAt)}
            </time>
          </p>
        ) : null}
      </header>

      {discover.isLoading ? (
        <LoadingState />
      ) : discover.isError ? (
        <Notice>
          <p>Couldn&rsquo;t load Discover. Check your connection and try again.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => discover.refetch()}>
            Try again
          </Button>
        </Notice>
      ) : data?.status === 'ended' ? (
        <Notice>
          <p>This game has ended, so there are no new picks to discover.</p>
          <Link
            to={`/games/${gameId}/leaderboard`}
            className="mt-3 inline-block text-accent hover:underline"
          >
            See the final standings
          </Link>
        </Notice>
      ) : data?.status === 'preparing' ? (
        <Notice>
          <p>Today&rsquo;s draw is being prepared. This usually takes a few minutes.</p>
          <p className="mt-1 text-xs">This page updates on its own.</p>
        </Notice>
      ) : list ? (
        <DiscoverSections list={list} onSelect={openQuote} />
      ) : null}

      <GameTradeDialogs
        gameId={gameId}
        game={game.data ?? {}}
        {...(setSelectedSymbol ? { onTradeSymbol: setSelectedSymbol } : {})}
      />
    </main>
  );
}

function DiscoverSections({
  list,
  onSelect,
}: {
  list: DiscoverList;
  onSelect: (symbol: string) => void;
}) {
  const picks = list.sections.find((s) => s.kind === 'picks')?.items ?? [];
  const movers = list.sections.filter((s) => s.kind !== 'picks' && s.items.length > 0);

  return (
    <>
      <Panel>
        <PanelHeader right={<span className="font-mono">{picks.length} stocks</span>}>
          {SECTION_LABELS.picks}
        </PanelHeader>
        <PanelBody className="p-2.5">
          <PicksHeatGrid items={picks} onSelect={onSelect} />
        </PanelBody>
      </Panel>

      {movers.length > 0 ? (
        <section aria-labelledby="discover-movers" className="flex flex-col gap-2">
          <h2 id="discover-movers" className="text-sm text-muted">
            What moved the market in the{' '}
            <time dateTime={list.sessionDate} className="text-text">
              {formatSessionDate(list.sessionDate)}
            </time>{' '}
            session
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {movers.map((s) => (
              <MoversList
                key={s.kind}
                title={SECTION_LABELS[s.kind]}
                items={s.items}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-xs text-muted">
          Market movers weren&rsquo;t captured for this session. They return after the next close.
        </p>
      )}
    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Panel>
      <PanelBody className="px-4 py-10 text-center text-sm text-muted">{children}</PanelBody>
    </Panel>
  );
}

function LoadingState() {
  return (
    <Panel aria-busy="true" aria-label="Loading Discover">
      <PanelBody className="grid grid-cols-2 gap-1.5 p-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-[72px]" />
        ))}
      </PanelBody>
    </Panel>
  );
}
