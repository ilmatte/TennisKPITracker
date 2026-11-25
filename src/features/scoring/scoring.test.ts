import { describe, expect, it } from 'vitest';
import type { Match, ScoredPoint } from '../../types';
import { configuredSetNavigation, deriveGameScore, deriveSetScore, getServer, isSetComplete, nextGameNumber, pointsToGame, resolvePointAction, isActionAvailable, serverOverrideKey, tiebreakServer, tiebreakTarget } from './scoring';
import { freeErrorStats, serveKpi, servicePlusOne } from '../kpi/kpi';
import { POINT_TYPE } from './pointTypes';

const match = (overrides: Partial<Match> = {}): Match => ({
  id: 'm1', family_id: 'f1', match_date: '2026-11-17', player_id: 'alessandro',
  player_first_name_snapshot: 'Alessandro', player_last_name_snapshot: '',
  player_ranking_snapshot: '4.1', player_category_snapshot: 'U16', opponent: 'Andrea',
  number_of_sets: 3, third_set_type: 'normal', super_tiebreak_target: 10, tiebreak_target: 7,
  tiebreak_starts_at_363: true, deuce_single_point: true, first_server: 'player',
  status: 'in-progress', created_at: '2026-11-17', updated_at: '2026-11-17', version: 1, deleted: false,
  ...overrides,
});

const point = (overrides: Partial<ScoredPoint> = {}): ScoredPoint => ({
  id: crypto.randomUUID(), family_id: 'f1', game_id: 'g1', set_number: 1, game_number: 1, point_number: 1,
  won: true, serving: true, second_serve: false, point_type_id: 4, shot_count: 1,
  created_at: '2026-11-17', updated_at: '2026-11-17', version: 1, deleted: false, ...overrides,
});

