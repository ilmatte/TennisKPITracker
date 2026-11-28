import type { GameStatusId, Match, ScoredPoint, SetStatusId, TennisSet } from '../../types';
import { POINT_TYPE, type PointTypeId } from './pointTypes';
import { STATUS } from '../statuses/statuses';

export type Side = 'player' | 'opponent';
export type PointAction = 'free_error' | 'double_fault' | 'lost' | 'great_shot' | 'won' | 'ace';
export interface PointActionResult {
  /** true when my player wins the point. */
  won: boolean;
  secondServe: boolean;
  /** points.point_type_id for the action. */
  pointTypeId: PointTypeId;
  shotCount: number;
}

/** Point type recorded for each outcome button. */
export const ACTION_POINT_TYPE: Record<PointAction, PointTypeId> = {
  double_fault: POINT_TYPE.double_fault,
  free_error: POINT_TYPE.free_error,
  lost: POINT_TYPE.lose,
  won: POINT_TYPE.win,
  ace: POINT_TYPE.ace,
  great_shot: POINT_TYPE.great_shot,
};

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
    won: playerWon,
    secondServe: action === 'double_fault',
    pointTypeId: ACTION_POINT_TYPE[action],
    shotCount: DEFAULT_SHOT_COUNT[server][action] ?? 1,
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
  const player = livePoints.filter(p => p.won).length;
  const opponent = livePoints.filter(p => !p.won).length;
  if (tiebreakTarget) {
    if (player >= tiebreakTarget && player - opponent >= 2) return { player: 1, opponent: 0 };
    if (opponent >= tiebreakTarget && opponent - player >= 2) return { player: 0, opponent: 1 };
    return null;
  }
  if (deuceSinglePoint) {
    // "Punto secco al 40-40": no advantages. The first to 4 points wins; at 40-40 the next point decides the game.
    if (player >= 4 && player > opponent) return { player: 1, opponent: 0 };
    if (opponent >= 4 && opponent > player) return { player: 0, opponent: 1 };
    return null;
  }
  if (player >= 4 && player - opponent >= 2) return { player: 1, opponent: 0 };
  if (opponent >= 4 && opponent - player >= 2) return { player: 0, opponent: 1 };
  return null;
}

export function isPointDeuce(points: ScoredPoint[]): boolean {
  const livePoints = activePoints(points);
  const player = livePoints.filter(p => p.won).length;
  const opponent = livePoints.filter(p => !p.won).length;
  return player >= 3 && opponent >= 3 && player === opponent;
}

export function deriveGameScore(points: ScoredPoint[], deuceSinglePoint = false, tiebreakTarget: number | null = null): { player: number | string; opponent: number | string } {
  const livePoints = activePoints(points);
  const player = livePoints.filter(p => p.won).length;
  const opponent = livePoints.filter(p => !p.won).length;
  if (tiebreakTarget) return { player, opponent };
  if (deuceSinglePoint) {
    // No advantages: the score never goes beyond 40-40.
    const label = (value: number) => [0, 15, 30, 40][Math.min(value, 3)];
    if (player >= 3 && opponent >= 3) return { player: '40', opponent: '40' };
    return { player: label(player), opponent: label(opponent) };
  }
  if (player >= 3 && opponent >= 3) {
    if (player === opponent) return { player: '40', opponent: '40' };
    return player > opponent ? { player: 'AD', opponent: '40' } : { player: '40', opponent: 'AD' };
  }
  return { player: player < 3 ? [0, 15, 30, 40][player] : 40, opponent: opponent < 3 ? [0, 15, 30, 40][opponent] : 40 };
}

const otherSide = (side: Side): Side => side === 'player' ? 'opponent' : 'player';

/** Games to win a set and the score at which its tie-break starts. */
export function setFormat(match: Match): { gamesToWin: number; tiebreakAt: number } {
  const gamesToWin = match.games_to_win_set;
  const tiebreakAt = gamesToWin === 4 ? (match.short_set_tiebreak_at ?? 3) : 6;
  return { gamesToWin, tiebreakAt };
}

