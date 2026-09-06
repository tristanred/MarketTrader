import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useSetWatchlistNote } from '@/api/watchlists';
import { toast } from '@/components/ui/toast';
import {
  MIN_NOTE_SIZE,
  VIEWPORT_MARGIN,
  clampNoteSize,
  readNoteSize,
  writeNoteSize,
  type NoteSize,
} from '@/lib/noteSize';
import { cn } from '@/lib/utils';

/** Mirrors `noteSchema` in `server/src/routes/watchlists.ts`; the server answers 400 past it. */
const NOTE_MAX_LENGTH = 1000;

/** Idle time after the last keystroke before the note is written. */
const AUTOSAVE_DELAY_MS = 700;

/** Below this the counter stays hidden — a 40-character note doesn't need a budget. */
const COUNTER_VISIBLE_FROM = 800;

/** Pixels one arrow-key press moves the resize grip. */
const KEYBOARD_RESIZE_STEP = 24;

/** Gap between the trigger row and the note. */
const NOTE_GAP = 6;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Displacement from where Radix would place the note on its own, in pixels.
 * Fed back through `alignOffset`/`sideOffset` rather than a CSS transform: a
 * transform moves the note without Radix knowing, so its collision handling
 * measures the old position and shoves the note back while the user is still
 * dragging it. Told the real position, it leaves a well-behaved drag alone.
 */
interface NoteNudge {
  x: number;
  y: number;
}

const NO_NUDGE: NoteNudge = { x: 0, y: 0 };

interface CornerSpec {
  id: 'nw' | 'ne' | 'sw' | 'se';
  /** Drags the note's west edge, holding the east one still. */
  west: boolean;
  /** Drags the note's north edge, holding the south one still. */
  north: boolean;
  position: string;
  cursor: string;
  /** Rotates the shared tick so it points out of its own corner. */
  rotation: string;
  /**
   * Whether the corner carries a visible tick. The top two sit under the header
   * strip, where a mark would crowd the title and the close control — they stay
   * draggable, and the resize cursor is what announces them.
   */
  ticked: boolean;
}

// The bottom-right is the conventional grip and the only one that takes
// keyboard focus; it renders last so it wins any overlap.
const CORNERS: readonly CornerSpec[] = [
  { id: 'nw', west: true, north: true, position: 'left-0 top-0', cursor: 'cursor-nwse-resize', rotation: 'rotate-180', ticked: false },
  { id: 'ne', west: false, north: true, position: 'right-0 top-0', cursor: 'cursor-nesw-resize', rotation: '-rotate-90', ticked: false },
  { id: 'sw', west: true, north: false, position: 'left-0 bottom-0', cursor: 'cursor-nesw-resize', rotation: 'rotate-90', ticked: true },
  { id: 'se', west: false, north: false, position: 'right-0 bottom-0', cursor: 'cursor-nwse-resize', rotation: '', ticked: true },
];

export interface SymbolNotePopoverProps {
  symbol: string;
  /** The note already stored for this symbol, if any. */
  note?: string;
  /** Watchlist the symbol belongs to — the note's owner. */
  watchlistId: string;
}

/**
 * The per-symbol note editor: a page glyph beside the ticker that opens a
 * floating textarea, resizable from any of its four corners. There is no save
 * control — edits are written {@link AUTOSAVE_DELAY_MS} after typing stops and
 * flushed again on close, so closing the note never discards it. The dragged
 * size is remembered across every note via {@link readNoteSize}; where the user
 * dragged it to is not, since each note re-anchors to its own row.
 */
