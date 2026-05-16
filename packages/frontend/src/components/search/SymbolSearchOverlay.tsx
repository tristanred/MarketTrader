import { useNavigate, useParams } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SymbolSearch } from './SymbolSearch';
import { useCommandKStore } from '@/stores/commandKStore';
import { useGame } from '@/api/games';
import { useMaybeSetSelectedSymbol } from '@/contexts/SelectedSymbolContext';

/**
 * Modal wrapper around {@link SymbolSearch} opened by cmd+k. Mounted once
 * at AppShell level. When inside `/games/:gameId` AND the arena has
 * mounted a SelectedSymbolProvider, picking a result writes the symbol
 * into that context and closes — the user stays in the arena. Outside a
 * game (or before the arena mounts), falls back to navigating to
 * `/symbols/:symbol`.
 */
export function SymbolSearchOverlay() {
  const open = useCommandKStore((s) => s.open);
  const close = useCommandKStore((s) => s.close);
  const navigate = useNavigate();
  const params = useParams();
  const game = useGame(params.gameId ?? '');
  const setSelectedSymbol = useMaybeSetSelectedSymbol();

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
            if (params.gameId && setSelectedSymbol) {
              setSelectedSymbol(symbol);
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
