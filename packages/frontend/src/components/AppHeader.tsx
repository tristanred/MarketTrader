import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuthStore, useIsAdmin } from '@/stores/authStore';
import { useLogout } from '@/api/auth';
import { useTheme } from '@/stores/themeStore';
import { Moon, Sun } from 'lucide-react';

export function AppHeader() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = useIsAdmin();
  const logout = useLogout();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between p-4">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          MarketTrader
        </Link>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link
              to="/admin"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Admin
            </Link>
          )}
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          {user && <span className="text-sm text-muted-foreground hidden sm:inline">{user.username}</span>}
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
