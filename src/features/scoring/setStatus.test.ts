import { describe, expect, it } from 'vitest';
import type { Game, GameStatusId, Match, Point, ScoredPoint, TennisSet } from '../../types';
import { STATUS, statusLabel } from '../statuses/statuses';
import { deriveGameScore, deriveGameStatusId, deriveSetScore, deriveSetStatusId, isSetComplete, matchWinner, visibleGameNumbers, visibleSetNumbers } from './scoring';
import { withDerivedGameStatuses, withDerivedSetStatuses } from './setStatuses';

const match = (overrides: Partial<Match> = {}): Match => ({
  id: 'm1', family_id: 'f1', match_date: '2026-11-17', player_id: 'p1', player_ranking_snapshot: 7, opponent: 'Andrea',
  number_of_sets: 3, last_set_type: 'normal', super_tiebreak_target: 10, tiebreak_target: 7,
  games_to_win_set: 4, short_set_tiebreak_at: 3, deuce_single_point: true, first_server: 'player',
  status_id: 2, created_at: '2026-11-17', updated_at: '2026-11-17', version: 1, deleted: false,
  ...overrides,
});

const point = (set_number: number, game_number: number, point_number: number, won = true, deleted = false): ScoredPoint => ({
  id: `p-${set_number}-${game_number}-${point_number}`, family_id: 'f1', game_id: `g-${set_number}-${game_number}`,
  set_number, game_number, point_number, won, serving: true, second_serve: false, point_type_id: 4, shot_count: 1,
  created_at: '2026-11-17', updated_at: '2026-11-17', version: 1, deleted,
});

/** `games` games won by my player in the set, 4 points each (a 4-0 set concludes a set to 4 games). */
const wonGames = (set_number: number, games: number): ScoredPoint[] =>
  Array.from({ length: games }, (_, game) => [1, 2, 3, 4].map(n => point(set_number, game + 1, n))).flat();

/** What the live match screen lists: set numbers with the label shown for each. */
function shown(points: ScoredPoint[], format: Match = match()) {
  const over = matchWinner(points, format) !== null;
  return visibleSetNumbers(points, format, over)
    .map(number => [number, statusLabel(deriveSetStatusId(points, number, format), 'set')]);
}

