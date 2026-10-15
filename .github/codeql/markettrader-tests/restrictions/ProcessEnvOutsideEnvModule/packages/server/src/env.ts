// OK: env.ts is the one module that reads process.env.
function str(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  PORT: str('PORT', '3000'),
  MARKET: process.env.MARKET_STATUS_PROVIDER,
};
