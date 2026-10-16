import { LIMIT_KEYS, type LimitKey } from '@markettrader/shared';

/** Admin-facing names for each limit; `Record` makes a new `LimitKey` a type error here until labelled. */
export const LIMIT_LABELS: Record<LimitKey, string> = {
  apiRequests: 'API requests / min',
  trades: 'Trades / min',
  orderCancels: 'Order cancels / min',
  codeLookups: 'Invite-code lookups / min',
  wsSubscribes: 'Live subscriptions / min',
  gamesCreated: 'Games created / week',
  activeGamesOwned: 'Active games owned',
  gamesJoined: 'Games joined / day',
  activeGamesJoined: 'Active games joined',
  openOrders: 'Open orders per game',
  watchlists: 'Watchlists',
  watchlistItems: 'Items per watchlist',
  wsConnections: 'Live connections',
  registrationsPerIp: 'Registrations per IP / day',
};

/** Label for a denial or override key; per-IP route limits (`ip:<route>`) fall through verbatim. */
export function limitLabel(key: string): string {
  return (LIMIT_KEYS as readonly string[]).includes(key) ? LIMIT_LABELS[key as LimitKey] : key;
}
