import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { queryClient } from '@/lib/queryClient';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { GamesListPage } from '@/pages/GamesListPage';
import { GameDetailPage } from '@/pages/GameDetailPage';
import { SymbolPage } from '@/pages/SymbolPage';
import { ProtectedRoute } from '@/components/ProtectedRoute';
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
            path="/"
            element={
              <ProtectedRoute>
                <GamesListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/games/:gameId"
            element={
              <ProtectedRoute>
                <GameDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/symbols/:symbol"
            element={
              <ProtectedRoute>
                <SymbolPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
