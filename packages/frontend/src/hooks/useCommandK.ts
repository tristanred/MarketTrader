import { useEffect } from 'react';
import { useCommandKStore } from '@/stores/commandKStore';

/**
 * Registers global keyboard shortcuts for the cmd+k overlay:
 * - `cmd+k` / `ctrl+k` toggles the overlay open/closed.
 * - `Escape` closes the overlay when it's open.
 *
 * Mounted once at AppShell level. Calls `e.preventDefault()` for both
 * shortcuts so the browser's default behavior (e.g. Chrome's address bar
 * focus on ctrl+k) doesn't fire alongside the overlay open.
 */
export function useCommandK(): void {
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      const isCommandK = e.key === 'k' && (e.metaKey || e.ctrlKey);
      if (isCommandK) {
        e.preventDefault();
        useCommandKStore.getState().toggle();
        return;
      }
      if (e.key === 'Escape' && useCommandKStore.getState().open) {
        e.preventDefault();
        useCommandKStore.getState().close();
      }
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, []);
}