/** The deciding set is played as a single super tie-break when the match is configured that way. */
export function isSuperTiebreakSet(match: Match, setNumber: number): boolean {
  // In best-of-three, the deciding set is replaced by a super tie-break.
  // In best-of-five, the fifth set remains a normal set and only its closing
  // tie-break is replaced by a super tie-break.
  return match.number_of_sets === 3 && match.last_set_type === 'super-tiebreak' && setNumber === 3;
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
  if (score.player !== tiebreakAt || score.opponent !== tiebreakAt) return null;
  return match.number_of_sets === 5 && match.last_set_type === 'super-tiebreak' && setNumber === 5
    ? (match.super_tiebreak_target || 10)
    : (match.tiebreak_target || 7);
}

export function isSetComplete(score: { player: number; opponent: number }, match: Match, setNumber: number): boolean {
  const high = Math.max(score.player, score.opponent);
  const low = Math.min(score.player, score.opponent);
  if (isSuperTiebreakSet(match, setNumber)) return high >= 1;
  const { gamesToWin, tiebreakAt } = setFormat(match);
  return (high >= gamesToWin && high - low >= 2) || (high === tiebreakAt + 1 && low === tiebreakAt);
}

/** Status of a set (statuses id): Concluso once its score meets the match's rules, In corso once it has at least one
 *  point, otherwise In programma. The single rule used to store sets.status_id and to show it. */
export function setStatusId(
  score: { player: number; opponent: number },
  started: boolean,
  match: Match,
  setNumber: number,
): SetStatusId {
  if (isSetComplete(score, match, setNumber)) return STATUS.completed;
  return started ? STATUS.in_progress : STATUS.upcoming;
}

/** Status of a set computed from the match's points (deleted points ignored). */
export function deriveSetStatusId(points: ScoredPoint[], setNumber: number, match: Match): SetStatusId {
  const started = points.some(point => !point.deleted && point.set_number === setNumber);
  return setStatusId(countGames(points, setNumber, match), started, match, setNumber);
}

/** Sets shown in the live match screen, in order: the sets already played (concluded or started) and, while the match
 *  is not over, only the first set not yet concluded (the one being played or the next one). Set 1 when nothing has
 *  been played. Future sets of the format are never listed in advance. */
export function visibleSetNumbers(points: ScoredPoint[], match: Match, matchOver: boolean): number[] {
  const statuses = Array.from({ length: match.number_of_sets }, (_, index) =>
    ({ number: index + 1, status: deriveSetStatusId(points, index + 1, match) }));
  const visible = new Set(statuses.filter(set => set.status !== STATUS.upcoming).map(set => set.number));
  if (!matchOver) {
    const next = statuses.find(set => set.status !== STATUS.completed);
    if (next) visible.add(next.number);
  }
  if (!visible.size) visible.add(1);
  return [...visible].sort((a, b) => a - b);
}

/** Status of a game (statuses id) from its points: Concluso once pointsToGame assigns it (a tie-break or super
 *  tie-break with its target), In corso once it has at least one point, otherwise In programma. The single rule used
 *  to store games.status_id and to show it. */
export function gameStatusId(gamePoints: ScoredPoint[], deuceSinglePoint: boolean, target: number | null): GameStatusId {
  const live = activePoints(gamePoints);
  if (pointsToGame(live, 'player', deuceSinglePoint, target)) return STATUS.completed;
  return live.length ? STATUS.in_progress : STATUS.upcoming;
}

/** Status of a game of the match computed from the match's points (deleted points ignored). */
export function deriveGameStatusId(points: ScoredPoint[], match: Match, setNumber: number, gameNumber: number): GameStatusId {
  return gameStatusId(sortedPoints(points, setNumber, gameNumber), match.deuce_single_point,
    tiebreakTarget(points, match, setNumber, gameNumber));
}

/** Games shown for a set in the live match screen, in order: the games already played (concluded or started) and,
 *  while the set is open, only the first game not yet concluded (the one being played or the next one). Game 1 when
 *  nothing has been played. `closed`: the set is concluded or the match is over, so no next game is listed. */
export function visibleGameNumbers(points: ScoredPoint[], match: Match, setNumber: number, closed: boolean): number[] {
  const played = [...new Set(points.filter(point => !point.deleted && point.set_number === setNumber)
    .map(point => point.game_number))];
  const visible = new Set(played);
  if (!closed) visible.add(nextGameNumber(points, setNumber, match));
  if (!visible.size) visible.add(1);
  return [...visible].sort((a, b) => a - b);
}

