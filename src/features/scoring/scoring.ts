import type { Match, ScoredPoint, TennisSet } from '../../types';

export type Side = 'player' | 'opponent';
export type PointAction = 'free_error' | 'double_fault' | 'lost' | 'great_shot' | 'won' | 'ace';
export interface PointActionResult {
  winner: Side;
  secondServe: boolean;
  doubleFault: boolean;
  shotCount: number;
  freeError: boolean;
}

/** Actions that are not possible when the opponent is serving (only the server can hit an ace or a double fault). */
export const OPPONENT_SERVE_DISABLED: readonly PointAction[] = ['ace', 'double_fault'];

/** Actions that need a rally of at most one shot: not possible once more than one shot has been counted. */
export const SINGLE_SHOT_ACTIONS: readonly PointAction[] = ['ace', 'double_fault'];

/** Why an action cannot be recorded right now, or null when it can. */
export function unavailableReason(action: PointAction, server: Side, shotCount = 0): string | null {
  if (server === 'opponent' && OPPONENT_SERVE_DISABLED.includes(action)) return 'Non disponibile quando serve l’avversario';
  if (shotCount > 1 && SINGLE_SHOT_ACTIONS.includes(action)) return 'Non disponibile con più di un colpo contato';
  return null;
}

export function isActionAvailable(action: PointAction, server: Side, shotCount = 0): boolean {
  return unavailableReason(action, server, shotCount) === null;
}

/** Shots assigned to a point when the rally was not counted (shot counter left at 0), by who is serving. */
export const DEFAULT_SHOT_COUNT: Record<Side, Partial<Record<PointAction, number>>> = {
  player: { won: 1, lost: 3, double_fault: 1, free_error: 3, great_shot: 3, ace: 1 },
  opponent: { won: 2, lost: 1, free_error: 2, great_shot: 2 },
};

export function resolvePointAction(action: PointAction, server: Side = 'player'): PointActionResult {
  const playerWon = action === 'great_shot' || action === 'won' || action === 'ace';
  return {
    winner: playerWon ? 'player' : 'opponent',
    secondServe: action === 'double_fault',
    doubleFault: action === 'double_fault',
    shotCount: DEFAULT_SHOT_COUNT[server][action] ?? 1,
    freeError: action === 'free_error',
  };
}

export interface GameResult { player: number; opponent: number }

export function configuredSetNavigation(
  numberOfSets: Match['number_of_sets'],
  sets: Pick<TennisSet, 'set_number' | 'deleted'>[],
): { set_number: number; exists: boolean }[] {
  const activeSetNumbers = new Set(sets.filter(set => !set.deleted).map(set => set.set_number));
  return Array.from({ length: numberOfSets }, (_, index) => {
    const set_number = index + 1;
    return { set_number, exists: activeSetNumbers.has(set_number) };
  });
}

function activePoints(points: ScoredPoint[]): ScoredPoint[] {
  return points.filter(point => !point.deleted);
}

export function labelPoint(value: number, _deuceSinglePoint = false): string {
  if (value >= 3) return value === 3 ? '40' : String(value);
  return ['0', '15', '30', '40'][value] ?? String(value);
}

/** Result of a game, or null while it is still being played.
 *  With `tiebreakTarget` the game is a tie-break: first to the target with a two-point margin. */
export function pointsToGame(points: ScoredPoint[], _side: Side, deuceSinglePoint = false, tiebreakTarget: number | null = null): GameResult | null {
  const livePoints = activePoints(points);
  const player = livePoints.filter(p => p.winner === 'player').length;
  const opponent = livePoints.filter(p => p.winner === 'opponent').length;
  if (tiebreakTarget) {
    if (player >= tiebreakTarget && player - opponent >= 2) return { player: 1, opponent: 0 };
    if (opponent >= tiebreakTarget && opponent - player >= 2) return { player: 0, opponent: 1 };
    return null;
  }
  if (deuceSinglePoint && (player >= 5 || opponent >= 5) && (player === 5 || opponent === 5)) {
    if (player > opponent) return { player: 1, opponent: 0 };
    if (opponent > player) return { player: 0, opponent: 1 };
  }
  if (player >= 4 && player - opponent >= 2) return { player: 1, opponent: 0 };
  if (opponent >= 4 && opponent - player >= 2) return { player: 0, opponent: 1 };
  return null;
}

export function isPointDeuce(points: ScoredPoint[]): boolean {
  const livePoints = activePoints(points);
  const player = livePoints.filter(p => p.winner === 'player').length;
  const opponent = livePoints.filter(p => p.winner === 'opponent').length;
  return player >= 3 && opponent >= 3 && player === opponent;
}