describe('scoring core', () => {
  it('creates three configured set navigation slots for best-of-three matches', () => {
    expect(configuredSetNavigation(3, [])).toEqual([
      { set_number: 1, exists: false },
      { set_number: 2, exists: false },
      { set_number: 3, exists: false },
    ]);
  });
  it('exposes all five configured slots while reporting only active existing sets', () => {
    expect(configuredSetNavigation(5, [
      { set_number: 1, deleted: false },
      { set_number: 4, deleted: false },
      { set_number: 5, deleted: true },
    ])).toEqual([
      { set_number: 1, exists: true },
      { set_number: 2, exists: false },
      { set_number: 3, exists: false },
      { set_number: 4, exists: true },
      { set_number: 5, exists: false },
    ]);
  });
  it('calculates standard point labels', () => {
    expect(deriveGameScore([point(), point()])).toEqual({ player: 30, opponent: 0 });
  });
  it('closes a standard game after four points', () => {
    const result = pointsToGame([point(),point(),point(),point()], 'player', false);
    expect(result).toEqual({ player: 1, opponent: 0 });
  });
  it('advances to the next game only after the current game is won', () => {
    const firstGame = [1,2,3,4].map(() => point());
    expect(nextGameNumber(firstGame, 1, match())).toBe(2);
    expect(nextGameNumber(firstGame.slice(0, 3), 1, match())).toBe(1);
  });
  it('handles advantages and closes on the next point', () => {
    const points = [1,2,3,4].map(()=>point({won:true})).concat([1,2,3,4].map(()=>point({won:false})));
    expect(deriveGameScore(points)).toEqual({ player: '40', opponent: '40' });
    expect(pointsToGame([...points, point({won:true}), point({won:true})], 'player')).toEqual({ player: 1, opponent: 0 });
  });
  it('maps all direct player actions to an automatic point result', () => {
    expect(resolvePointAction('free_error')).toMatchObject({ won: false, pointTypeId: POINT_TYPE.free_error });
    expect(resolvePointAction('double_fault')).toMatchObject({ won: false, pointTypeId: POINT_TYPE.double_fault, secondServe: true });
    expect(resolvePointAction('lost')).toMatchObject({ won: false });
    expect(resolvePointAction('great_shot')).toMatchObject({ won: true });
    expect(resolvePointAction('won')).toMatchObject({ won: true });
    expect(resolvePointAction('ace')).toMatchObject({ won: true, shotCount: 1 });
  });

  it('assigns the default shot count when my player serves and the rally was not counted', () => {
    expect(resolvePointAction('won', 'player').shotCount).toBe(1);
    expect(resolvePointAction('lost', 'player').shotCount).toBe(3);
    expect(resolvePointAction('double_fault', 'player').shotCount).toBe(1);
    expect(resolvePointAction('free_error', 'player').shotCount).toBe(3);
    expect(resolvePointAction('great_shot', 'player').shotCount).toBe(3);
    expect(resolvePointAction('ace', 'player').shotCount).toBe(1);
  });

  it('assigns the default shot count when the opponent serves and the rally was not counted', () => {
    expect(resolvePointAction('won', 'opponent').shotCount).toBe(2);
    expect(resolvePointAction('lost', 'opponent').shotCount).toBe(1);
    expect(resolvePointAction('free_error', 'opponent').shotCount).toBe(2);
    expect(resolvePointAction('great_shot', 'opponent').shotCount).toBe(2);
  });

  it('disables ace and double fault only when the opponent serves', () => {
    expect(isActionAvailable('ace', 'opponent')).toBe(false);
    expect(isActionAvailable('double_fault', 'opponent')).toBe(false);
    expect(isActionAvailable('won', 'opponent')).toBe(true);
    expect(isActionAvailable('ace', 'player')).toBe(true);
    expect(isActionAvailable('double_fault', 'player')).toBe(true);
  });

  it('disables ace and double fault when more than one shot has been counted', () => {
    expect(isActionAvailable('ace', 'player', 0)).toBe(true);
    expect(isActionAvailable('ace', 'player', 1)).toBe(true);
    expect(isActionAvailable('ace', 'player', 2)).toBe(false);
    expect(isActionAvailable('double_fault', 'player', 2)).toBe(false);
    expect(isActionAvailable('won', 'player', 2)).toBe(true);
    expect(isActionAvailable('free_error', 'opponent', 5)).toBe(true);
  });
  it('uses one-point deuce when enabled: the point after 40-40 wins the game, never advantage', () => {
    const deuce=[1,2,3].map(()=>point()).concat([1,2,3].map(()=>point({won:false})));
    expect(deriveGameScore(deuce, true)).toEqual({ player: '40', opponent: '40' });
    expect(pointsToGame(deuce, 'player', true)).toBeNull();
    expect(pointsToGame([...deuce, point()], 'player', true)).toEqual({ player: 1, opponent: 0 });
    expect(pointsToGame([...deuce, point({ won: false })], 'player', true)).toEqual({ player: 0, opponent: 1 });
  });
  it('still goes to advantage at 40-40 when one-point deuce is disabled', () => {
    const deuce=[1,2,3].map(()=>point()).concat([1,2,3].map(()=>point({won:false})));
    expect(deriveGameScore([...deuce, point()], false)).toEqual({ player: 'AD', opponent: '40' });
    expect(pointsToGame([...deuce, point()], 'player', false)).toBeNull();
    expect(pointsToGame([...deuce, point(), point()], 'player', false)).toEqual({ player: 1, opponent: 0 });
  });
  it('excludes logically deleted points from game scores', () => {
    const points = [point(), point(), point(), point({ deleted: true })];
    expect(deriveGameScore(points)).toEqual({ player: 40, opponent: 0 });
    expect(pointsToGame(points, 'player')).toBeNull();
  });
  it('alternates the first tie-break server and then every two points', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(index => tiebreakServer('player', index)))
      .toEqual(['player', 'opponent', 'opponent', 'player', 'player', 'opponent', 'opponent']);
  });
});

/** Builds the points of a whole game won by `winner` (4 points to love), served by `server`. */
const wonGame = (setNumber: number, gameNumber: number, winner: 'player' | 'opponent', server: 'player' | 'opponent' = winner) =>
  [1, 2, 3, 4].map(n => point({ set_number: setNumber, game_number: gameNumber, point_number: n, won: winner === 'player', serving: server === 'player' }));
