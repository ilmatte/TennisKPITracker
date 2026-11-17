export type PlayerId = string;

export interface Player {
  id: PlayerId;
  firstName: string;
  lastName: string;
  birthDate?: string;
  category: string;
  ranking: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  deleted?: boolean;
}

export interface Match {
  id: string;
  matchDate: string;
  playerId: PlayerId;
  playerFirstNameSnapshot: string;
  playerLastNameSnapshot: string;
  playerRankingSnapshot: string;
  playerCategorySnapshot: string;
  opponent: string;
  opponentRanking?: string;
  opponentCategory?: string;
  tournament?: string;
  tournamentMatchNumber?: number;
  numberOfSets: 3 | 5;
  thirdSetType: 'normal' | 'super-tiebreak';
  superTiebreakTarget: number;
  tiebreakTarget: number;
  tiebreakStartsAt363: boolean;
  deuceSinglePoint: boolean;
  firstServer: 'player' | 'opponent';
  status: 'in-progress' | 'completed';
  createdAt: string;
  updatedAt: string;
  version: number;
  deleted?: boolean;
}

export type ErrorCategory = 'forehand' | 'backhand' | 'serve' | 'volley' | 'net' | 'other';

export interface Point {
  id: string;
  matchId: string;
  setNumber: number;
  gameNumber: number;
  pointNumber: number;
  winner: 'player' | 'opponent';
  server: 'player' | 'opponent';
  secondServe: boolean;
  doubleFault: boolean;
  shotCount: number;
  freeError: boolean;
  errorPlayer?: 'player' | 'opponent';
  errorCategory?: ErrorCategory;
  attackError: boolean;
  pressureSituation: boolean;
  pressureErrorPlayer?: 'player' | 'opponent';
  createdAt: string;
  updatedAt: string;
  version: number;
  deleted?: boolean;
}

export interface SyncOperation {
  id: string;
  entityType: 'players' | 'matches' | 'points';
  entityId: string;
  operation: 'upsert' | 'delete';
  payload: unknown;
  createdAt: string;
  attempts: number;
  lastError?: string;
}
