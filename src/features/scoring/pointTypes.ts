import type { Point, PointType } from '../../types';

/** Point type ids. They mirror the rows of the `point_types` table (Supabase migration 005_point_types.sql and the
 *  Dexie `point_types` store): never renumber them. */
export const POINT_TYPE = {
  double_fault: 1,
  free_error: 2,
  lose: 3,
  win: 4,
  ace: 5,
  great_shot: 6,
} as const;

export type PointTypeCode = keyof typeof POINT_TYPE;
export type PointTypeId = typeof POINT_TYPE[PointTypeCode];

/** Rows of the `point_types` lookup table. */
export const POINT_TYPES: readonly PointType[] = [
  { id: POINT_TYPE.double_fault, code: 'double_fault', label: 'Doppio fallo' },
  { id: POINT_TYPE.free_error, code: 'free_error', label: 'Errore gratuito' },
  { id: POINT_TYPE.lose, code: 'lose', label: 'Perso' },
  { id: POINT_TYPE.win, code: 'win', label: 'Vinto' },
  { id: POINT_TYPE.ace, code: 'ace', label: 'Ace' },
  { id: POINT_TYPE.great_shot, code: 'great_shot', label: 'Bel colpo' },
];

/** Point types won by my player (all types refer to my player, like points.won). */
const WON_POINT_TYPES: readonly number[] = [POINT_TYPE.win, POINT_TYPE.ace, POINT_TYPE.great_shot];
export const isWinningPointType = (pointTypeId: number) => WON_POINT_TYPES.includes(pointTypeId);

export const isDoubleFault = (point: Pick<Point, 'point_type_id'>) => point.point_type_id === POINT_TYPE.double_fault;
export const isFreeError = (point: Pick<Point, 'point_type_id'>) => point.point_type_id === POINT_TYPE.free_error;

/** Point type of a point stored with the legacy flags (before points.point_type_id existed). Aces and great shots
 *  were not recorded separately, so they become ordinary won points; a free error on a won point was the opponent's
 *  error, so it becomes an ordinary won point too. Same result as 005_point_types.sql followed by 006. */
export function legacyPointTypeId(point: { double_fault?: unknown; free_error?: unknown; won?: unknown }): PointTypeId {
  if (point.double_fault === true) return POINT_TYPE.double_fault;
  if (point.won === true) return POINT_TYPE.win;
  return point.free_error === true ? POINT_TYPE.free_error : POINT_TYPE.lose;
}
