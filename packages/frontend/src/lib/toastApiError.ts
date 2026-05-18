import { ApiError } from '@/lib/api';
import { toast } from '@/components/ui/toast';

/**
 * Surface an ApiError (or any thrown value) as a destructive toast. Pulls
 * the server-side `error` message from the JSON body when available so
 * 409 reasons (e.g. "User owns games — transfer ownership first") are shown
 * verbatim rather than swallowed.
 */
export function toastApiError(err: unknown, fallbackTitle: string): void {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | null;
    toast({
      title: fallbackTitle,
      description: body?.error ?? `${err.status} ${err.message}`,
      variant: 'destructive',
    });
    return;
  }
  toast({
    title: fallbackTitle,
    description: err instanceof Error ? err.message : String(err),
    variant: 'destructive',
  });
}
