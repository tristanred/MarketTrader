import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/games', label: 'Games' },
  { to: '/admin/portfolios', label: 'Portfolios' },
  { to: '/admin/trades', label: 'Trades' },
  { to: '/admin/system', label: 'System' },
  { to: '/admin/audit', label: 'Audit' },
] as const;

/**
 * Shell for every admin page: persistent sidebar nav on the left, content
 * outlet on the right. Rendered inside `ProtectedRoute` → `AdminRoute` so
 * by the time a user sees this, they are confirmed admin.
 */
export function AdminLayout() {
  return (
    <div className="mx-auto flex max-w-7xl gap-6 p-4 sm:p-6">
      <aside className="w-48 shrink-0">
        <nav className="flex flex-col gap-1">
          <h2 className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Admin
          </h2>
          {NAV_LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <section className="min-w-0 flex-1 space-y-4">
        <Outlet />
      </section>
    </div>
  );
}
