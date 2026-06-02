import { toast } from '@/components/ui/toast';
import { extractApiMessage } from '@/lib/extractApiMessage';

/**
 * Surface an ApiError (or any thrown value) as a destructive toast. Pulls the
 * server-side reason from the JSON body via {@link extractApiMessage} so 409
 * reasons (e.g. "User owns games — transfer ownership first") and 422 trade
 * messages are shown verbatim rather than swallowed.
 */
export function toastApiError(err: unknown, fallbackTitle: string): void {
  toast({
    title: fallbackTitle,
    description: extractApiMessage(err),
    variant: 'destructive',
  });
}