export function deriveGameScore(points: ScoredPoint[], deuceSinglePoint = false, tiebreakTarget: number | null = null): { player: number | string; opponent: number | string } {
  const livePoints = activePoints(points);
  const player = livePoints.filter(p => p.winner === 'player').length;
  const opponent = livePoints.filter(p => p.winner === 'opponent').length;
  if (tiebreakTarget) return { player, opponent };
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

const otherSide = (side: Side): Side => side === 'player' ? 'opponent' : 'player';

/** Set format. "Tie-break da 3-3" (tiebreak_starts_at_363) means short sets: first to 4 games, tie-break at 3-3. */
export function setFormat(match: Match): { gamesToWin: number; tiebreakAt: number } {
  return match.tiebreak_starts_at_363 ? { gamesToWin: 4, tiebreakAt: 3 } : { gamesToWin: 6, tiebreakAt: 6 };
}

/** The deciding set is played as a single super tie-break when the match is configured that way. */
export function isSuperTiebreakSet(match: Match, setNumber: number): boolean {
  return match.third_set_type === 'super-tiebreak' && setNumber === match.number_of_sets;
}

/** Games won by each side in a set, counting only games before `beforeGame` (all games when omitted). */
function countGames(points: ScoredPoint[], setNumber: number, match: Match, beforeGame = Infinity): { player: number; opponent: number } {
  let player = 0;
  let opponent = 0;
  const games = [...new Set(points.filter(p => !p.deleted && p.set_number === setNumber).map(p => p.game_number))]
    .filter(gameNumber => gameNumber < beforeGame)
    .sort((a, b) => a - b);
  for (const gameNumber of games) {
    const result = pointsToGame(sortedPoints(points, setNumber, gameNumber), 'player', match.deuce_single_point, tiebreakTarget(points, match, setNumber, gameNumber));
    if (result?.player) player += 1;
    if (result?.opponent) opponent += 1;
  }
  return { player, opponent };
}

/** Points needed to win the game if it is a tie-break (7 by default, 10 for a super tie-break), otherwise null. */
export function tiebreakTarget(points: ScoredPoint[], match: Match, setNumber: number, gameNumber: number): number | null {
  if (isSuperTiebreakSet(match, setNumber)) return gameNumber === 1 ? (match.super_tiebreak_target || 10) : null;
  const { tiebreakAt } = setFormat(match);
  if (gameNumber !== tiebreakAt * 2 + 1) return null;
  // Only the game after tiebreakAt-tiebreakAt can be a tie-break, so every game before it is a normal game.
  const score = countGames(points, setNumber, match, gameNumber);
  return score.player === tiebreakAt && score.opponent === tiebreakAt ? (match.tiebreak_target || 7) : null;
}

export function isSetComplete(score: { player: number; opponent: number }, match: Match, setNumber: number): boolean {
  const high = Math.max(score.player, score.opponent);
  const low = Math.min(score.player, score.opponent);
  if (isSuperTiebreakSet(match, setNumber)) return high >= 1;
  const { gamesToWin, tiebreakAt } = setFormat(match);
  return (high >= gamesToWin && high - low >= 2) || (high === tiebreakAt + 1 && low === tiebreakAt);
}

/** Tie-break service order: the first server serves one point, then each player serves two points in turn. */
export function tiebreakServer(firstServer: Side, pointIndex: number): Side {
  return Math.floor((pointIndex + 1) / 2) % 2 === 0 ? firstServer : otherSide(firstServer);
}

/** Manual server corrections for games that have no points yet, keyed by `serverOverrideKey`. */
export type ServerOverrides = Record<string, Side>;
export const serverOverrideKey = (setNumber: number, gameNumber: number) => `${setNumber}:${gameNumber}`;

/** Who served (or serves first, for a tie-break) a game, if it is known: the server stored on the game's first
 *  recorded point, or a manual correction for a game not started yet. */
function recordedGameServer(points: ScoredPoint[], setNumber: number, gameNumber: number, overrides: ServerOverrides): Side | null {
  const first = sortedPoints(points, setNumber, gameNumber)[0];
  return first?.server ?? overrides[serverOverrideKey(setNumber, gameNumber)] ?? null;
}

/** Who serves a game (the first point, for a tie-break).
 *  Service alternates every game across the whole match (a tie-break counts as one game, so whoever served first in
 *  the tie-break receives in the first game of the next set). A game whose server is recorded or corrected restarts
 *  the alternation from there, so a correction carries on to the following games. */
export function getGameServer(match: Match, points: ScoredPoint[], setNumber: number, gameNumber: number, overrides: ServerOverrides = {}): Side {
  let expected: Side = match.first_server;
  for (let set = 1; set <= setNumber; set += 1) {
    const score = set < setNumber ? countGames(points, set, match) : null;
    const gamesInSet = score ? score.player + score.opponent : gameNumber - 1;
    for (let game = 1; game <= gamesInSet; game += 1) {
      expected = otherSide(recordedGameServer(points, set, game, overrides) ?? expected);
    }
  }
  return recordedGameServer(points, setNumber, gameNumber, overrides) ?? expected;
}

/** Who serves the next point of a game: the game's server, or point by point inside a tie-break. */
export function getServer(match: Match, points: ScoredPoint[], setNumber: number, gameNumber: number, overrides: ServerOverrides = {}): Side {
  const gameServer = getGameServer(match, points, setNumber, gameNumber, overrides);
  if (!tiebreakTarget(points, match, setNumber, gameNumber)) return gameServer;
  return tiebreakServer(gameServer, sortedPoints(points, setNumber, gameNumber).length);
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
  while (gameNumber <= lastRecordedGame && pointsToGame(sortedPoints(points, setNumber, gameNumber), 'player', match.deuce_single_point, tiebreakTarget(points, match, setNumber, gameNumber))) {
    gameNumber += 1;
  }
  return gameNumber;
}

export function deriveSetScore(points: ScoredPoint[], setNumber: number, match: Match): { player: number; opponent: number } {
  return countGames(points, setNumber, match);
}
