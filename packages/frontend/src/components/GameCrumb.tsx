import { Link } from 'react-router-dom';

export interface GameCrumbProps {
  gameId: string;
  gameName: string;
  /** Name of the current page, shown last and unlinked. */
  current: string;
}

/** `Games / <game> / <page>` breadcrumb for pages under a game. */
export function GameCrumb({ gameId, gameName, current }: GameCrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted"
    >
      <Link to="/" className="hover:text-text">
        Games
      </Link>
      <span className="text-hairline-strong">/</span>
      <Link to={`/games/${gameId}`} className="hover:text-text">
        {gameName}
      </Link>
      <span className="text-hairline-strong">/</span>
      <span className="text-text">{current}</span>
    </nav>
  );
}
