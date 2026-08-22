import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { isUniqueConstraintError } from '../../src/db/errors.js';

// drizzle-orm builds DrizzleQueryError with `Failed query: ${query}\nparams: ${params}`,
// so every bound parameter value is inside the wrapper's own message. Anything a
// user can put in a username or a game name therefore lands in that string.
const POISONED_PARAM = 'x unique constraint x';

/** Shapes a driver error the way postgres-js does: SQLSTATE on `code`. */
function postgresError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code, name: 'PostgresError' });
}

const client = createClient({ url: ':memory:' });
const db = drizzle(client);
beforeAll(async () => {
  await db.run(sql`CREATE TABLE f26_unique (username text not null unique)`);
  await db.run(sql`CREATE TABLE f26_pk (id text primary key, note text)`);
});
afterAll(() => {
  client.close();
});

describe('isUniqueConstraintError — real driver errors', () => {
  it('detects a libsql UNIQUE violation raised through drizzle', async () => {
    await db.run(sql`INSERT INTO f26_unique (username) VALUES (${POISONED_PARAM})`);

    const err = await db
      .run(sql`INSERT INTO f26_unique (username) VALUES (${POISONED_PARAM})`)
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(err).toBeInstanceOf(Error);
    expect(isUniqueConstraintError(err)).toBe(true);
  });

  it('detects a libsql PRIMARY KEY violation raised through drizzle', async () => {
    await db.run(sql`INSERT INTO f26_pk (id, note) VALUES ('a', 'first')`);

    const err = await db.run(sql`INSERT INTO f26_pk (id, note) VALUES ('a', 'second')`).then(
      () => null,
      (e: unknown) => e,
    );

    expect(isUniqueConstraintError(err)).toBe(true);
  });

  it('does not fire for an unrelated libsql failure', async () => {
    const err = await db.run(sql`INSERT INTO f26_unique (nope) VALUES (${POISONED_PARAM})`).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect(isUniqueConstraintError(err)).toBe(false);
  });
});

describe('isUniqueConstraintError — postgres-shaped errors', () => {
  it('detects SQLSTATE 23505 through the drizzle wrapper', () => {
    const err = new DrizzleQueryError(
      'insert into "users" ("username") values ($1)',
      ['someone'],
      postgresError(
        '23505',
        'duplicate key value violates unique constraint "users_username_unique"',
      ),
    );

    expect(isUniqueConstraintError(err)).toBe(true);
  });

  it('does not fire for a different SQLSTATE carrying a poisoned parameter', () => {
    const err = new DrizzleQueryError(
      'insert into "game_players" ("game_id") values ($1)',
      [POISONED_PARAM],
      postgresError('23503', 'insert or update on table "game_players" violates foreign key'),
    );

    expect(isUniqueConstraintError(err)).toBe(false);
  });
});

describe('isUniqueConstraintError — message text is not a signal', () => {
  it('ignores a poisoned parameter echoed into the drizzle wrapper message', () => {
    const err = new DrizzleQueryError(
      'insert into "users" ("username") values (?)',
      [POISONED_PARAM],
      Object.assign(new Error('SQLITE_ERROR: no such table: users'), {
        code: 'SQLITE_ERROR',
        name: 'LibsqlError',
      }),
    );

    expect(err.message).toContain('unique constraint');
    expect(isUniqueConstraintError(err)).toBe(false);
  });

  it('ignores an error whose message says unique constraint but carries no code', () => {
    expect(isUniqueConstraintError(new Error('UNIQUE constraint failed: users.username'))).toBe(
      false,
    );
  });

  it('returns false for non-errors', () => {
    expect(isUniqueConstraintError(undefined)).toBe(false);
    expect(isUniqueConstraintError('unique constraint')).toBe(false);
  });
});
