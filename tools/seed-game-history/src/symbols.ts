/**
 * Symbol pool for synthetic trade seeding. Large-cap US equities chosen for
 * (a) Yahoo Finance history availability, (b) ticker recognizability in the
 * UI, and (c) sector spread so randomly assembled portfolios look varied.
 */
export const SEED_SYMBOLS = [
  // Mega-cap tech
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA',
  // Finance
  'BRK-B', 'JPM', 'V', 'MA', 'BAC',
  // Healthcare / pharma
  'LLY', 'UNH', 'JNJ', 'ABBV', 'PFE', 'TMO',
  // Consumer / retail
  'WMT', 'COST', 'PG', 'HD', 'KO', 'PEP', 'MCD', 'DIS',
  // Energy
  'XOM', 'CVX',
  // Semis / software
  'AVGO', 'AMD', 'INTC', 'ORCL', 'ADBE', 'CRM', 'NFLX',
  // Telecom
  'T',
] as const;

export type SeedSymbol = (typeof SEED_SYMBOLS)[number];
