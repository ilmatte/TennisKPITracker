import { describe, expect, it } from 'vitest';
import type { Match, Point } from '../../types';
import { deriveGameScore, pointsToGame, tiebreakServer } from './scoring';
import { freeErrorStats, serveKpi, servicePlusOne } from '../kpi/kpi';

const match = (overrides: Partial<Match> = {}): Match => ({
  id: 'm1', matchDate: '2026-11-17', playerId: 'alessandro',
  playerFirstNameSnapshot: 'Alessandro', playerLastNameSnapshot: '',
  playerRankingSnapshot: '4.1', playerCategorySnapshot: 'U16', opponent: 'Andrea',
  numberOfSets: 3, thirdSetType: 'normal', superTiebreakTarget: 10, tiebreakTarget: 10,
  tiebreakStartsAt363: true, deuceSinglePoint: true, firstServer: 'player',
  status: 'in-progress', createdAt: '2026-11-17', updatedAt: '2026-11-17', version: 1,
  ...overrides,
});

const point = (overrides: Partial<Point> = {}): Point => ({
  id: crypto.randomUUID(), matchId: 'm1', setNumber: 1, gameNumber: 1, pointNumber: 1,
  winner: 'player', server: 'player', secondServe: false, doubleFault: false, shotCount: 1,
  freeError: false, attackError: false, pressureSituation: false,
  createdAt: '2026-11-17', updatedAt: '2026-11-17', version: 1, ...overrides,
});

describe('scoring core', () => {
  it('calculates standard point labels', () => {
    expect(deriveGameScore([point(), point()])).toEqual({ player: 30, opponent: 0 });
  });
  it('closes a standard game after four points', () => {
    const result = pointsToGame([point(),point(),point(),point()], 'player', false);
    expect(result).toEqual({ player: 1, opponent: 0 });
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
    const points=[point({doubleFault:true}),point({secondServe:false}),point({secondServe:true})];
    const kpi=serveKpi(points,'player');
    expect(kpi.doubleFaults).toBe(1); expect(kpi.firstServeAttempts).toBe(2); expect(kpi.firstServesIn).toBe(1);
  });
  it('classifies free errors by shot count', () => {
    const points=[point({freeError:true,errorPlayer:'player',shotCount:4}),point({freeError:true,errorPlayer:'player',shotCount:5})];
    expect(freeErrorStats(points,'player')).toMatchObject({under4:1,rally:1,total:2});
  });
  it('calculates service +1 for wins by points <= 4', () => {
    const points=[point({winner:'player',freeError:true,shotCount:4}),point({winner:'player',freeError:false,shotCount:3})];
    expect(servicePlusOne(points,'player')).toMatchObject({won:1,total:2,percentage:50});
  });
  it('keeps historical match snapshot independent of profile updates', () => {
    const historical=match({matchDate:'2026-11-17',playerRankingSnapshot:'4.1',playerCategorySnapshot:'U16'});
    const profile={ranking:'3.5',category:'U18'};
    expect(historical.playerRankingSnapshot).toBe('4.1');
    expect(historical.playerCategorySnapshot).toBe('U16');
    expect(profile).not.toEqual({ranking:historical.playerRankingSnapshot,category:historical.playerCategorySnapshot});
  });
});
