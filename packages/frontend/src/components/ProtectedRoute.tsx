import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { tryRefresh } from '@/lib/api';

/**
 * Wraps protected pages. If no access token is present, attempts one
 * silent refresh against the HttpOnly cookie. If that fails, redirects
 * to /login while preserving the originally requested path.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const ready = useAuthStore((s) => s.ready);
  const location = useLocation();
  const [checking, setChecking] = useState(!token && !ready);

  useEffect(() => {
    if (token || ready) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    (async () => {
      await tryRefresh();
      if (!cancelled) {
        useAuthStore.getState().setReady(true);
        setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, ready]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>
    );
  }

  if (!token) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
