import { lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { queryClient } from '@/lib/queryClient';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AppShell } from '@/components/AppShell';
import { AdminRoute } from '@/components/admin/AdminRoute';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Toaster } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/stores/authStore';

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
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
