import { describe, expect, it } from 'vitest';
import type { Game, Match, Point, ScoredPoint, TennisSet } from '../../types';
import { STATUS, statusLabel } from '../statuses/statuses';
import { deriveSetStatusId, matchWinner, visibleSetNumbers } from './scoring';
import { withDerivedSetStatuses } from './setStatuses';

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
      player_points: 4, opponent_points: 0, created_at: '', updated_at: '', version: 1, deleted: false }))
      .concat([{ id: 'g-2-1', family_id: 'f1', set_id: 's2', game_number: 1, player_points: 1, opponent_points: 0,
        created_at: '', updated_at: '', version: 1, deleted: false }]);
    const points: Point[] = [...wonGames(1, 4), point(2, 1, 1)].map(({ set_number: _s, game_number: _g, ...stored }) => stored);
    expect(withDerivedSetStatuses([match()], sets, games, points).map(set => set.status_id))
      .toEqual([STATUS.completed, STATUS.in_progress, STATUS.upcoming]);
  });
});