describe('set status and visible sets', () => {
  it('shows "Prossimo" for a set "In programma" without changing the statuses labels', () => {
    expect(statusLabel(STATUS.upcoming, 'set')).toBe('Prossimo');
    expect(statusLabel(STATUS.in_progress, 'set')).toBe('In corso');
    expect(statusLabel(STATUS.completed, 'set')).toBe('Concluso');
    expect(statusLabel(STATUS.upcoming, 'tournament')).toBe('In programma');
  });

  it('1. best of 3 with no game recorded: only set 1, "Prossimo"', () => {
    expect(shown([])).toEqual([[1, 'Prossimo']]);
  });

  it('2. first set started: set 1 "In corso", no later set', () => {
    expect(shown([point(1, 1, 1)])).toEqual([[1, 'In corso']]);
  });

  it('3. first set concluded: set 1 "Concluso" and set 2 "Prossimo"', () => {
    expect(shown(wonGames(1, 4))).toEqual([[1, 'Concluso'], [2, 'Prossimo']]);
  });

  it('4. second set started: set 1 concluded and set 2 "In corso"', () => {
    expect(shown([...wonGames(1, 4), point(2, 1, 1)])).toEqual([[1, 'Concluso'], [2, 'In corso']]);
  });

  it('5. second set concluded and match won: only the two concluded sets', () => {
    expect(shown([...wonGames(1, 4), ...wonGames(2, 4)])).toEqual([[1, 'Concluso'], [2, 'Concluso']]);
  });

  it('6. best of 5: at most the first set not concluded', () => {
    const bestOfFive = match({ number_of_sets: 5 });
    expect(shown([], bestOfFive)).toEqual([[1, 'Prossimo']]);
    expect(shown([...wonGames(1, 4), ...wonGames(2, 4)], bestOfFive))
      .toEqual([[1, 'Concluso'], [2, 'Concluso'], [3, 'Prossimo']]);
    expect(shown([...wonGames(1, 4), ...wonGames(2, 4), point(3, 1, 1)], bestOfFive))
      .toEqual([[1, 'Concluso'], [2, 'Concluso'], [3, 'In corso']]);
  });

  it('7. a set whose points are all deleted goes back to "In programma"', () => {
    expect(deriveSetStatusId([point(1, 1, 1, true, true)], 1, match())).toBe(STATUS.upcoming);
    expect(shown([point(1, 1, 1, true, true)])).toEqual([[1, 'Prossimo']]);
  });

  it('8. the point that wins the set makes it "Concluso"', () => {
    const almost = [...wonGames(1, 3), point(1, 4, 1), point(1, 4, 2), point(1, 4, 3)];
    expect(deriveSetStatusId(almost, 1, match())).toBe(STATUS.in_progress);
    expect(deriveSetStatusId([...almost, point(1, 4, 4)], 1, match())).toBe(STATUS.completed);
  });

  it('a match concluded without a winner lists only the sets actually played', () => {
    expect(visibleSetNumbers([...wonGames(1, 4), point(2, 1, 1)], match(), true)).toEqual([1, 2]);
  });

  it('recomputes the status of stored sets from their points (local upgrade, backups)', () => {
    const base = { family_id: 'f1', match_id: 'm1', player_games: 0, opponent_games: 0, status_id: STATUS.upcoming,
      created_at: '', updated_at: '', version: 1, deleted: false } as const;
    const sets: TennisSet[] = [{ ...base, id: 's1', set_number: 1 }, { ...base, id: 's2', set_number: 2 }, { ...base, id: 's3', set_number: 3 }];
    const games: Game[] = [1, 2, 3, 4].map(n => ({ id: `g-1-${n}`, family_id: 'f1', set_id: 's1', game_number: n,
      player_points: 4, opponent_points: 0, status_id: STATUS.completed as GameStatusId, created_at: '', updated_at: '', version: 1, deleted: false }))
      .concat([{ id: 'g-2-1', family_id: 'f1', set_id: 's2', game_number: 1, player_points: 1, opponent_points: 0, status_id: STATUS.in_progress,
        created_at: '', updated_at: '', version: 1, deleted: false }]);
    const points: Point[] = [...wonGames(1, 4), point(2, 1, 1)].map(({ set_number: _s, game_number: _g, ...stored }) => stored);
    expect(withDerivedSetStatuses([match()], sets, games, points).map(set => set.status_id))
      .toEqual([STATUS.completed, STATUS.in_progress, STATUS.upcoming]);
  });
});

/** A game of `count` points all won (or all lost) by my player. */
const game = (set_number: number, game_number: number, count: number, won = true): ScoredPoint[] =>
  Array.from({ length: count }, (_, index) => point(set_number, game_number, index + 1, won));

/** What the live match screen lists for a set: game numbers with the status label shown for each. */
function shownGames(points: ScoredPoint[], setNumber = 1, format: Match = match()) {
  const closed = isSetComplete(deriveSetScore(points, setNumber, format), format, setNumber) || matchWinner(points, format) !== null;
  return visibleGameNumbers(points, format, setNumber, closed)
    .map(number => [number, statusLabel(deriveGameStatusId(points, format, setNumber, number), 'game')]);
}

