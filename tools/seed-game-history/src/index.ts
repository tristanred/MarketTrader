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
const { randInt } = await import('./rng.js');

const PLAYER_MIN = 5;
const PLAYER_MAX = 20;
const TRADES_MIN = 10;
const TRADES_MAX = 60;

async function main(): Promise<void> {
  const game = await selectActiveGame();
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

  console.log('\n──────────────────────────────────────────────');
  console.log(`Seeded "${game.name}" (id=${game.id})`);
  console.log(`  Players created: ${players.length}`);
  console.log(`  Trades inserted: ${totalInserted}`);
  console.log(`  Trades skipped:  ${totalSkipped}`);
  console.log(`  Login password for all seeded users: ${SEED_USER_PASSWORD}`);
  console.log('──────────────────────────────────────────────');
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
