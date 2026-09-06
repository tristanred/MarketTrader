import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';
import { WatchlistPanel, type WatchlistRow } from '@/components/game/arena/WatchlistPanel';
import { useSetWatchlistNote } from '@/api/watchlists';
import { DEFAULT_NOTE_SIZE } from '@/lib/noteSize';
import { useToastStore } from '@/components/ui/toast';

vi.mock('@/api/stocks', () => ({
  useStockSearch: (query: string) => ({
    data: query
      ? [{ symbol: 'MSFT', name: 'Microsoft Corporation' }]
      : [],
    isLoading: false,
    error: null,
  }),
}));

const setNote = vi.fn(() => Promise.resolve());

vi.mock('@/api/watchlists', () => ({
  useAddWatchlistSymbol: () => ({ mutateAsync: vi.fn() }),
  useCreateWatchlist: () => ({ mutateAsync: vi.fn() }),
  useRenameWatchlist: () => ({ mutateAsync: vi.fn() }),
  useDeleteWatchlist: () => ({ mutateAsync: vi.fn() }),
  useSetWatchlistNote: vi.fn(),
}));


// jsdom does no layout, so every getBoundingClientRect is a zero rect. The note
// resizes by moving the edges of its measured rect, so a drag test has to supply
// one — placed toward the right of a 1440x900 viewport, where the watchlist is.
const NOTE_AT = { left: 1000, top: 200 };

function stubNoteLayout(dialog: HTMLElement, size = DEFAULT_NOTE_SIZE) {
  dialog.getBoundingClientRect = () =>
    ({
      x: NOTE_AT.left,
      y: NOTE_AT.top,
      left: NOTE_AT.left,
      top: NOTE_AT.top,
      right: NOTE_AT.left + size.width,
      bottom: NOTE_AT.top + size.height,
      width: size.width,
      height: size.height,
      toJSON: () => ({}),
    }) as DOMRect;
}

async function dragCorner(corner: string, dx: number, dy: number) {
  const dialog = await screen.findByRole('dialog');
  stubNoteLayout(dialog);
  const grip = screen.getByTestId(`note-resize-${corner}`);
  const at = (type: string, x: number, y: number) =>
    grip.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    );
  at('pointerdown', 0, 0);
  at('pointermove', dx, dy);
  at('pointerup', dx, dy);
}

const ROWS: WatchlistRow[] = [
  { symbol: 'AAPL', last: 189.42, changePct: 0.84 },
  { symbol: 'NVDA', last: 1178.3, changePct: 2.41 },
  { symbol: 'TSLA', last: 241.05, changePct: -1.12 },
];

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  setNote.mockReset();
  setNote.mockResolvedValue(undefined);
  useToastStore.setState({ toasts: [] });
  window.localStorage.clear();
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  vi.mocked(useSetWatchlistNote).mockReturnValue({
    mutateAsync: setNote,
  } as unknown as ReturnType<typeof useSetWatchlistNote>);
});

