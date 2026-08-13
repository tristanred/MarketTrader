import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGameByCode, useJoinGame } from '@/api/games';
import { LedgerRow } from '@/components/game/LedgerRow';
import { Panel, PanelBody } from '@/components/panel';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { toastApiError } from '@/lib/toastApiError';
import { formatUSD } from '@/lib/utils';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// The alphabet drops ambiguous characters so codes can be read aloud; splitting
// into two groups is the other half of that — it's how people say them.
function groupCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

/**
 * Landing page for an invite link, set out as the ticket the sharer handed
 * over: the code they quoted, the terms of the game, and one action. Members
 * are routed straight into the game instead.
 */
export function JoinByCodePage() {
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const lookup = useGameByCode(code);
  const join = useJoinGame();

  const gameId = lookup.data?.id;
  const alreadyMember = lookup.data?.alreadyMember ?? false;

  useEffect(() => {
    if (alreadyMember && gameId) navigate(`/games/${gameId}`, { replace: true });
  }, [alreadyMember, gameId, navigate]);

  async function handleJoin() {
    if (!gameId) return;
    try {
      await join.mutateAsync(gameId);
      toast({ title: 'Joined', variant: 'success' });
      navigate(`/games/${gameId}`, { replace: true });
    } catch (err) {
      toastApiError(err, 'Could not join game');
    }
  }

  if (lookup.isLoading) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
        <Skeleton className="mb-3 h-3 w-20" />
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }

  if (lookup.isError || !lookup.data) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
          Invitation
        </p>
        <Panel>
          <PanelBody className="space-y-3 p-6">
            <h1 className="text-lg font-bold tracking-[-0.025em] text-text-strong">
              This invite isn't valid
            </h1>
            <p className="text-sm text-muted">
              The link was mistyped, or the game it pointed to is gone. Ask whoever shared it for a
              new one.
            </p>
            <Button
              className="font-mono uppercase tracking-[0.1em]"
              onClick={() => navigate('/')}
            >
              Back to games
            </Button>
          </PanelBody>
        </Panel>
      </main>
    );
  }

  const game = lookup.data;
  const hasEnded = game.status === 'ended';

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10 sm:py-16">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Invitation</p>

      <Panel>
        <PanelBody className="space-y-5 p-0">
          <header className="space-y-1 px-6 pt-6">
            <h1 className="text-2xl font-bold leading-tight tracking-[-0.03em] text-text-strong">
              {game.name}
            </h1>
            <p className="font-mono text-[11px] tracking-[0.04em] text-muted">
              Hosted by {game.createdByUsername}
            </p>
          </header>

          {/* The tear-off: everything below the perforation is the stub the
              sharer quoted, with their code recessed into it. */}
          <div className="border-t border-dashed border-hairline-strong" />

          <div className="space-y-5 px-6 pb-6">
            <div className="rounded-chip border border-hairline-strong bg-bg px-4 py-3 text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                Invite code
              </div>
              <div className="mt-1 font-mono text-2xl font-medium tracking-[0.22em] text-accent">
                {groupCode(code.toUpperCase())}
              </div>
            </div>

            <div className="space-y-2">
              <LedgerRow label="Players">{game.playerCount}</LedgerRow>
              <LedgerRow label="Starting cash">{formatUSD(game.startingBalance)}</LedgerRow>
              <LedgerRow label="Runs">
                {formatDate(game.startDate)} → {formatDate(game.endDate)}
              </LedgerRow>
              <LedgerRow label="Status" valueClassName={hasEnded ? 'text-loss' : ''}>
                {game.status.toUpperCase()}
              </LedgerRow>
            </div>

            {hasEnded ? (
              <div className="space-y-3">
                <Button className="w-full font-mono uppercase tracking-[0.1em]" disabled>
                  Game has ended
                </Button>
                <Button
                  variant="outline"
                  className="w-full font-mono uppercase tracking-[0.1em]"
                  onClick={() => navigate('/')}
                >
                  Find an open game
                </Button>
              </div>
            ) : (
              <Button
                size="lg"
                className="w-full font-mono uppercase tracking-[0.1em]"
                onClick={handleJoin}
                disabled={join.isPending}
              >
                {join.isPending ? 'Joining…' : 'Join game'}
              </Button>
            )}
          </div>
        </PanelBody>
      </Panel>
    </main>
  );
}
