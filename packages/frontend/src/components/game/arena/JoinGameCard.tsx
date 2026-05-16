import { useJoinGame } from '@/api/games';
import { Panel, PanelHeader, PanelBody } from '@/components/panel';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';

export interface JoinGameCardProps {
  gameId: string;
  onJoined: () => void;
}

/**
 * Rendered on the game-detail route when the user isn't a member yet (the
 * server returns 404 for non-members). Posting accepts the join and calls
 * onJoined so the page can refetch the game.
 */
export function JoinGameCard({ gameId, onJoined }: JoinGameCardProps) {
  const join = useJoinGame();

  async function handleJoin() {
    try {
      await join.mutateAsync(gameId);
      toast({ title: 'Joined', variant: 'success' });
      onJoined();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? typeof err.body === 'object' && err.body && 'error' in err.body
            ? String((err.body as { error: unknown }).error)
            : `Error ${err.status}`
          : 'Failed to join';
      toast({ title: 'Could not join', description: msg, variant: 'destructive' });
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <Panel>
        <PanelHeader>Join this game?</PanelHeader>
        <PanelBody>
          <p className="mb-3 text-sm text-muted">
            You're not a member yet, or this game doesn't exist. Try joining — if the ID is invalid
            you'll get an error.
          </p>
          <Button onClick={handleJoin} disabled={join.isPending}>
            {join.isPending ? 'Joining…' : 'Join game'}
          </Button>
        </PanelBody>
      </Panel>
    </main>
  );
}
