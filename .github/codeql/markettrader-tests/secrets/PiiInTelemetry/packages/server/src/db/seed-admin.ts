declare const logger: any;

export function announce(credentials: { username: string; password: string }): void {
  console.log(`    username: ${credentials.username}`); // OK: the one-time seeded-admin announcement
  logger.info({ who: credentials.username }, 'seeded'); // BAD: pino ships it
}
