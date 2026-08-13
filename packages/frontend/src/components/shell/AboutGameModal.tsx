import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { toastApiError } from '@/lib/toastApiError';
import { LedgerRow } from '@/components/game/LedgerRow';
import { useGame, useMintInviteCode, useUpdateGameVisibility } from '@/api/games';
import { useAuthStore } from '@/stores/authStore';
import { cn, formatUSD } from '@/lib/utils';

export interface AboutGameModalProps {
  gameId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Game info modal opened from the status strip's `[i]` button. Sets out the
 * game's terms as a statement, then the two things a member can act on:
 * the invite link, and — for the creator — whether the game is listed.
 */
export function AboutGameModal({ gameId, open, onOpenChange }: AboutGameModalProps) {
  const game = useGame(gameId);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const mintCode = useMintInviteCode(gameId);
  const updateVisibility = useUpdateGameVisibility(gameId);
  const [copied, setCopied] = useState(false);

  const playerCount = game.data?.leaderboard?.length ?? 0;
  const isCreator = !!currentUserId && game.data?.createdBy === currentUserId;
  // mintCode.data covers the gap between minting and the detail query refetching.
  const inviteCode = game.data?.inviteCode ?? mintCode.data?.inviteCode ?? null;
  const inviteUrl = inviteCode ? `${window.location.origin}/join/${inviteCode}` : null;

  async function handleCopy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: 'Invite link copied', variant: 'success' });
    } catch {
      // Clipboard access needs a secure context; the readout is select-all so
      // there is still a way through.
      toast({
        title: 'Copy the link by hand',
        description: 'This browser blocked clipboard access. Click the link to select it.',
        variant: 'destructive',
      });
    }
  }

  async function handleMint() {
    try {
      await mintCode.mutateAsync();
    } catch (err) {
      toastApiError(err, 'Could not create an invite link');
    }
  }

  async function handleToggleVisibility() {
    if (!game.data) return;
    const next = game.data.visibility === 'public' ? 'private' : 'public';
    try {
      await updateVisibility.mutateAsync(next);
      toast({
        title: next === 'public' ? 'Game is now public' : 'Game is now private',
        variant: 'success',
      });
    } catch (err) {
      toastApiError(err, 'Could not change visibility');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{game.data?.name ?? 'Game info'}</DialogTitle>
        </DialogHeader>

        {!game.data ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <LedgerRow label="Status">{game.data.status.toUpperCase()}</LedgerRow>
              <LedgerRow label="Players">{playerCount}</LedgerRow>
              <LedgerRow label="Starting cash">{formatUSD(game.data.startingBalance)}</LedgerRow>
              <LedgerRow label="Runs">
                {formatDate(game.data.startDate)} → {formatDate(game.data.endDate)}
              </LedgerRow>
            </div>

            <div className="space-y-2 border-t border-hairline pt-4">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                Invite link
              </h3>
              {inviteUrl ? (
                <>
                  <div className="flex items-center gap-2">
                    <div className="flex min-w-0 flex-1 select-all items-baseline rounded-chip border border-hairline-strong bg-bg px-3 py-2 font-mono text-xs">
                      <span className="truncate text-muted">
                        {window.location.host}/join/
                      </span>
                      <span className="shrink-0 tracking-[0.12em] text-text-strong">
                        {inviteCode}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      className="shrink-0 font-mono uppercase tracking-[0.1em]"
                      onClick={handleCopy}
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted">
                    Anyone with this link can join, whether the game is listed or not.
                  </p>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    className="font-mono uppercase tracking-[0.1em]"
                    onClick={handleMint}
                    disabled={mintCode.isPending}
                  >
                    {mintCode.isPending ? 'Creating…' : 'Create invite link'}
                  </Button>
                  <p className="text-xs text-muted">
                    This game predates invite links. Create one to share it.
                  </p>
                </>
              )}
            </div>

            <div className="space-y-2 border-t border-hairline pt-4">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                Visibility
              </h3>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <span
                    className={cn(
                      'rounded-chip px-2 py-0.5 font-mono text-[10px] tracking-[0.14em]',
                      game.data.visibility === 'public'
                        ? 'bg-accent-bg text-accent'
                        : 'bg-hairline text-muted',
                    )}
                  >
                    {game.data.visibility.toUpperCase()}
                  </span>
                  <p className="text-xs text-muted">
                    {game.data.visibility === 'public'
                      ? 'Listed in open games for everyone.'
                      : 'Hidden from open games. Reachable by invite link only.'}
                  </p>
                </div>
                {isCreator && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleToggleVisibility}
                    disabled={updateVisibility.isPending}
                  >
                    {game.data.visibility === 'public' ? 'Make private' : 'Make public'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
