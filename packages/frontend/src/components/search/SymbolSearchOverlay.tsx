import { useNavigate, useParams } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { SymbolSearch } from './SymbolSearch';
import { useCommandKStore } from '@/stores/commandKStore';

/**
 * Modal wrapper around {@link SymbolSearch} opened by cmd+k. Mounted once
 * at AppShell level. Phase 3a always navigates to `/symbols/:symbol` on
 * select; phase 3c swaps the in-game path to a `SelectedSymbolContext`
 * write so the user stays in the arena.
 */
export function SymbolSearchOverlay() {
  const open = useCommandKStore((s) => s.open);
  const close = useCommandKStore((s) => s.close);
  const navigate = useNavigate();
  const params = useParams();

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent className="max-w-lg">
        <SymbolSearch
          autoFocus
          placeholder="Search symbol..."
          onSelect={(symbol) => {
            close();
            navigate(`/symbols/${symbol}`);
          }}
        />
        <div className="mt-2 flex justify-between text-[10px] text-muted">
          <span>↵ to open · Esc to close</span>
          {params.gameId ? <span>In game: {params.gameId}</span> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
