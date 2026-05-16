import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useGame } from '@/api/games';

export interface AboutGameModalProps {
  gameId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Game info modal opened from the status strip's `[i]` button. Renders
 * the game's name, status, player count, and starting cash. The arena
 * page itself shows live state; this modal is the static info surface.
 */
export function AboutGameModal({ gameId, open, onOpenChange }: AboutGameModalProps) {
  const game = useGame(gameId);
  const playerCount = game.data?.leaderboard?.length ?? 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{game.data?.name ?? 'Game info'}</DialogTitle>
        </DialogHeader>
        {game.data ? (
          <div className="space-y-2 text-sm text-muted">
            <div>
              <span className="font-medium text-text">Status:</span> {game.data.status}
            </div>
            <div>
              <span className="font-medium text-text">Players:</span> {playerCount}
            </div>
            <div>
              <span className="font-medium text-text">Starting cash:</span> $
              {game.data.startingBalance.toLocaleString()}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
