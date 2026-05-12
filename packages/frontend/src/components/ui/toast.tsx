import { create } from 'zustand';
import { cn } from '@/lib/utils';

export type ToastVariant = 'default' | 'destructive' | 'success';

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastState {
  toasts: ToastItem[];
  push: (t: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    }, 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export function toast(
  args: { title: string; description?: string; variant?: ToastVariant },
): void {
  useToastStore.getState().push({
    title: args.title,
    ...(args.description !== undefined ? { description: args.description } : {}),
    variant: args.variant ?? 'default',
  });
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="fixed top-4 right-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'pointer-events-auto rounded-md border p-4 shadow-md',
            t.variant === 'destructive' &&
              'border-destructive bg-destructive text-destructive-foreground',
            t.variant === 'success' && 'border-success bg-success text-success-foreground',
            t.variant === 'default' && 'border-border bg-card text-card-foreground',
          )}
          onClick={() => dismiss(t.id)}
        >
          <div className="text-sm font-medium">{t.title}</div>
          {t.description && <div className="mt-1 text-xs opacity-90">{t.description}</div>}
        </div>
      ))}
    </div>
  );
}
