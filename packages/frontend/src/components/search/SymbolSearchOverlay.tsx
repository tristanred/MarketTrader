import { useNavigate, useParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SymbolSearch } from './SymbolSearch';
import { useCommandKStore } from '@/stores/commandKStore';
import { useGame } from '@/api/games';

/**
 * Modal wrapper around {@link SymbolSearch} opened by cmd+k. Mounted once
 * at AppShell level. When the arena is mounted and has registered an
 * `arenaSelect` setter on the cmd+k store, picking a result writes the
 * symbol into that arena's SelectedSymbolContext and closes — the user
 * stays in the arena. Outside a game (or before the arena registers),
 * falls back to navigating to `/symbols/:symbol`.
 */
export function SymbolSearchOverlay() {
  const open = useCommandKStore((s) => s.open);
  const close = useCommandKStore((s) => s.close);
  const arenaSelect = useCommandKStore((s) => s.arenaSelect);
  const navigate = useNavigate();
  const params = useParams();
  const game = useGame(params.gameId ?? '');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogTitle className="sr-only">Search symbol</DialogTitle>
        <SymbolSearch
          autoFocus
          placeholder="Search symbol..."
          onSelect={(symbol) => {
            close();
            if (arenaSelect) {
              arenaSelect(symbol);
              return;
            }
            navigate(`/symbols/${symbol}`);
          }}
        />
        <div className="mt-2 flex justify-between text-[10px] text-muted">
          <span>Click to select · Esc to close</span>
          {params.gameId && game.data ? <span>In: {game.data.name}</span> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
