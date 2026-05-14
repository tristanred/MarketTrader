import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { FOOTER_LINKS } from '@/lib/footerConfig';

export function AppFooter() {
  return (
    <footer className="border-t bg-muted/30 text-muted-foreground text-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
        {FOOTER_LINKS.map((link) =>
          link.kind === 'external' ? (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline underline-offset-4"
            >
              {link.label}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : (
            <Link
              key={link.label}
              to={link.to}
              className="hover:text-foreground hover:underline underline-offset-4"
            >
              {link.label}
            </Link>
          ),
        )}
      </div>
    </footer>
  );
}
