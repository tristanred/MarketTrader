import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useIsAdmin, useAuthStore } from '@/stores/authStore';
import { toast } from '@/components/ui/toast';

/**
 * Gates admin-only routes. Assumes the parent `ProtectedRoute` already
 * guarantees an authenticated session — this only checks group membership.
 * Non-admins are redirected to `/` with a destructive toast.
 */
export function AdminRoute({ children }: { children: React.ReactNode }) {
  const isAdmin = useIsAdmin();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (user && !isAdmin) {
      toast({ title: 'Admin access required', variant: 'destructive' });
    }
  }, [user, isAdmin]);

  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