/** Winner of the match once a player has won the sets needed (2 in best of 3, 3 in best of 5), otherwise null.
 *  A deciding super tie-break counts as a set won 1-0. */
export function matchWinner(points: ScoredPoint[], match: Match): Side | null {
  const setsToWin = Math.floor(match.number_of_sets / 2) + 1;
  let player = 0;
  let opponent = 0;
  for (let setNumber = 1; setNumber <= match.number_of_sets; setNumber += 1) {
    const score = countGames(points, setNumber, match);
    if (!isSetComplete(score, match, setNumber)) continue;
    if (score.player > score.opponent) player += 1;
    else if (score.opponent > score.player) opponent += 1;
  }
  if (player >= setsToWin) return 'player';
  if (opponent >= setsToWin) return 'opponent';
  return null;
}

/** Tie-break service order: the first server serves one point, then each player serves two points in turn. */
export function tiebreakServer(firstServer: Side, pointIndex: number): Side {
  return Math.floor((pointIndex + 1) / 2) % 2 === 0 ? firstServer : otherSide(firstServer);
}

/** Manual server corrections for games that have no points yet, keyed by `serverOverrideKey`. */
export type ServerOverrides = Record<string, Side>;
export const serverOverrideKey = (setNumber: number, gameNumber: number) => `${setNumber}:${gameNumber}`;

/** The first point of each game persists its server. For tie-breaks this is also the
 *  persisted first tie-break server, which determines who opens the following set. */
function recordedGameServer(points: ScoredPoint[], setNumber: number, gameNumber: number, overrides: ServerOverrides): Side | null {
  const first = sortedPoints(points, setNumber, gameNumber)[0];
  if (first) return first.serving ? 'player' : 'opponent';
  return overrides[serverOverrideKey(setNumber, gameNumber)] ?? null;
}

function nextSetFirstServerAfterTiebreak(tiebreakFirstServer: Side): Side {
  // The player who opened the tie-break receives; the other player serves first.
  return otherSide(tiebreakFirstServer);
}

/** Determine service from the match's persisted first server and recorded point servers.
 *  Completed ordinary games advance service once. A completed tie-break has its own
 *  point-by-point order; for the next set, its first server receives and the other
 *  player serves first. Recorded or corrected game servers anchor later alternation. */
export function getGameServer(match: Match, points: ScoredPoint[], setNumber: number, gameNumber: number, overrides: ServerOverrides = {}): Side {
  let expected: Side = match.first_server;
  for (let set = 1; set <= setNumber; set += 1) {
    const score = set < setNumber ? countGames(points, set, match) : null;
    const gamesInSet = score ? score.player + score.opponent : gameNumber - 1;
    for (let game = 1; game <= gamesInSet; game += 1) {
      const gameServer = recordedGameServer(points, set, game, overrides) ?? expected;
      const isFinalTieBreak = game === gamesInSet && tiebreakTarget(points, match, set, game) !== null;
      // The tie-break is not an ordinary game transition: its first server receives
      // the opening game of the next set, so the other player serves that game.
      expected = isFinalTieBreak ? nextSetFirstServerAfterTiebreak(gameServer) : otherSide(gameServer);
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

/** The game being played in a set: the first game not yet won. Once the set is over there is no next game,
 *  so the last game of the set is returned (use `isSetComplete` to tell the two cases apart). */
export function nextGameNumber(points: ScoredPoint[], setNumber: number, match: Match): number {
  const gameNumbers = points
    .filter(point => !point.deleted && point.set_number === setNumber)
    .map(point => point.game_number);
  let gameNumber = 1;
  const lastRecordedGame = Math.max(0, ...gameNumbers);
  while (gameNumber <= lastRecordedGame && pointsToGame(sortedPoints(points, setNumber, gameNumber), 'player', match.deuce_single_point, tiebreakTarget(points, match, setNumber, gameNumber))) {
    if (isSetComplete(countGames(points, setNumber, match, gameNumber + 1), match, setNumber)) return gameNumber;
    gameNumber += 1;
  }
  return gameNumber;
}

export function deriveSetScore(points: ScoredPoint[], setNumber: number, match: Match): { player: number; opponent: number } {
  return countGames(points, setNumber, match);
}
