import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';

declare const users: any;
declare const logger: any;

export async function ensureSeededAdmin(db: any): Promise<{ username: string; password: string } | null> {
  const password = randomBytes(24).toString('base64url');
  const passwordHash = await hash(password);
  return db.transaction(async (tx: any) => {
    await tx.insert(users).values({ username: 'admin', passwordHash }); // OK: hash
    return { username: 'admin', password };
  });
}

function announce(credentials: { username: string; password: string }): void {
  console.log(['', `    password: ${credentials.password}`].join('\n')); // OK: the deliberate one-time print
}

export async function bootstrapAdmin(db: any): Promise<void> {
  const credentials = await ensureSeededAdmin(db);
  if (credentials) {
    announce(credentials);
    logger.info({ credentials }, 'seeded'); // BAD: pino ships it over OTLP
  }
}
