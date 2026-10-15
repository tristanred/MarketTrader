export const env = {
  JWT_SECRET: process.env.JWT_SECRET ?? '',
  DATABASE_URL: process.env.DATABASE_URL ?? './dev.db',
  ALPACA_API_SECRET_KEY: process.env.ALPACA_API_SECRET_KEY ?? '',
  POSTHOG_KEY: process.env.POSTHOG_KEY ?? '',
};

interface Cfg {
  JWT_SECRET: string;
  DATABASE_URL: string;
}

export function validateProductionEnv(cfg: Cfg = env): void {
  const errors: string[] = [];
  if (cfg.JWT_SECRET.length < 32) {
    // OK: only the length is disclosed
    errors.push(`JWT_SECRET must be at least 32 characters (got ${cfg.JWT_SECRET.length}).`);
  }
  if (!cfg.DATABASE_URL.startsWith('postgres') && cfg.DATABASE_URL.includes(':memory:')) {
    errors.push('DATABASE_URL must be durable'); // OK: predicate-only use
  }
  if (errors.length === 0) {
    errors.push(`bad DATABASE_URL ${cfg.DATABASE_URL}`); // BAD: value collected into the thrown message
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
}

export function leakDirect(): void {
  // BAD: process.env read straight into an Error
  throw new Error(`secret was ${process.env.JWT_SECRET}`);
}
