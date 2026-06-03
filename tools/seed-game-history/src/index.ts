import path from 'node:path';
import { fileURLToPath } from 'node:url';

// DATABASE_URL is loaded from ../../.env (the repo-root .env) via `tsx
// --env-file`. When the path is relative (e.g. `./dev.db`), libsql resolves
// it against process.cwd(). The Fastify server runs with cwd
// `packages/server/`, so `./dev.db` lives at `packages/server/dev.db`. Match
// that by chdir-ing there before importing any server module that opens
// the connection.
const here = path.dirname(fileURLToPath(import.meta.url));
const serverCwd = path.resolve(here, '../../../packages/server');
process.chdir(serverCwd);

const { closeDb } = await import('../../../packages/server/src/db/index.js');
const { selectActiveGame } = await import('./select-game.js');
const { loadHistoricalPrices } = await import('./historical-prices.js');
const { SEED_SYMBOLS } = await import('./symbols.js');
const { seedPlayers, SEED_USER_PASSWORD } = await import('./seed-players.js');
const { seedTradesForPlayer } = await import('./seed-trades.js');
const { seedSnapshotsForGame, clearSnapshotsForGame } = await import('./seed-snapshots.js');
const { randInt } = await import('./rng.js');

function parseArgs(argv: string[]): { gameId?: string; skipSnapshots: boolean; help: boolean } {
  const out: { gameId?: string; skipSnapshots: boolean; help: boolean } = {
    skipSnapshots: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-snapshots') out.skipSnapshots = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--game-id' || a === '--game') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        console.error(`${a} requires a game id (full UUID or unique prefix).`);
        process.exit(1);
      }
      out.gameId = next;
      i++;
    } else if (a?.startsWith('--game-id=')) {
      out.gameId = a.slice('--game-id='.length);
    } else if (a?.startsWith('--game=')) {
      out.gameId = a.slice('--game='.length);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: pnpm seed [options]

Seeds an active game with synthetic players, executed trades, and
backfilled leaderboard snapshots. With no arguments, prompts the operator
to pick a game from the list of active games.

Options:
  --game-id <id>     Pick the game non-interactively. Accepts the full
                     UUID or any unique prefix. Aliased as --game.
  --no-snapshots     Skip backfilling portfolio_snapshots rows.
  -h, --help         Print this message and exit.

Examples:
  pnpm seed
  pnpm seed --game-id a1b2c3d4
  pnpm seed --game=a1b2c3d4 --no-snapshots`);
  process.exit(0);
}

const SKIP_SNAPSHOTS = args.skipSnapshots;

const PLAYER_MIN = 5;
const PLAYER_MAX = 20;
const TRADES_MIN = 10;
const TRADES_MAX = 60;

// Cooperative abort: the seed loop commits per-trade, so a hard kill mid-run
// would leave the libsql connection open (no clean close). On the first
// SIGINT/SIGTERM we set this flag — the player loop finishes its current player,
// skips snapshots, and falls through to closeDb() for a clean shutdown. A
// second signal forces an immediate exit.
let aborting = false;
function requestAbort(signal: string): void {
  if (aborting) {
    console.error(`\nReceived ${signal} again — forcing exit.`);
    process.exit(130);
  }
  aborting = true;
  console.error(
    `\nReceived ${signal} — finishing the current player, then closing the database cleanly. Press Ctrl-C again to force quit.`,
  );
}
process.on('SIGINT', () => requestAbort('SIGINT'));
process.on('SIGTERM', () => requestAbort('SIGTERM'));

async function main(): Promise<void> {
  const game = await selectActiveGame(args.gameId);
  const nowISO = new Date().toISOString();

  const playerCount = randInt(PLAYER_MIN, PLAYER_MAX);
  console.log(`\nSeeding game "${game.name}" with ${playerCount} players …`);

  console.log(`Fetching daily bars for ${SEED_SYMBOLS.length} symbols …`);
  const { priceAt, earliestBarMs } = await loadHistoricalPrices(
    SEED_SYMBOLS,
    game.startDate,
  );
  if (!Number.isFinite(earliestBarMs)) {
    console.error('No historical bars returned from the provider. Aborting.');
    process.exit(1);
  }

  const players = await seedPlayers(game.id, game.startingBalance, playerCount);
  console.log(`Created ${players.length} users + game_players rows.`);

  const effectiveStartISO = new Date(
    Math.max(new Date(game.startDate).getTime(), earliestBarMs),
  ).toISOString();

  let totalInserted = 0;
  let totalSkipped = 0;
  for (const player of players) {
    // Yield to the macrotask queue so a pending SIGINT is actually delivered
    // before we check the flag. libsql resolves file writes synchronously, so
    // the trade loop is otherwise an unbroken microtask chain that starves
    // signal handling — without this, Ctrl-C wouldn't take effect until the
    // whole seed finished.
    await new Promise((resolve) => setImmediate(resolve));
    if (aborting) break;
    const tradeCount = randInt(TRADES_MIN, TRADES_MAX);
    const { inserted, skipped } = await seedTradesForPlayer(
      player,
      game.startingBalance,
      effectiveStartISO,
      nowISO,
      tradeCount,
      { symbols: SEED_SYMBOLS, earliestBarMs, priceAt },
    );
    totalInserted += inserted;
    totalSkipped += skipped;
    console.log(
      `  ${player.username}: ${inserted} trades inserted, ${skipped} skipped`,
    );
  }

  if (aborting) {
    console.log(
      `\nInterrupted — stopped after ${totalInserted} trades. Committed rows are kept; closing the database cleanly. Re-run the seed to finish.`,
    );
    return;
  }

  let snapshotsInserted = 0;
  let snapshotTicks = 0;
  let snapshotsCleared = 0;
  if (!SKIP_SNAPSHOTS) {
    console.log('\nBackfilling leaderboard snapshots …');
    // Wipe any prior snapshot rows for this game so re-running the seed
    // tool on the same game doesn't pile up duplicate ticks.
    snapshotsCleared = await clearSnapshotsForGame(game.id);
    const snapshotResult = await seedSnapshotsForGame(
      game.id,
      game.startingBalance,
      effectiveStartISO,
      nowISO,
      players,
      { symbols: SEED_SYMBOLS, earliestBarMs, priceAt },
    );
    snapshotsInserted = snapshotResult.inserted;
    snapshotTicks = snapshotResult.ticks;
    console.log(`  ${snapshotsInserted} snapshot rows across ${snapshotTicks} ticks (${snapshotsCleared} cleared first).`);
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(`Seeded "${game.name}" (id=${game.id})`);
  console.log(`  Players created: ${players.length}`);
  console.log(`  Trades inserted: ${totalInserted}`);
  console.log(`  Trades skipped:  ${totalSkipped}`);
  if (!SKIP_SNAPSHOTS) {
    console.log(`  Snapshot rows:   ${snapshotsInserted} (${snapshotTicks} ticks)`);
  }
  console.log(`  Login password for all seeded users: ${SEED_USER_PASSWORD}`);
  console.log('──────────────────────────────────────────────');
}

main()
  .then(() => closeDb())
  .then(() => process.exit(aborting ? 130 : 0))
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
