import { useState, type SubmitEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseInviteCode } from '@/lib/inviteCode';

interface JoinByCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Takes an invite code (or a pasted invite link) and hands off to the
 * `/join/:code` page, which shows the game and asks for the actual join. It
 * never joins on its own: the viewer should see which game a code is for
 * before committing to it. Controlled for the same reason as
 * {@link CreateGameDialog} — its trigger lives in {@link GamesListMenu}.
 */
export function JoinByCodeDialog({ open, onOpenChange }: JoinByCodeDialogProps) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setValue('');
      setInvalid(false);
    }
    onOpenChange(next);
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = parseInviteCode(value);
    if (!code) {
      setInvalid(true);
      return;
    }
    handleOpenChange(false);
    navigate(`/join/${code}`);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Join a private game</DialogTitle>
          <DialogDescription>
            Paste the invite code or link you were sent. You'll see the game before you join.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="invite-code">Invite code</Label>
            <Input
              id="invite-code"
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              data-bwignore
              placeholder="K7QM 4XTP"
              className="font-mono uppercase tracking-[0.16em]"
              value={value}
              aria-invalid={invalid}
              aria-describedby={invalid ? 'invite-code-error' : undefined}
              onChange={(e) => {
                setValue(e.target.value);
                setInvalid(false);
              }}
            />
            {invalid && (
              <p id="invite-code-error" className="text-xs text-destructive">
                That doesn't look like an invite code. Check it and try again.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={value.trim() === ''}>
              Next
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
