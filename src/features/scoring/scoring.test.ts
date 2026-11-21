import { describe, expect, it } from 'vitest';
import type { Match, ScoredPoint } from '../../types';
import { configuredSetNavigation, deriveGameScore, nextGameNumber, pointsToGame, resolvePointAction, tiebreakServer } from './scoring';
import { freeErrorStats, pressureStats, scorePressure, serveKpi, servicePlusOne } from '../kpi/kpi';

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
  winner: 'player', server: 'player', second_serve: false, double_fault: false, shot_count: 1,
  free_error: false, attack_error: false, pressure_situation: false,
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
    const points = [1,2,3,4].map(()=>point({winner:'player'})).concat([1,2,3,4].map(()=>point({winner:'opponent'})));
    expect(deriveGameScore(points)).toEqual({ player: '40', opponent: '40' });
    expect(pointsToGame([...points, point({winner:'player'}), point({winner:'player'})], 'player')).toEqual({ player: 1, opponent: 0 });
  });
  it('maps all direct player actions to an automatic point result', () => {
    expect(resolvePointAction('free_error')).toMatchObject({ winner: 'opponent', freeError: true });
    expect(resolvePointAction('double_fault')).toMatchObject({ winner: 'opponent', doubleFault: true, secondServe: true });
    expect(resolvePointAction('lost')).toMatchObject({ winner: 'opponent' });
    expect(resolvePointAction('great_shot')).toMatchObject({ winner: 'player' });
    expect(resolvePointAction('won')).toMatchObject({ winner: 'player' });
    expect(resolvePointAction('ace')).toMatchObject({ winner: 'player', shotCount: 1 });
  });
  it('uses one-point deuce when enabled', () => {
    const points=[1,2,3].map(()=>point()).concat([1,2,3].map(()=>point({winner:'opponent'}))).concat([point()]);
    expect(deriveGameScore(points, true)).toEqual({ player: 'AD', opponent: '40' });
  });
  it('excludes logically deleted points from game scores', () => {
    const points = [point(), point(), point(), point({ deleted: true })];
    expect(deriveGameScore(points)).toEqual({ player: 40, opponent: 0 });
    expect(pointsToGame(points, 'player')).toBeNull();
  });
  it('alternates the first tie-break server and then every two points', () => {
    const m=match();
    expect(tiebreakServer(m,1,0)).toBe('opponent');
    expect(tiebreakServer(m,1,1)).toBe('player');
    expect(tiebreakServer(m,1,2)).toBe('player');
  });
});

describe('KPI core', () => {
  it('counts double faults and valid first serves', () => {
    const points=[point({double_fault:true}),point({second_serve:false}),point({second_serve:true})];
    const kpi=serveKpi(points,'player');
    expect(kpi.doubleFaults).toBe(1); expect(kpi.firstServeAttempts).toBe(2); expect(kpi.firstServesIn).toBe(1);
  });
  it('classifies free errors by shot count', () => {
    const points=[point({free_error:true,error_player:'player',shot_count:4}),point({free_error:true,error_player:'player',shot_count:5})];
    expect(freeErrorStats(points,'player')).toMatchObject({under4:1,rally:1,total:2});
  });
  it('calculates service +1 for wins by points <= 4', () => {
    const points=[point({winner:'player',free_error:true,shot_count:4}),point({winner:'player',free_error:false,shot_count:3})];
    expect(servicePlusOne(points,'player')).toMatchObject({won:1,total:2,percentage:50});
  });
  it('excludes logically deleted points from pressure and point-result KPIs', () => {
    const points = [point({ winner: 'player' }), point({ winner: 'opponent', deleted: true })];
    expect(pressureStats(points, 'player').player30).toBe(1);
    expect(scorePressure(points, 'player')).toEqual({ won: 1, lost: 0, rate: 100 });
  });
  it('keeps historical match snapshot independent of profile updates', () => {
    const historical=match({match_date:'2026-11-17',player_ranking_snapshot:'4.1',player_category_snapshot:'U16'});
    const profile={ranking:'3.5',category:'U18'};
    expect(historical.player_ranking_snapshot).toBe('4.1');
    expect(historical.player_category_snapshot).toBe('U16');
    expect(profile).not.toEqual({ranking:historical.player_ranking_snapshot,category:historical.player_category_snapshot});
  });
});
