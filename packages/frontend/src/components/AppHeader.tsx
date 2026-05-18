import { NavLink, useNavigate } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuthStore, useIsAdmin } from '@/stores/authStore';
import { useLogout } from '@/api/auth';
import { useTheme } from '@/stores/themeStore';
import { cn } from '@/lib/utils';

/**
 * Topbar row of the global chrome. Brand mark + primary nav on the left,
 * theme toggle + username + sign-out on the right. The Admin nav link
 * appears only for users in the admin group.
 */
export function AppHeader() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = useIsAdmin();
  const logout = useLogout();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();

  const linkClass = (isActive: boolean) =>
    cn(
      'rounded-chip px-2.5 py-1 text-xs',
      isActive ? 'bg-hairline text-text-strong' : 'text-muted hover:text-text',
    );

  return (
    <header className="flex h-11 items-center justify-between border-b border-hairline-strong bg-bg px-4">
      <div className="flex items-center gap-6">
        <NavLink
          to="/"
          end
          className="flex items-center gap-2 text-sm font-bold tracking-[-0.02em] text-text-strong"
        >
          <span className="inline-block h-2 w-2 rounded-[2px] bg-accent" aria-hidden />
          MarketTrader
        </NavLink>
        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={({ isActive }) => linkClass(isActive)}>
            Games
          </NavLink>
          {isAdmin ? (
            <NavLink to="/admin" className={({ isActive }) => linkClass(isActive)}>
              Admin
            </NavLink>
          ) : null}
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        {user ? <span className="hidden text-xs text-muted sm:inline">{user.username}</span> : null}
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
    </header>
  );
}
