import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { queryClient } from '@/lib/queryClient';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { GamesListPage } from '@/pages/GamesListPage';
import { GameDetailPage } from '@/pages/GameDetailPage';
import { SymbolPage } from '@/pages/SymbolPage';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AppShell } from '@/components/AppShell';
import { AdminRoute } from '@/components/admin/AdminRoute';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { AdminUsersPage } from '@/pages/admin/AdminUsersPage';
import { AdminUserDetailPage } from '@/pages/admin/AdminUserDetailPage';
import { AdminGamesPage } from '@/pages/admin/AdminGamesPage';
import { AdminGameDetailPage } from '@/pages/admin/AdminGameDetailPage';
import { AdminPortfoliosPage } from '@/pages/admin/AdminPortfoliosPage';
import { AdminTradesPage } from '@/pages/admin/AdminTradesPage';
import { AdminSystemPage } from '@/pages/admin/AdminSystemPage';
import { AdminAuditPage } from '@/pages/admin/AdminAuditPage';
import { Toaster } from '@/components/ui/toast';
import { useAuthStore } from '@/stores/authStore';

function PublicOnly({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  return token ? <Navigate to="/" replace /> : <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
