import type { Point } from '../../types';

export type Side = 'player' | 'opponent';

export interface ServeKpi {
  doubleFaults: number;
  firstServesIn: number;
  firstServeAttempts: number;
  firstServePercentage: number;
  secondServes: number;
  pointsWon: number;
  pointsLost: number;
}

export function serveKpi(points: Point[], side: Side): ServeKpi {
  const served = points.filter(p => !p.deleted && p.server === side);
  const doubleFaults = served.filter(p => p.doubleFault).length;
  const validFirst = served.filter(p => !p.secondServe && !p.doubleFault).length;
  const firstAttempts = served.filter(p => !p.secondServe).length;
  const secondServes = served.filter(p => p.secondServe).length;
  const pointsWon = served.filter(p => p.winner === side).length;
  return {
    doubleFaults,
    firstServesIn: validFirst,
    firstServeAttempts: firstAttempts,
    firstServePercentage: firstAttempts ? (validFirst / firstAttempts) * 100 : 0,
    secondServes,
    pointsWon,
    pointsLost: served.length - pointsWon,
  };
}

export function freeErrorStats(points: Point[], side: Side) {
  const errors = points.filter(p => !p.deleted && p.freeError && p.errorPlayer === side);
  return {
    under4: errors.filter(p => p.shotCount <= 4).length,
    rally: errors.filter(p => p.shotCount > 4).length,
    attack: errors.filter(p => p.attackError).length,
    pressure: errors.filter(p => p.pressureSituation && p.pressureErrorPlayer === side).length,
    total: errors.length,
  };
}

export function servicePlusOne(points: Point[], side: Side) {
  const served = points.filter(p => !p.deleted && p.server === side);
  const pattern = served.filter(p => p.winner === side && p.shotCount <= 4 && p.freeError);
  return {
    won: pattern.length,
    total: served.length,
    percentage: served.length ? (pattern.length / served.length) * 100 : 0,
  };
}

export function pressureStats(points: Point[], side: Side) {
  // Pressure outcomes are computed from replayed score context by caller where needed.
  return {
    player30: points.filter(p => p.winner === side && p.pointNumber >= 0).length,
  };
}

export function scorePressure(points: Point[], side: Side) {
  const won = points.filter(p => p.winner === side).length;
  const lost = points.filter(p => p.winner !== side).length;
  return { won, lost, rate: points.length ? (won / points.length) * 100 : 0 };
}