describe('WatchlistPanel', () => {
  it('renders each row with symbol, last, and change %', () => {
    render(wrap(<WatchlistPanel rows={ROWS} />));
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('189.42')).toBeInTheDocument();
    expect(screen.getByText('+0.84%')).toBeInTheDocument();
    expect(screen.getByText('−1.12%')).toBeInTheDocument();
  });

  it('calls onSelect with the chosen symbol on row click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(wrap(<WatchlistPanel rows={ROWS} onSelect={onSelect} />));
    await user.click(screen.getByRole('button', { name: 'Select TSLA' }));
    expect(onSelect).toHaveBeenCalledWith('TSLA');
  });

  it('renders an empty state when no rows', () => {
    render(wrap(<WatchlistPanel rows={[]} />));
    expect(screen.getByText(/empty/i)).toBeInTheDocument();
  });

  it('expands an inline search when + ADD is clicked', async () => {
    const user = userEvent.setup();
    render(wrap(<WatchlistPanel rows={ROWS} watchlistId="wl-1" />));
    const addBtn = screen.getByRole('button', { name: /\+ ?ADD/i });
    await user.click(addBtn);
    // Header label flips to "Add to watchlist" with an ESC chip.
    expect(screen.getByText(/add to watchlist/i)).toBeInTheDocument();
    expect(screen.getByText('ESC')).toBeInTheDocument();
    // Inline search input is focused.
    expect(screen.getByPlaceholderText(/search symbol to add/i)).toBeInTheDocument();
  });

  describe('symbol notes', () => {
    it('offers to add a note on a symbol that has none', () => {
      render(wrap(<WatchlistPanel rows={ROWS} watchlistId="wl-1" />));
      expect(screen.getByRole('button', { name: 'Add note for AAPL' })).toBeInTheDocument();
    });

    it('offers to edit the note on a symbol that has one', () => {
      const rows: WatchlistRow[] = [{ symbol: 'AAPL', note: 'Watching the 180 level' }];
      render(wrap(<WatchlistPanel rows={rows} watchlistId="wl-1" />));
      expect(screen.getByRole('button', { name: 'Edit note for AAPL' })).toBeInTheDocument();
    });

    it('renders no note affordance when there is no active list to attach to', () => {
      render(wrap(<WatchlistPanel rows={ROWS} />));
      expect(screen.queryByRole('button', { name: /note for AAPL/i })).not.toBeInTheDocument();
    });

    it('opens the note showing the text already stored', async () => {
      const user = userEvent.setup();
      const rows: WatchlistRow[] = [{ symbol: 'AAPL', note: 'Watching the 180 level' }];
      render(wrap(<WatchlistPanel rows={rows} watchlistId="wl-1" />));
      await user.click(screen.getByRole('button', { name: 'Edit note for AAPL' }));
      expect(await screen.findByRole('textbox', { name: /note for AAPL/i })).toHaveValue(
        'Watching the 180 level',
      );
    });

    it('names the symbol in the note header', async () => {
      const user = userEvent.setup();
      render(wrap(<WatchlistPanel rows={ROWS} watchlistId="wl-1" />));
      await user.click(screen.getByRole('button', { name: 'Add note for NVDA' }));
      const panel = await screen.findByRole('dialog');
      expect(within(panel).getByText('Note')).toBeInTheDocument();
      expect(within(panel).getByText('NVDA')).toBeInTheDocument();
    });

    it('saves the note once typing settles', async () => {
      const user = userEvent.setup();
      render(wrap(<WatchlistPanel rows={ROWS} watchlistId="wl-1" />));
      await user.click(screen.getByRole('button', { name: 'Add note for AAPL' }));
      const box = await screen.findByRole('textbox', { name: /note for AAPL/i });
      await user.type(box, 'Buy the dip');
      await waitFor(
        () => {
          expect(setNote).toHaveBeenCalledWith({
            id: 'wl-1',
            symbol: 'AAPL',
            body: { note: 'Buy the dip' },
          });
        },
        { timeout: 3000 },
      );
    });

    it('flushes an unsaved edit when the note is closed', async () => {
      const user = userEvent.setup();
      render(wrap(<WatchlistPanel rows={ROWS} watchlistId="wl-1" />));
      await user.click(screen.getByRole('button', { name: 'Add note for AAPL' }));
      const box = await screen.findByRole('textbox', { name: /note for AAPL/i });
      await user.type(box, 'Quick');
      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(setNote).toHaveBeenCalledWith({
          id: 'wl-1',
          symbol: 'AAPL',
          body: { note: 'Quick' },
        });
      });
    });

    it('does not save when the note is opened and closed untouched', async () => {
      const user = userEvent.setup();
      const rows: WatchlistRow[] = [{ symbol: 'AAPL', note: 'unchanged' }];
      render(wrap(<WatchlistPanel rows={rows} watchlistId="wl-1" />));
      await user.click(screen.getByRole('button', { name: 'Edit note for AAPL' }));
      await screen.findByRole('textbox', { name: /note for AAPL/i });
      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByRole('textbox', { name: /note for AAPL/i })).not.toBeInTheDocument();
      });
      expect(setNote).not.toHaveBeenCalled();
    });

    it('sends an empty note when the text is cleared out', async () => {
      const user = userEvent.setup();
      const rows: WatchlistRow[] = [{ symbol: 'AAPL', note: 'obsolete' }];
      render(wrap(<WatchlistPanel rows={rows} watchlistId="wl-1" />));
      await user.click(screen.getByRole('button', { name: 'Edit note for AAPL' }));
      const box = await screen.findByRole('textbox', { name: /note for AAPL/i });
      await user.clear(box);
      await waitFor(
        () => {
          expect(setNote).toHaveBeenCalledWith({
            id: 'wl-1',
            symbol: 'AAPL',
            body: { note: '' },
          });
        },
        { timeout: 3000 },
      );
    });

    it('says so when a note fails to save after the note is closed', async () => {
      const user = userEvent.setup();
      setNote.mockRejectedValue(new Error('offline'));
      render(wrap(<WatchlistPanel rows={ROWS} watchlistId="wl-1" />));
      await user.click(screen.getByRole('button', { name: 'Add note for AAPL' }));
      const box = await screen.findByRole('textbox', { name: /note for AAPL/i });
      await user.type(box, 'Worth keeping');
      await user.keyboard('{Escape}');

      await waitFor(() => {
        const titles = useToastStore.getState().toasts.map((t) => t.title);
        expect(titles).toContain('Note not saved');
      });
    });

    it('keeps the unsaved text in the box when a failed note is reopened', async () => {
      const user = userEvent.setup();
      setNote.mockRejectedValue(new Error('offline'));
      const rows: WatchlistRow[] = [{ symbol: 'AAPL', note: 'the old one' }];
      render(wrap(<WatchlistPanel rows={rows} watchlistId="wl-1" />));

      await user.click(screen.getByRole('button', { name: 'Edit note for AAPL' }));
      const box = await screen.findByRole('textbox', { name: /note for AAPL/i });
      await user.clear(box);
      await user.type(box, 'the new one');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(setNote).toHaveBeenCalled());

      // Reopening must not discard the edit in favour of the server's copy.
      await user.click(screen.getByRole('button', { name: 'Edit note for AAPL' }));
      expect(await screen.findByRole('textbox', { name: /note for AAPL/i })).toHaveValue(
        'the new one',
      );
    });

    it('remembers the size the user dragged to, not the size they started from', async () => {
      const user = userEvent.setup();
      render(wrap(<WatchlistPanel rows={ROWS} watchlistId="wl-1" />));
      await user.click(screen.getByRole('button', { name: 'Add note for AAPL' }));

      // pointerup lands in the same task as the last pointermove — React has
      // not necessarily re-rendered, so the writer must not read the size off
      // the last render.
      await dragCorner('se', 90, 60);

      await waitFor(() => {
        expect(JSON.parse(window.localStorage.getItem('mt:note-size') ?? '{}')).toEqual({
          width: DEFAULT_NOTE_SIZE.width + 90,
          height: DEFAULT_NOTE_SIZE.height + 60,
        });
      });
    });

    it('grows the note when the bottom-left corner is dragged left, away from the screen edge', async () => {
      const user = userEvent.setup();
      render(wrap(<WatchlistPanel rows={ROWS} watchlistId="wl-1" />));
      await user.click(screen.getByRole('button', { name: 'Add note for AAPL' }));

      // Leftward and downward: the direction with room on a right-hand rail.
      await dragCorner('sw', -90, 40);

      await waitFor(() => {
        expect(JSON.parse(window.localStorage.getItem('mt:note-size') ?? '{}')).toEqual({
          width: DEFAULT_NOTE_SIZE.width + 90,
          height: DEFAULT_NOTE_SIZE.height + 40,
        });
      });
    });

    it('grows the note when the top-right corner is dragged up', async () => {
      const user = userEvent.setup();
      render(wrap(<WatchlistPanel rows={ROWS} watchlistId="wl-1" />));
      await user.click(screen.getByRole('button', { name: 'Add note for AAPL' }));

      await dragCorner('ne', 30, -50);

      await waitFor(() => {
        expect(JSON.parse(window.localStorage.getItem('mt:note-size') ?? '{}')).toEqual({
          width: DEFAULT_NOTE_SIZE.width + 30,
          height: DEFAULT_NOTE_SIZE.height + 50,
        });
      });
    });

    it('offers a grab point at every corner', async () => {
      const user = userEvent.setup();
      render(wrap(<WatchlistPanel rows={ROWS} watchlistId="wl-1" />));
      await user.click(screen.getByRole('button', { name: 'Add note for AAPL' }));
      await screen.findByRole('dialog');
      for (const corner of ['nw', 'ne', 'sw', 'se']) {
        expect(screen.getByTestId(`note-resize-${corner}`)).toBeInTheDocument();
      }
    });

    it('opens at the default size before the user has ever resized', async () => {
      const user = userEvent.setup();
      render(wrap(<WatchlistPanel rows={ROWS} watchlistId="wl-1" />));
      await user.click(screen.getByRole('button', { name: 'Add note for AAPL' }));
      const panel = await screen.findByRole('dialog');
      expect(panel).toHaveStyle({ width: `${DEFAULT_NOTE_SIZE.width}px` });
      expect(panel).toHaveStyle({ height: `${DEFAULT_NOTE_SIZE.height}px` });
    });

    it('reopens at the size stored from a previous resize', async () => {
      window.localStorage.setItem('mt:note-size', JSON.stringify({ width: 420, height: 260 }));
      const user = userEvent.setup();
      render(wrap(<WatchlistPanel rows={ROWS} watchlistId="wl-1" />));
      await user.click(screen.getByRole('button', { name: 'Add note for AAPL' }));
      const panel = await screen.findByRole('dialog');
      expect(panel).toHaveStyle({ width: '420px' });
      expect(panel).toHaveStyle({ height: '260px' });
    });
  });
});
