import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveMigrationsRoot } from '../src/db/migrate.js';

describe('resolveMigrationsRoot', () => {
  it('resolves to a directory containing both dialects', () => {
    const root = resolveMigrationsRoot();
    expect(existsSync(path.join(root, 'sqlite'))).toBe(true);
    expect(existsSync(path.join(root, 'pg'))).toBe(true);
  });

  it('points at the journal the drizzle migrator actually reads', () => {
    // Regression: the path was resolved one level too high for the bundled
    // dist layout, so every built deployment threw "Can't find
    // meta/_journal.json" at boot while dev (tsx) worked fine.
    const root = resolveMigrationsRoot();
    expect(existsSync(path.join(root, 'sqlite', 'meta', '_journal.json'))).toBe(true);
    expect(existsSync(path.join(root, 'pg', 'meta', '_journal.json'))).toBe(true);
  });
});