describe('game status and visible games', () => {
  it('shows "Prossimo" for a game "In programma"', () => {
    expect(statusLabel(STATUS.upcoming, 'game')).toBe('Prossimo');
    expect(statusLabel(STATUS.in_progress, 'game')).toBe('In corso');
    expect(statusLabel(STATUS.completed, 'game')).toBe('Concluso');
  });

  it('1. set just started: only game 1, "Prossimo"', () => {
    expect(shownGames([])).toEqual([[1, 'Prossimo']]);
  });

  it('2. first point recorded: game 1 "In corso"', () => {
    expect(shownGames([point(1, 1, 1)])).toEqual([[1, 'In corso']]);
  });

  it('3. first game concluded: game 1 "Concluso" and game 2 "Prossimo"', () => {
    expect(shownGames(game(1, 1, 4))).toEqual([[1, 'Concluso'], [2, 'Prossimo']]);
  });

  it('4. second game started: game 1 concluded, game 2 "In corso"', () => {
    expect(shownGames([...game(1, 1, 4), point(1, 2, 1)])).toEqual([[1, 'Concluso'], [2, 'In corso']]);
  });

  it('5. second game concluded: games 1 and 2 concluded, game 3 "Prossimo"', () => {
    expect(shownGames([...game(1, 1, 4), ...game(1, 2, 4, false)]))
      .toEqual([[1, 'Concluso'], [2, 'Concluso'], [3, 'Prossimo']]);
  });

  it('6. set concluded: all and only the games played', () => {
    expect(shownGames(wonGames(1, 4))).toEqual([[1, 'Concluso'], [2, 'Concluso'], [3, 'Concluso'], [4, 'Concluso']]);
  });

  it('7. a game whose points are all deleted goes back to "Prossimo"', () => {
    const deleted = [...game(1, 1, 4), point(1, 2, 1, true, true), point(1, 2, 2, true, true)];
    expect(deriveGameStatusId(deleted, match(), 1, 2)).toBe(STATUS.upcoming);
    expect(shownGames(deleted)).toEqual([[1, 'Concluso'], [2, 'Prossimo']]);
  });

  it('8. a concluded game reopened by a changed point goes back to "In corso"', () => {
    const reopened = [point(1, 1, 1), point(1, 1, 2), point(1, 1, 3), point(1, 1, 4, false)];
    expect(deriveGameStatusId(reopened, match(), 1, 1)).toBe(STATUS.in_progress);
    expect(shownGames(reopened)).toEqual([[1, 'In corso']]);
  });

  it('9a. tie-break at 3-3: in progress until the target with two points of margin, then the set is over', () => {
    // Games 1-6 shared 3-3, game 7 is the tie-break to 7.
    const tied = [1, 2, 3, 4, 5, 6].flatMap(number => game(1, number, 4, number % 2 === 1));
    const tiebreakStarted = [...tied, ...game(1, 7, 4)];
    expect(deriveGameStatusId(tiebreakStarted, match(), 1, 7)).toBe(STATUS.in_progress);
    expect(shownGames(tiebreakStarted).at(-1)).toEqual([7, 'In corso']);
    const tiebreakWon = [...tied, ...game(1, 7, 7)];
    expect(deriveGameStatusId(tiebreakWon, match(), 1, 7)).toBe(STATUS.completed);
    expect(shownGames(tiebreakWon).map(([number]) => number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('9b. deciding super tie-break: a single game to 10', () => {
    const format = match({ last_set_type: 'super-tiebreak' });
    const oneSetAll = [...wonGames(1, 4), ...[1, 2, 3, 4].flatMap(number => game(2, number, 4, false))];
    expect(shownGames(oneSetAll, 3, format)).toEqual([[1, 'Prossimo']]);
    const started = [...oneSetAll, ...game(3, 1, 7)];
    expect(deriveGameStatusId(started, format, 3, 1)).toBe(STATUS.in_progress);
    expect(deriveGameScore(game(3, 1, 7), true, 10)).toEqual({ player: 7, opponent: 0 });
    const won = [...oneSetAll, ...game(3, 1, 10)];
    expect(shownGames(won, 3, format)).toEqual([[1, 'Concluso']]);
  });

  it('recomputes the status of stored games from their points (local upgrade, backups)', () => {
    const set: TennisSet = { id: 's1', family_id: 'f1', match_id: 'm1', set_number: 1, player_games: 1, opponent_games: 0,
      status_id: STATUS.in_progress, created_at: '', updated_at: '', version: 1, deleted: false };
    const games: Game[] = [1, 2, 3].map(number => ({ id: `g-1-${number}`, family_id: 'f1', set_id: 's1', game_number: number,
      player_points: 0, opponent_points: 0, status_id: STATUS.upcoming as GameStatusId, created_at: '', updated_at: '', version: 1, deleted: false }));
    const points: Point[] = [...game(1, 1, 4), point(1, 2, 1)].map(({ set_number: _s, game_number: _g, ...stored }) => stored);
    expect(withDerivedGameStatuses([match()], [set], games, points).map(stored => stored.status_id))
      .toEqual([STATUS.completed, STATUS.in_progress, STATUS.upcoming]);
  });
});
