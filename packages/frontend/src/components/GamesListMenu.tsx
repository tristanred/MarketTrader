import { useRef, useState, type KeyboardEvent } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CreateGameDialog } from '@/components/CreateGameDialog';
import { JoinByCodeDialog } from '@/components/JoinByCodeDialog';

type DialogKind = 'create' | 'join';

const ITEMS: ReadonlyArray<{ kind: DialogKind; label: string }> = [
  { kind: 'create', label: '+ New game' },
  { kind: 'join', label: 'Join with code' },
];

/**
 * Overflow menu for the games list header. Creating a game or joining one by
 * code are deliberate acts, not the page's default one — browsing the games
 * you already hold is — so they live behind the hamburger rather than beside
 * the heading. Owns the dialogs it launches so the focus hand-off below stays
 * in one file.
 *
 * `role="menu"` promises roving arrow-key focus and Popover does not provide
 * it, so the items carry a roving `tabIndex` and the content handles the keys.
 */
export function GamesListMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const handingOff = useRef(false);

  const openDialog = (kind: DialogKind) => {
    handingOff.current = true;
    setMenuOpen(false);
    setDialog(kind);
  };

  const closeDialog = (open: boolean) => {
    if (open) return;
    setDialog(null);
    triggerRef.current?.focus();
  };

  const focusItem = (index: number) => {
    const next = (index + ITEMS.length) % ITEMS.length;
    setActiveIndex(next);
    itemRefs.current[next]?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, () => void> = {
      ArrowDown: () => focusItem(activeIndex + 1),
      ArrowUp: () => focusItem(activeIndex - 1),
      Home: () => focusItem(0),
      End: () => focusItem(ITEMS.length - 1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  };

  return (
    <>
      <Popover.Root
        open={menuOpen}
        onOpenChange={(open) => {
          if (open) setActiveIndex(0);
          setMenuOpen(open);
        }}
      >
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
            onKeyDown={onMenuKeyDown}
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
            {ITEMS.map((item, index) => (
              <button
                key={item.kind}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={index === activeIndex ? 0 : -1}
                onClick={() => openDialog(item.kind)}
                onFocus={() => setActiveIndex(index)}
                className="w-full rounded-chip px-2.5 py-1.5 text-left font-mono text-xs uppercase tracking-[0.1em] text-text hover:bg-hairline focus-visible:bg-hairline focus-visible:outline-none"
              >
                {item.label}
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <CreateGameDialog open={dialog === 'create'} onOpenChange={closeDialog} />
      <JoinByCodeDialog open={dialog === 'join'} onOpenChange={closeDialog} />
    </>
  );
}
