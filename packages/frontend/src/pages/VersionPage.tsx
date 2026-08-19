import { Link } from 'react-router-dom';
import type { VersionInfo } from '@markettrader/shared';
import { buildInfo } from '@/build-info';
import { useServerVersion } from '@/api/version';
import { Button } from '@/components/ui/button';

type BuildComparison = 'pending' | 'unreachable' | 'development' | 'match' | 'drift';

// tsx has no define step, so a dev server reports these sentinels. Without
// this case the page would show permanent drift during local development,
// where the SPA does get a real version from vite.
function isDevBuild(info: VersionInfo): boolean {
  return info.commit === 'dev' || info.version === '0.0.0-dev';
}

/**
 * Classifies the browser's bundle against the server's. Exported for testing.
 *
 * Compares commits rather than versions: shipping is independent of
 * versioning, so two different builds can legitimately share a version
 * number and only the SHA separates them.
 */
export function compareBuilds(
  browser: VersionInfo,
  server: VersionInfo | undefined,
  failed: boolean,
): BuildComparison {
  if (failed) return 'unreachable';
  if (!server) return 'pending';
  if (isDevBuild(browser) || isDevBuild(server)) return 'development';
  return browser.commit === server.commit ? 'match' : 'drift';
}

const VERDICT: Record<BuildComparison, { dot: string; text: string }> = {
  pending: { dot: 'bg-muted', text: 'Checking the server…' },
  unreachable: { dot: 'bg-loss', text: 'The server did not respond.' },
  development: { dot: 'bg-accent', text: 'Development build — versions are not comparable.' },
  match: { dot: 'bg-gain', text: 'Your browser and the server are running the same build.' },
  drift: { dot: 'bg-loss', text: 'Your browser is running an older build.' },
};

function formatBuildTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className="truncate font-mono text-sm text-text-strong" title={title ?? value}>
        {value}
      </dd>
    </div>
  );
}

function BuildBlock({ heading, info }: { heading: string; info: VersionInfo | undefined }) {
  return (
    <section aria-label={heading} className="border-t border-hairline-strong px-5 py-4">
      <h2 className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
        {heading}
      </h2>
      {info ? (
        <dl>
          <Row label="Version" value={info.version} />
          <Row label="Commit" value={info.commit} />
          <Row label="Built" value={formatBuildTime(info.buildTime)} title={info.buildTime} />
        </dl>
      ) : (
        <p className="py-1.5 font-mono text-sm text-muted">Unavailable</p>
      )}
    </section>
  );
}

/**
 * Public diagnostic page at `/version`. Shows the build this browser is
 * running alongside the one the API reports, and names the difference when
 * they disagree — the case behind the "we just deployed a new version" chunk
 * load error.
 */
export function VersionPage() {
  const { data: server, isError } = useServerVersion();
  const status = compareBuilds(buildInfo, server, isError);
  const verdict = VERDICT[status];

  return (
    <main className="safe-area flex min-h-dvh justify-center bg-bg px-4 py-10 sm:py-16">
      <div className="w-full max-w-md">
        <div className="overflow-hidden rounded-panel border border-hairline-strong bg-panel">
          <header className="px-5 pt-5 pb-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Build</p>
            <p className="mt-1 font-mono text-4xl tracking-tight text-text-strong tabular-nums">
              {buildInfo.version}
            </p>
          </header>

          <div
            role="status"
            className="flex items-center gap-3 border-t border-hairline-strong px-5 py-3"
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${verdict.dot}`}
            />
            <p className="flex-1 text-sm text-text">{verdict.text}</p>
            {status === 'drift' && (
              <Button size="sm" onClick={() => window.location.reload()}>
                Reload
              </Button>
            )}
          </div>

          <BuildBlock heading="Browser" info={buildInfo} />
          <BuildBlock heading="Server" info={server} />
        </div>

        <Link
          to="/"
          className="mt-4 inline-block rounded-chip font-mono text-[11px] uppercase tracking-[0.14em] text-muted underline-offset-4 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ← Back to MarketTrader
        </Link>
      </div>
    </main>
  );
}
