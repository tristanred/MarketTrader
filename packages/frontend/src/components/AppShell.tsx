import { Outlet } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';

/**
 * Layout for the authenticated app: shared header on top, footer at the
 * bottom, page content (via `<Outlet />`) stretched between so the footer
 * sits at the viewport bottom even when the page is short.
 */
export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppHeader />
      <main className="flex-1">
        <Outlet />
      </main>
      <AppFooter />
    </div>
  );
}
