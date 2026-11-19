import type { Match, ScoredPoint } from '../../types';

export type Side = 'player' | 'opponent';
export interface GameResult { player: number; opponent: number }

export function labelPoint(value: number, _deuceSinglePoint = false): string {
  if (value >= 3) return value === 3 ? '40' : String(value);
  return ['0', '15', '30', '40'][value] ?? String(value);
}

export function pointsToGame(points: ScoredPoint[], _side: Side, deuceSinglePoint = false): GameResult | null {
  const player = points.filter(p => p.winner === 'player').length;
  const opponent = points.filter(p => p.winner === 'opponent').length;
  if (deuceSinglePoint && (player >= 5 || opponent >= 5) && (player === 5 || opponent === 5)) {
    if (player > opponent) return { player: 1, opponent: 0 };
    if (opponent > player) return { player: 0, opponent: 1 };
  }
  if (player >= 4 && player - opponent >= 2) return { player: 1, opponent: 0 };
  if (opponent >= 4 && opponent - player >= 2) return { player: 0, opponent: 1 };
  return null;
}

export function isPointDeuce(points: ScoredPoint[]): boolean {
  const player = points.filter(p => p.winner === 'player').length;
  const opponent = points.filter(p => p.winner === 'opponent').length;
  return player >= 3 && opponent >= 3 && player === opponent;
}

export function deriveGameScore(points: ScoredPoint[], deuceSinglePoint = false): { player: number | string; opponent: number | string } {
  const player = points.filter(p => p.winner === 'player').length;
  const opponent = points.filter(p => p.winner === 'opponent').length;
  if (deuceSinglePoint && player >= 4 && opponent >= 4) {
    if (player === opponent) return { player: '40', opponent: '40' };
    return player > opponent ? { player: 'AD', opponent: '40' } : { player: '40', opponent: 'AD' };
  }
  if (player >= 3 && opponent >= 3) {
    if (player === opponent) return { player: '40', opponent: '40' };
    return player > opponent ? { player: 'AD', opponent: '40' } : { player: '40', opponent: 'AD' };
  }
  return { player: player < 3 ? [0, 15, 30, 40][player] : 40, opponent: opponent < 3 ? [0, 15, 30, 40][opponent] : 40 };
}

export function getServer(match: Match, setNumber: number, gameNumber: number): Side {
  if (gameNumber === 1 && setNumber === 1) return match.first_server;
  const gameIndex = (setNumber - 1) * 99 + gameNumber - 1;
  // Set boundaries use a conservative alternation: 0,2,4... after set number changes.
  return gameIndex % 2 === 0 ? match.first_server : (match.first_server === 'player' ? 'opponent' : 'player');
}

export function tiebreakServer(match: Match, _setNumber: number, pointIndex: number): Side {
  const firstInTie = match.first_server === 'player' ? 'opponent' : 'player';
  if (pointIndex === 0) return firstInTie;
  const block = Math.floor((pointIndex - 1) / 2) % 2;
  return block === 0
    ? (firstInTie === 'player' ? 'opponent' : 'player')
    : firstInTie;
}

export function sortedPoints(points: ScoredPoint[], setNumber: number, gameNumber: number): ScoredPoint[] {
  return points.filter(p => !p.deleted && p.set_number === setNumber && p.game_number === gameNumber).sort((a, b) => a.point_number - b.point_number);
}

export function nextGameNumber(points: ScoredPoint[], setNumber: number, match: Match): number {
  const gameNumbers = points
    .filter(point => !point.deleted && point.set_number === setNumber)
    .map(point => point.game_number);
  let gameNumber = 1;
  const lastRecordedGame = Math.max(0, ...gameNumbers);
  while (gameNumber <= lastRecordedGame && pointsToGame(sortedPoints(points, setNumber, gameNumber), 'player', match.deuce_single_point)) {
    gameNumber += 1;
  }
  return gameNumber;
}

export function deriveSetScore(points: ScoredPoint[], setNumber: number, match: Match): { player: number; opponent: number } {
  let player = 0;
  let opponent = 0;
  const games = [...new Set(points.filter(p => p.set_number === setNumber).map(p => p.game_number))].sort((a, b) => a - b);
  for (const gameNumber of games) {
    const gamePoints = sortedPoints(points, setNumber, gameNumber);
    const result = pointsToGame(gamePoints, 'player', match.deuce_single_point);
    if (result?.player) player += 1;
    if (result?.opponent) opponent += 1;
  }
  return { player, opponent };
}