/** Games alternating player/opponent (each holding serve, player serving first) until the score is n-n. */
const levelSet = (setNumber: number, n: number) =>
  Array.from({ length: n * 2 }, (_, index) => wonGame(setNumber, index + 1, index % 2 === 0 ? 'player' : 'opponent')).flat();

describe('tie-break', () => {
  const sixGameSets = match({ tiebreak_starts_at_363: false, deuce_single_point: false });

  it('starts a tie-break to 7 only at 6-6 in standard sets', () => {
    const points = levelSet(1, 6);
    expect(tiebreakTarget(points, sixGameSets, 1, 13)).toBe(7);
    expect(tiebreakTarget(points, sixGameSets, 1, 12)).toBeNull();
    expect(tiebreakTarget(levelSet(1, 5), sixGameSets, 1, 11)).toBeNull();
  });

  it('scores the tie-break with numbers and a two-point margin, and closes the set 7-6', () => {
    const tiebreak = (winners: ('player' | 'opponent')[]) => winners.map((winner, index) => point({ set_number: 1, game_number: 13, point_number: index + 1, won: winner === 'player' }));
    const points = [...levelSet(1, 6), ...tiebreak(['player', 'player', 'player', 'player', 'player', 'player', 'opponent'])];
    expect(deriveGameScore(points.filter(p => p.game_number === 13), false, 7)).toEqual({ player: 6, opponent: 1 });
    expect(pointsToGame(points.filter(p => p.game_number === 13), 'player', false, 7)).toBeNull();
    const finished = [...points, point({ set_number: 1, game_number: 13, point_number: 8, won: true })];
    expect(deriveSetScore(finished, 1, sixGameSets)).toEqual({ player: 7, opponent: 6 });
    expect(isSetComplete({ player: 7, opponent: 6 }, sixGameSets, 1)).toBe(true);
    expect(isSetComplete({ player: 6, opponent: 6 }, sixGameSets, 1)).toBe(false);
  });

  it('changes server point by point inside the tie-break', () => {
    const base = levelSet(1, 6); // 12 games played: game 13 is served by the first server
    const servers = [0, 1, 2, 3, 4].map(played => getServer(sixGameSets, [
      ...base,
      ...Array.from({ length: played }, (_, index) => point({ set_number: 1, game_number: 13, point_number: index + 1, won: index % 2 === 0, serving: tiebreakServer('player', index) === 'player' })),
    ], 1, 13));
    expect(servers).toEqual(['player', 'opponent', 'opponent', 'player', 'player']);
  });

  it('continues the service alternation across sets', () => {
    // Set 1 won 6-0: six games, so the first server of set 2 is again the first server of the match.
    const set1 = Array.from({ length: 6 }, (_, index) => wonGame(1, index + 1, 'player', index % 2 === 0 ? 'player' : 'opponent')).flat();
    expect(getServer(sixGameSets, set1, 2, 1)).toBe('player');
    // Set 1 won 6-1: seven games, so set 2 starts with the other player serving.
    const set1b = [...set1, ...wonGame(1, 7, 'opponent', 'player')];
    expect(getServer(sixGameSets, set1b, 2, 1)).toBe('opponent');
  });

  it('restarts the alternation from a corrected server', () => {
    // Game 2 was served again by the player (a mistake on court, recorded as such): game 3 goes to the opponent.
    const points = [...wonGame(1, 1, 'player', 'player'), ...wonGame(1, 2, 'player', 'player')];
    expect(getServer(sixGameSets, points, 1, 3)).toBe('opponent');
    expect(getServer(sixGameSets, points, 1, 4)).toBe('player');
  });

  it('uses a manual correction for a game that has not started yet', () => {
    const points = wonGame(1, 1, 'player', 'player');
    expect(getServer(sixGameSets, points, 1, 2)).toBe('opponent');
    const overrides = { [serverOverrideKey(1, 2)]: 'player' as const };
    expect(getServer(sixGameSets, points, 1, 2, overrides)).toBe('player');
    expect(getServer(sixGameSets, points, 1, 3, overrides)).toBe('opponent');
  });

  it('does not open a new game once the set is over', () => {
    const shortSets = match({ tiebreak_starts_at_363: true, deuce_single_point: false });
    // Set won 4-1: games 1-5 played, there is no game 6.
    const set1 = [...wonGame(1, 1, 'player'), ...wonGame(1, 2, 'opponent'), ...wonGame(1, 3, 'player'), ...wonGame(1, 4, 'player'), ...wonGame(1, 5, 'player')];
    expect(deriveSetScore(set1, 1, shortSets)).toEqual({ player: 4, opponent: 1 });
    expect(nextGameNumber(set1, 1, shortSets)).toBe(5);
    expect(nextGameNumber(set1.filter(p => p.game_number < 5), 1, shortSets)).toBe(5);
    expect(nextGameNumber(set1.filter(p => p.game_number < 4), 1, shortSets)).toBe(4);
  });

  it('plays short sets to 4 games with a tie-break at 3-3', () => {
    const shortSets = match({ tiebreak_starts_at_363: true, deuce_single_point: false });
    expect(tiebreakTarget(levelSet(1, 3), shortSets, 1, 7)).toBe(7);
    expect(isSetComplete({ player: 4, opponent: 2 }, shortSets, 1)).toBe(true);
    expect(isSetComplete({ player: 4, opponent: 3 }, shortSets, 1)).toBe(true);
    expect(isSetComplete({ player: 3, opponent: 3 }, shortSets, 1)).toBe(false);
  });

  it('plays the deciding set as a super tie-break to 10 when configured', () => {
    const superTiebreak = match({ third_set_type: 'super-tiebreak', number_of_sets: 3, tiebreak_starts_at_363: false });
    expect(tiebreakTarget([], superTiebreak, 3, 1)).toBe(10);
    expect(tiebreakTarget([], superTiebreak, 2, 1)).toBeNull();
    expect(isSetComplete({ player: 1, opponent: 0 }, superTiebreak, 3)).toBe(true);
  });
});

