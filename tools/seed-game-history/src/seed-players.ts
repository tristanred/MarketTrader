import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { faker } from '@faker-js/faker';
import { db, schema } from '../../../packages/server/src/db/index.js';

/** Throwaway password assigned to every seeded user. Argon2 needs min 8 chars. */
export const SEED_USER_PASSWORD = 'seedseed';

export interface SeededPlayer {
  /** `gamePlayers.id` — the value passed to executeTrade. */
  gamePlayerId: string;
  userId: string;
  username: string;
}

/**
 * Lower-cases the input and replaces any non-alphanumeric run with a single
 * underscore so the result is safe to use as a `users.username` value and as
 * a URL slug. Trims leading/trailing underscores.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Creates `playerCount` synthetic `users` rows and enrolls each in `gameId`.
 * Every user shares the same argon2-hashed password ({@link SEED_USER_PASSWORD})
 * — the hash is computed once and reused for all inserts to keep the run fast.
 *
 * Usernames take the form `<firstname>_<lastname>_<rand4>` (Faker-generated
 * human names with a hex suffix to guarantee uniqueness across runs).
 */
export async function seedPlayers(
  gameId: string,
  startingBalance: number,
  playerCount: number,
): Promise<SeededPlayer[]> {
  const passwordHash = await hash(SEED_USER_PASSWORD);
  const out: SeededPlayer[] = [];

  for (let i = 0; i < playerCount; i++) {
    const first = slugify(faker.person.firstName());
    const last = slugify(faker.person.lastName());
    const rand4 = randomBytes(2).toString('hex');
    const username = `${first}_${last}_${rand4}`;

    const result = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({ username, passwordHash })
        .returning({ id: schema.users.id, username: schema.users.username });
      if (!user) throw new Error(`Failed to insert user ${username}`);

      const [player] = await tx
        .insert(schema.gamePlayers)
        .values({ gameId, userId: user.id, cashBalance: startingBalance })
        .returning({ id: schema.gamePlayers.id });
      if (!player) throw new Error(`Failed to enroll user ${username}`);

      return { gamePlayerId: player.id, userId: user.id, username: user.username };
    });

    out.push(result);
  }
  return out;
}
