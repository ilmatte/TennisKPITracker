import type { Point } from '../../types';
import { pointServerSide, pointWinnerSide } from '../../db/pointWinner';
import { isDoubleFault, isFreeError } from '../scoring/pointTypes';

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
  const doubleFaults = served.filter(isDoubleFault).length;
  const validFirst = served.filter(p => !p.second_serve && !isDoubleFault(p)).length;
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

/** My player's free errors (the point type refers to my player), split by rally length. */
export function freeErrorStats(points: Point[]) {
  const errors = points.filter(p => !p.deleted && isFreeError(p));
  return {
    under4: errors.filter(p => p.shot_count <= 4).length,
    rally: errors.filter(p => p.shot_count > 4).length,
    total: errors.length,
  };
}

export function servicePlusOne(points: Point[], side: Side) {
  const served = points.filter(p => !p.deleted && pointServerSide(p) === side);
  // Serve + 1: points won by the server within 4 shots.
  const pattern = served.filter(p => pointWinnerSide(p) === side && p.shot_count <= 4);
  return {
    won: pattern.length,
    total: served.length,
    percentage: served.length ? (pattern.length / served.length) * 100 : 0,
  };
}