export function SymbolNotePopover({ symbol, note, watchlistId }: SymbolNotePopoverProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note ?? '');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [size, setSize] = useState<NoteSize>(() => readNoteSize());
  const [nudge, setNudge] = useState<NoteNudge>(NO_NUDGE);
  const savedRef = useRef(note ?? '');
  const draftRef = useRef(draft);
  const statusRef = useRef(status);
  // These mirror state but are updated the moment a new value is computed
  // rather than at render. A drag's pointerup can land in the same task as its
  // last pointermove, before React has re-rendered — reading off the last
  // render there persists the size the drag *started* at.
  const sizeRef = useRef(size);
  const nudgeRef = useRef(nudge);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const setNote = useSetWatchlistNote();
  // Held by ref so `save` stays referentially stable — the mutation object is
  // new on every render, and a changing `save` would restart the autosave
  // debounce on each keystroke's re-render and never fire.
  const setNoteRef = useRef(setNote);
  const hasNote = (note ?? '').length > 0;

  setNoteRef.current = setNote;
  draftRef.current = draft;
  statusRef.current = status;

  const save = useCallback(
    async (text: string, announceFailure = false) => {
      setStatus('saving');
      try {
        await setNoteRef.current.mutateAsync({ id: watchlistId, symbol, body: { note: text } });
        savedRef.current = text;
        setStatus('saved');
      } catch {
        setStatus('error');
        // The status strip went with the popover, so a flush-on-close failure
        // has nowhere to show. The draft is kept below for the retry.
        if (announceFailure) {
          toast({
            title: 'Note not saved',
            description: `Reopen ${symbol} to try again — your text is still there.`,
            variant: 'destructive',
          });
        }
      }
    },
    [watchlistId, symbol],
  );

  useEffect(() => {
    if (!open || draft === savedRef.current) return;
    const timer = window.setTimeout(() => void save(draft), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, open, save]);

  const commitSize = (next: NoteSize) => {
    sizeRef.current = next;
    setSize(next);
    return next;
  };

  const commitNudge = (next: NoteNudge) => {
    nudgeRef.current = next;
    setNudge(next);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      commitSize(readNoteSize());
      // Each note anchors to its own row, so a displacement dragged out on one
      // makes no sense on the next.
      commitNudge(NO_NUDGE);
      // A write that failed leaves the only copy of the user's text in `draft`,
      // so re-seeding from the server would discard it. Keeping it also lets the
      // autosave effect retry unprompted, since the draft stays dirty.
      const holdingFailedEdit =
        statusRef.current === 'error' && draftRef.current !== savedRef.current;
      if (!holdingFailedEdit) {
        // Take the server's copy — another device may have edited it while this
        // row sat on screen.
        setDraft(note ?? '');
        savedRef.current = note ?? '';
        setStatus('idle');
      }
    } else if (draftRef.current !== savedRef.current) {
      // Fires after the content unmounts; the mutation promise outlives it.
      void save(draftRef.current, true);
    }
    setOpen(next);
  };

  const startResize = (corner: CornerSpec, event: ReactPointerEvent<HTMLElement>) => {
    const content = contentRef.current;
    if (!content) return;
    event.preventDefault();
    const origin = { x: event.clientX, y: event.clientY };
    const startNudge = nudgeRef.current;
    // Measured, not taken from `size`: while the note is undragged its rendered
    // height can be smaller than its stored one, because the available-space
    // maxima above cap it. Starting from state there would jump the note to its
    // full stored size on the first pointermove.
    const start = content.getBoundingClientRect();
    // `side` only flips between placements, never mid-drag, so reading it once
    // is enough — and it decides which way sideOffset has to move.
    const flippedAbove = content.dataset['side'] === 'top';
    const grip = event.currentTarget;
    grip.setPointerCapture?.(event.pointerId);

    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - origin.x;
      const dy = move.clientY - origin.y;
      // Work in edges rather than width/height: only the dragged edges move,
      // and clamping them is what keeps the note both above its minimum and
      // inside the viewport — a size-only clamp bounds neither its position nor
      // the corner it is anchored to.
      const edges = {
        left: corner.west ? start.left + dx : start.left,
        right: corner.west ? start.right : start.right + dx,
        top: corner.north ? start.top + dy : start.top,
        bottom: corner.north ? start.bottom : start.bottom + dy,
      };
      if (corner.west) {
        edges.left = Math.max(VIEWPORT_MARGIN, Math.min(edges.left, edges.right - MIN_NOTE_SIZE.width));
      } else {
        edges.right = Math.min(
          window.innerWidth - VIEWPORT_MARGIN,
          Math.max(edges.right, edges.left + MIN_NOTE_SIZE.width),
        );
      }
      if (corner.north) {
        edges.top = Math.max(VIEWPORT_MARGIN, Math.min(edges.top, edges.bottom - MIN_NOTE_SIZE.height));
      } else {
        edges.bottom = Math.min(
          window.innerHeight - VIEWPORT_MARGIN,
          Math.max(edges.bottom, edges.top + MIN_NOTE_SIZE.height),
        );
      }

      commitSize({
        width: Math.round(edges.right - edges.left),
        height: Math.round(edges.bottom - edges.top),
      });
      commitNudge({
        // alignOffset moves the note's left edge one-for-one.
        x: Math.round(startNudge.x + (edges.left - start.left)),
        // Anchored below the row, sideOffset moves the note's top edge. Flipped
        // above it, it moves the bottom edge, and in the opposite direction.
        y: Math.round(
          flippedAbove
            ? startNudge.y - (edges.bottom - start.bottom)
            : startNudge.y + (edges.top - start.top),
        ),
      });
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      // One write per gesture rather than one per pixel of drag.
      writeNoteSize(sizeRef.current);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  };

  const resizeByKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const delta: Record<string, [number, number]> = {
      ArrowRight: [KEYBOARD_RESIZE_STEP, 0],
      ArrowLeft: [-KEYBOARD_RESIZE_STEP, 0],
      ArrowDown: [0, KEYBOARD_RESIZE_STEP],
      ArrowUp: [0, -KEYBOARD_RESIZE_STEP],
    };
    const step = delta[event.key];
    if (!step) return;
    event.preventDefault();
    const from = sizeRef.current;
    writeNoteSize(
      commitSize(clampNoteSize({ width: from.width + step[0], height: from.height + step[1] })),
    );
  };

  const undragged = nudge.x === 0 && nudge.y === 0;

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`${hasNote ? 'Edit' : 'Add'} note for ${symbol}`}
          className={cn(
            'pointer-events-auto shrink-0 rounded-[3px] p-0.5 leading-none transition-opacity',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
            hasNote
              ? 'text-accent'
              : cn(
                  'text-muted opacity-0 hover:text-text-strong',
                  'focus-visible:opacity-100 group-hover:opacity-100',
                  // Without a note the glyph hides until hover, which never
                  // happens on touch — there the only way to write a first
                  // note is for it to be visible from the start.
                  '[@media(hover:none)]:opacity-100',
                ),
            open && 'text-accent opacity-100',
          )}
        >
          <NoteGlyph written={hasNote} />
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          ref={contentRef}
          side="bottom"
          align="start"
          sideOffset={NOTE_GAP + nudge.y}
          alignOffset={nudge.x}
          collisionPadding={12}
          style={{
            width: size.width,
            height: size.height,
            // clampNoteSize only knows the viewport. Radix picks the side and
            // is the only one that knows the room left on it — without these, a
            // tall stored size flipped above a low row renders with its header
            // (and close button) off the top of the screen. Dropped once the
            // user drags: the room on a side is not a limit they chose.
            ...(undragged
              ? {
                  maxWidth: 'var(--radix-popover-content-available-width)',
                  maxHeight: 'var(--radix-popover-content-available-height)',
                }
              : {}),
          }}
          onOpenAutoFocus={(event) => {
            // Radix would land on the close button; the point of opening this
            // is to type.
            event.preventDefault();
            textareaRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            // WatchlistPanel keeps a window-level Escape handler that collapses
            // its inline modes. Stop here so dismissing a note can never reach it.
            event.stopPropagation();
          }}
          className={cn(
            'group/note relative z-50 flex flex-col overflow-hidden rounded-panel',
            'border border-hairline-strong bg-panel shadow-[0_8px_24px_rgba(0,0,0,0.35)]',
          )}
        >
          <div className="flex h-7 shrink-0 items-center gap-2 border-b border-hairline px-2.5 font-mono text-[10px] uppercase tracking-[0.14em]">
            <span className="flex items-center gap-1.5 text-muted">
              Note
              <span aria-hidden>·</span>
              <span className="text-accent">{symbol}</span>
            </span>
            <StatusLabel status={status} />
            {draft.length >= COUNTER_VISIBLE_FROM ? (
              // Lives up here rather than floating over the corner: the
              // textarea scrolls, and anything laid over it hides text.
              <span
                className={cn('ml-auto', draft.length >= NOTE_MAX_LENGTH ? 'text-loss' : 'text-muted')}
              >
                {draft.length}/{NOTE_MAX_LENGTH}
              </span>
            ) : null}
            <Popover.Close
              aria-label="Close note"
              className={cn(
                // Above the top-right grip, so the corner never steals a close.
                'relative z-10 rounded-[3px] px-1 text-muted hover:text-text-strong',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                draft.length >= COUNTER_VISIBLE_FROM ? '' : 'ml-auto',
              )}
            >
              <CloseGlyph />
            </Popover.Close>
          </div>

          <textarea
            ref={textareaRef}
            aria-label={`Note for ${symbol}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={NOTE_MAX_LENGTH}
            spellCheck
            placeholder="Why you're watching this one."
            className={cn(
              // pb leaves the bottom corners to the grips.
              'min-h-0 flex-1 resize-none bg-transparent px-2.5 pb-5 pt-2',
              'font-mono text-[11px] leading-relaxed text-text placeholder:text-muted',
              'focus:outline-none',
            )}
          />

          {CORNERS.map((corner) =>
            corner.id === 'se' ? (
              <button
                key={corner.id}
                type="button"
                data-testid="note-resize-se"
                aria-label="Resize note"
                onPointerDown={(event) => startResize(corner, event)}
                onKeyDown={resizeByKey}
                className={cn(
                  'absolute rounded-[3px] p-1 text-muted hover:text-accent',
                  'focus-visible:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                  corner.position,
                  corner.cursor,
                )}
              >
                <GripGlyph />
              </button>
            ) : (
              // Pointer conveniences only: the same resize is reachable from the
              // focusable bottom-right grip with the arrow keys, so three more
              // tab stops per note would be noise.
              <span
                key={corner.id}
                aria-hidden
                data-testid={`note-resize-${corner.id}`}
                onPointerDown={(event) => startResize(corner, event)}
                className={cn(
                  'absolute p-1 text-muted transition-opacity',
                  corner.ticked
                    ? 'opacity-0 hover:text-accent group-hover/note:opacity-100'
                    : // Unticked corners still need their 18px of grabbable area.
                      'opacity-0',
                  corner.position,
                  corner.cursor,
                )}
              >
                <GripGlyph className={corner.rotation} />
              </span>
            ),
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Autosave feedback, in the header strip. Silent until the first write. */
function StatusLabel({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null;
  return (
    <span role="status" className={status === 'error' ? 'text-loss' : 'text-muted'}>
      {status === 'error' ? 'Not saved' : status === 'saving' ? 'Saving' : 'Saved'}
    </span>
  );
}

/** A page glyph: blank when the symbol has no note, ruled with two lines when it does. */
function NoteGlyph({ written }: { written: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d="M2.5 1.5 H7 L9.5 4 V10.5 H2.5 Z" />
      <path d="M7 1.5 V4 H9.5" />
      {written ? <path d="M4.3 6.2 H7.7 M4.3 8.2 H6.5" /> : null}
    </svg>
  );
}

function GripGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 10 10"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="square"
      className={className}
    >
      <path d="M9.5 2.5 L2.5 9.5 M9.5 6 L6 9.5" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 10 10"
      width="9"
      height="9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="square"
    >
      <path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" />
    </svg>
  );
}
