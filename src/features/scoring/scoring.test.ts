import { describe, expect, it } from 'vitest';
import type { Match, ScoredPoint } from '../../types';
import { deriveGameScore, nextGameNumber, pointsToGame, tiebreakServer } from './scoring';
import { freeErrorStats, serveKpi, servicePlusOne } from '../kpi/kpi';

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
  it('uses one-point deuce when enabled', () => {
    const points=[1,2,3].map(()=>point()).concat([1,2,3].map(()=>point({winner:'opponent'}))).concat([point()]);
    expect(deriveGameScore(points, true)).toEqual({ player: 'AD', opponent: '40' });
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
  it('keeps historical match snapshot independent of profile updates', () => {
    const historical=match({match_date:'2026-11-17',player_ranking_snapshot:'4.1',player_category_snapshot:'U16'});
    const profile={ranking:'3.5',category:'U18'};
    expect(historical.player_ranking_snapshot).toBe('4.1');
    expect(historical.player_category_snapshot).toBe('U16');
    expect(profile).not.toEqual({ranking:historical.player_ranking_snapshot,category:historical.player_category_snapshot});
  });
});
