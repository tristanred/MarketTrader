import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../../packages/server/src/db/index.js';
import { recomputeGameStatus } from '../../../packages/server/src/services/game-status.js';

/** Shape consumed by the seeder downstream. */
export interface SelectedGame {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  startingBalance: number;
}

/**
 * Lists active games on stdout and prompts the operator to pick one by number.
 * Filters by stored status, then re-verifies each candidate with
 * `recomputeGameStatus` so a game whose `status` column is stale (e.g. should
 * have flipped to `ended`) is not offered.
 *
 * Exits the process with code 1 if no active games exist or the operator
 * supplies an invalid selection.
 */
export async function selectActiveGame(): Promise<SelectedGame> {
  const rows = await db
    .select({
      id: schema.games.id,
      name: schema.games.name,
      startDate: schema.games.startDate,
      endDate: schema.games.endDate,
      startingBalance: schema.games.startingBalance,
      status: schema.games.status,
    })
    .from(schema.games)
    .where(eq(schema.games.status, 'active'));

  const verified: SelectedGame[] = [];
  for (const row of rows) {
    const status = await recomputeGameStatus(db, row);
    if (status === 'active') {
      verified.push({
        id: row.id,
        name: row.name,
        startDate: row.startDate,
        endDate: row.endDate,
        startingBalance: Number(row.startingBalance),
      });
    }
  }

  if (verified.length === 0) {
    console.error('No active games found. Create one and try again.');
    process.exit(1);
  }

  console.log('Active games:');
  verified.forEach((g, i) => {
    const shortId = g.id.slice(0, 8);
    console.log(`  ${i + 1}) ${g.name.padEnd(28)} ${g.startDate} → ${g.endDate}   (id=${shortId}…)`);
  });

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`Pick a game [1-${verified.length}]: `);
  rl.close();

  const idx = Number.parseInt(answer.trim(), 10) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= verified.length) {
    console.error(`Invalid selection: ${answer}`);
    process.exit(1);
  }
  return verified[idx]!;
}
