import { toast } from '@/components/ui/toast';
import { extractApiMessage } from '@/lib/extractApiMessage';
import { isLimitExceeded } from '@/lib/limits';

/**
 * Surface an ApiError (or any thrown value) as a destructive toast. Pulls the
 * server-side reason from the JSON body via {@link extractApiMessage} so 409
 * reasons (e.g. "User owns games — transfer ownership first") and 422 trade
 * messages are shown verbatim rather than swallowed. A limit refusal gets its
 * own title, since "Failed to create game" reads as a fault rather than a cap.
 */
export function toastApiError(err: unknown, fallbackTitle: string): void {
  toast({
    title: isLimitExceeded(err) ? 'Limit reached' : fallbackTitle,
    description: extractApiMessage(err),
    variant: 'destructive',
  });
}
