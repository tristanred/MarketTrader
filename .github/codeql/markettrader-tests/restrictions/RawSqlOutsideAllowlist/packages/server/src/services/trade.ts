import { and, eq, sql } from 'drizzle-orm';
import { createClient } from '@libsql/client';
import postgres from 'postgres';

declare const users: { id: unknown; name: unknown; cash: unknown };
declare const db: {
  select(): { from(t: unknown): { where(c: unknown): { all(): unknown[]; get(): unknown } } };
  update(t: unknown): { set(v: unknown): { where(c: unknown): { run(): unknown } } };
  run(q: unknown): unknown;
  execute(q: unknown): unknown;
  all(q: unknown): unknown[];
  get(q: unknown): unknown;
  transaction(fn: (tx: typeof db) => unknown): unknown;
  $client: { execute(q: string): unknown };
};

export function trade(name: string, id: number) {
  // OK: query builder chains end in .all()/.get()/.run() on the builder, not the db.
  db.select().from(users).where(and(eq(users.id, id))).all();
  db.select().from(users).where(eq(users.name, name)).get();
  db.update(users).set({ cash: sql`${users.cash} - ${id}` }).where(eq(users.id, id)).run();
  // OK: interpolations in sql`` are bound parameters, even when built from strings.
  sql`lower(${users.name}) = ${'%' + name + '%'}`;

  db.run(sql`DELETE FROM users`); // BAD
  db.execute(sql`SELECT 1`); // BAD
  db.all(sql`SELECT * FROM users`); // BAD
  db.get(sql`SELECT * FROM users WHERE id = ${id}`); // BAD
  sql.raw(`SELECT * FROM users WHERE name = '${name}'`); // BAD
  db.$client.execute('SELECT 1'); // BAD x2: $client and the driver call
  db.transaction((tx) => tx.run(sql`UPDATE users SET cash = 0`)); // BAD: tx is the db too
  createClient({ url: 'file:x.db' }).execute('PRAGMA foreign_keys = ON'); // BAD: PRAGMA allowlist is db/index.ts only
  const pg = postgres('postgres://x');
  pg`DELETE FROM users WHERE name = ${name}`; // BAD: postgres-js tagged template
  db.select().from(users).where(sql`${users.id} = ${id}`).all(); // OK: drizzle sql tag
}
