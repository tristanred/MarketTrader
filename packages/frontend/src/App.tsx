import { Component, lazy, Suspense, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { queryClient } from '@/lib/queryClient';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AppShell } from '@/components/AppShell';
import { AdminRoute } from '@/components/admin/AdminRoute';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Toaster } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/authStore';

// Catches errors from lazy-loaded route chunks (e.g. failed network during
// a deploy) so the user sees a recoverable reload prompt instead of a blank
// page. Suspense alone handles loading, not errors.
class RouteErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  override state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  override render() {
    if (this.state.hasError) {
      return (
        <main className="mx-auto max-w-md p-6 text-center space-y-3">
          <h1 className="text-lg font-semibold">Couldn't load this page.</h1>
          <p className="text-sm text-muted-foreground">
            The page failed to load — this usually means we just deployed a new version.
          </p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </main>
      );
    }
    return this.props.children;
  }
}

const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import('@/pages/RegisterPage').then((m) => ({ default: m.RegisterPage })),
);
const GamesListPage = lazy(() =>
  import('@/pages/GamesListPage').then((m) => ({ default: m.GamesListPage })),
);
const GameDetailPage = lazy(() =>
  import('@/pages/GameDetailPage').then((m) => ({ default: m.GameDetailPage })),
);
const GameLeaderboardPage = lazy(() =>
  import('@/pages/GameLeaderboardPage').then((m) => ({ default: m.GameLeaderboardPage })),
);
const AchievementsPage = lazy(() =>
  import('@/pages/AchievementsPage').then((m) => ({ default: m.AchievementsPage })),
);
const SymbolPage = lazy(() => import('@/pages/SymbolPage').then((m) => ({ default: m.SymbolPage })));

const AdminUsersPage = lazy(() =>
  import('@/pages/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })),
);
const AdminUserDetailPage = lazy(() =>
  import('@/pages/admin/AdminUserDetailPage').then((m) => ({ default: m.AdminUserDetailPage })),
);
const AdminGamesPage = lazy(() =>
  import('@/pages/admin/AdminGamesPage').then((m) => ({ default: m.AdminGamesPage })),
);
const AdminGameDetailPage = lazy(() =>
  import('@/pages/admin/AdminGameDetailPage').then((m) => ({ default: m.AdminGameDetailPage })),
);
const AdminPortfoliosPage = lazy(() =>
  import('@/pages/admin/AdminPortfoliosPage').then((m) => ({ default: m.AdminPortfoliosPage })),
);
const AdminTradesPage = lazy(() =>
  import('@/pages/admin/AdminTradesPage').then((m) => ({ default: m.AdminTradesPage })),
);
const AdminSystemPage = lazy(() =>
  import('@/pages/admin/AdminSystemPage').then((m) => ({ default: m.AdminSystemPage })),
);
const AdminAuditPage = lazy(() =>
  import('@/pages/admin/AdminAuditPage').then((m) => ({ default: m.AdminAuditPage })),
);

function RouteLoader() {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <Skeleton className="h-7 w-48" />
    </main>
  );
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  return token ? <Navigate to="/" replace /> : <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RouteErrorBoundary>
          <Suspense fallback={<RouteLoader />}>
            <Routes>
            <Route
              path="/login"
              element={
                <PublicOnly>
                  <LoginPage />
                </PublicOnly>
              }
            />
            <Route
              path="/register"
              element={
                <PublicOnly>
                  <RegisterPage />
                </PublicOnly>
              }
            />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<GamesListPage />} />
              <Route path="/games/:gameId" element={<GameDetailPage />} />
              <Route path="/games/:gameId/leaderboard" element={<GameLeaderboardPage />} />
              <Route path="/games/:gameId/achievements" element={<AchievementsPage />} />
              <Route path="/symbols/:symbol" element={<SymbolPage />} />
              <Route
                path="/admin"
                element={
                  <AdminRoute>
                    <AdminLayout />
                  </AdminRoute>
                }
              >
                <Route index element={<Navigate to="/admin/users" replace />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="users/:userId" element={<AdminUserDetailPage />} />
                <Route path="games" element={<AdminGamesPage />} />
                <Route path="games/:gameId" element={<AdminGameDetailPage />} />
                <Route path="portfolios" element={<AdminPortfoliosPage />} />
                <Route path="trades" element={<AdminTradesPage />} />
                <Route path="system" element={<AdminSystemPage />} />
                <Route path="audit" element={<AdminAuditPage />} />
              </Route>
            </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