describe('KPI core', () => {
  it('counts double faults and valid first serves', () => {
    const points=[point({point_type_id:POINT_TYPE.double_fault}),point({second_serve:false}),point({second_serve:true})];
    const kpi=serveKpi(points,'player');
    expect(kpi.doubleFaults).toBe(1); expect(kpi.firstServeAttempts).toBe(2); expect(kpi.firstServesIn).toBe(1);
  });
  it('classifies free errors by shot count', () => {
    const points=[point({won:false,point_type_id:POINT_TYPE.free_error,shot_count:4}),point({won:false,point_type_id:POINT_TYPE.free_error,shot_count:5}),point({won:false,point_type_id:POINT_TYPE.lose,shot_count:2})];
    expect(freeErrorStats(points)).toEqual({under4:1,rally:1,total:2});
  });
  it('calculates service +1 for wins by points <= 4', () => {
    const points=[point({won:true,point_type_id:POINT_TYPE.win,shot_count:4}),point({won:true,point_type_id:POINT_TYPE.win,shot_count:5}),point({won:false,point_type_id:POINT_TYPE.lose,shot_count:2}),point({won:true,point_type_id:POINT_TYPE.ace,shot_count:1})];
    expect(servicePlusOne(points,'player')).toMatchObject({won:2,total:4,percentage:50});
  });
  it('keeps historical match snapshot independent of profile updates', () => {
    const historical=match({match_date:'2026-11-17',player_ranking_snapshot:'4.1',player_category_snapshot:'U16'});
    const profile={ranking:'3.5',category:'U18'};
    expect(historical.player_ranking_snapshot).toBe('4.1');
    expect(historical.player_category_snapshot).toBe('U16');
    expect(profile).not.toEqual({ranking:historical.player_ranking_snapshot,category:historical.player_category_snapshot});
  });
});
