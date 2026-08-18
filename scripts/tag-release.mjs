import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// `changeset tag` would emit "@markettrader/server@1.2.0" style tags for a
// multi-package repo, and deploy tooling constrains a ref to the characters git
// allows, which excludes "@". A bare vX.Y.Z tag is what a deploy-by-tag accepts.
const pkg = JSON.parse(readFileSync(new URL('../packages/server/package.json', import.meta.url)));
const tag = `v${pkg.version}`;

const existing = execFileSync('git', ['tag', '--list', tag], { encoding: 'utf8' }).trim();
if (existing) {
  console.error(`tag ${tag} already exists — bump the version before tagging again`);
  process.exit(1);
}

execFileSync('git', ['tag', '-a', tag, '-m', `MarketTrader ${tag}`], { stdio: 'inherit' });
console.log(`tagged ${tag} — push it with: git push --follow-tags`);
