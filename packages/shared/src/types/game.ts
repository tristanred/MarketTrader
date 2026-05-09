export type GameStatus = 'pending' | 'active' | 'ended';

export interface Game {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  startingBalance: number;
  status: GameStatus;
  createdBy: string;
  createdAt: string;
}

export interface CreateGameRequest {
  name: string;
  startDate: string;
  endDate: string;
  startingBalance: number;
}

export interface LeaderboardEntry {
  playerId: string;
  username: string;
  totalValue: number;
  rank: number;
}

export interface GameWithLeaderboard extends Game {
  leaderboard: LeaderboardEntry[];
}
