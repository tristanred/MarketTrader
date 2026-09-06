import { useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CreateGameDialog } from '@/components/CreateGameDialog';

/**
 * Overflow menu for the games list header. Creating a game is a deliberate
 * act, not the page's default one — browsing the games you already hold is —
 * so it lives behind the hamburger rather than beside the heading. Owns the
 * dialogs it launches so the focus hand-off below stays in one file.
 *
 * One item, so Radix's focus scope (item focused on open, Tab to cycle, Escape
 * to dismiss) is the whole keyboard story. A second item needs roving arrow-key
 * focus added — `role="menu"` promises it and Popover does not provide it.
 */
export function GamesListMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const handingOff = useRef(false);

  const openCreateDialog = () => {
    handingOff.current = true;
    setMenuOpen(false);
    setCreateOpen(true);
  };

  return (
    <>
      <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Popover.Trigger asChild>
          <Button ref={triggerRef} variant="ghost" size="icon" aria-label="Games menu">
            <Menu className="h-4 w-4" />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            role="menu"
            align="end"
            sideOffset={6}
            className="z-50 min-w-44 rounded-panel border border-hairline-strong bg-panel p-1 shadow-lg"
            // Radix restores focus to the trigger as the menu unmounts, which
            // lands on top of the dialog that is claiming focus in the same
            // tick. Suppress the restore on a hand-off and give the trigger its
            // focus back when the dialog itself closes.
            onCloseAutoFocus={(event) => {
              if (!handingOff.current) return;
              handingOff.current = false;
              event.preventDefault();
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={openCreateDialog}
              className="w-full rounded-chip px-2.5 py-1.5 text-left font-mono text-xs uppercase tracking-[0.1em] text-text hover:bg-hairline focus-visible:bg-hairline focus-visible:outline-none"
            >
              + New game
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <CreateGameDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) triggerRef.current?.focus();
        }}
      />
    </>
  );
}
