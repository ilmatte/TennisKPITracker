import type { Point } from '../../types';
import { pointServerSide, pointWinnerSide } from '../../db/pointWinner';

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
  const served = points.filter(p => !p.deleted && pointServerSide(p) === side);
  const doubleFaults = served.filter(p => p.double_fault).length;
  const validFirst = served.filter(p => !p.second_serve && !p.double_fault).length;
  const firstAttempts = served.filter(p => !p.second_serve).length;
  const secondServes = served.filter(p => p.second_serve).length;
  const pointsWon = served.filter(p => pointWinnerSide(p) === side).length;
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
  const errors = points.filter(p => !p.deleted && p.free_error && p.error_player === side);
  return {
    under4: errors.filter(p => p.shot_count <= 4).length,
    rally: errors.filter(p => p.shot_count > 4).length,
    attack: errors.filter(p => p.attack_error).length,
    pressure: errors.filter(p => p.pressure_situation && p.pressure_error_player === side).length,
    total: errors.length,
  };
}

export function servicePlusOne(points: Point[], side: Side) {
  const served = points.filter(p => !p.deleted && pointServerSide(p) === side);
  const pattern = served.filter(p => pointWinnerSide(p) === side && p.shot_count <= 4 && p.free_error);
  return {
    won: pattern.length,
    total: served.length,
    percentage: served.length ? (pattern.length / served.length) * 100 : 0,
  };
}

export function pressureStats(points: Point[], side: Side) {
  // Pressure outcomes are computed from replayed score context by caller where needed.
  return {
    player30: points.filter(p => !p.deleted && pointWinnerSide(p) === side && p.point_number >= 0).length,
  };
}

export function scorePressure(points: Point[], side: Side) {
  const active = points.filter(point => !point.deleted);
  const won = active.filter(p => pointWinnerSide(p) === side).length;
  const lost = active.filter(p => pointWinnerSide(p) !== side).length;
  return { won, lost, rate: active.length ? (won / active.length) * 100 : 0 };
}
