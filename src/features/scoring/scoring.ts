import type { Match, Point } from '../../types';

export type Side = 'player' | 'opponent';
export interface GameResult { player: number; opponent: number }

export function labelPoint(value: number, _deuceSinglePoint = false): string {
  if (value >= 3) return value === 3 ? '40' : String(value);
  return ['0', '15', '30', '40'][value] ?? String(value);
}

export function pointsToGame(points: Point[], _side: Side, deuceSinglePoint = false): GameResult | null {
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

export function isPointDeuce(points: Point[]): boolean {
  const player = points.filter(p => p.winner === 'player').length;
  const opponent = points.filter(p => p.winner === 'opponent').length;
  return player >= 3 && opponent >= 3 && player === opponent;
}

export function deriveGameScore(points: Point[], deuceSinglePoint = false): { player: number | string; opponent: number | string } {
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
  if (gameNumber === 1 && setNumber === 1) return match.firstServer;
  const gameIndex = (setNumber - 1) * 99 + gameNumber - 1;
  // Set boundaries use a conservative alternation: 0,2,4... after set number changes.
  return gameIndex % 2 === 0 ? match.firstServer : (match.firstServer === 'player' ? 'opponent' : 'player');
}

export function tiebreakServer(match: Match, _setNumber: number, pointIndex: number): Side {
  const firstInTie = match.firstServer === 'player' ? 'opponent' : 'player';
  if (pointIndex === 0) return firstInTie;
  const block = Math.floor((pointIndex - 1) / 2) % 2;
  return block === 0
    ? (firstInTie === 'player' ? 'opponent' : 'player')
    : firstInTie;
}

export function sortedPoints(points: Point[], setNumber: number, gameNumber: number): Point[] {
  return points.filter(p => !p.deleted && p.setNumber === setNumber && p.gameNumber === gameNumber).sort((a, b) => a.pointNumber - b.pointNumber);
}

export function deriveSetScore(points: Point[], setNumber: number, match: Match): { player: number; opponent: number } {
  let player = 0;
  let opponent = 0;
  const games = [...new Set(points.filter(p => p.setNumber === setNumber).map(p => p.gameNumber))].sort((a, b) => a - b);
  for (const gameNumber of games) {
    const gamePoints = sortedPoints(points, setNumber, gameNumber);
    const result = pointsToGame(gamePoints, 'player', match.deuceSinglePoint);
    if (result?.player) player += 1;
    if (result?.opponent) opponent += 1;
  }
  return { player, opponent };
}
