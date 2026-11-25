import { legacyPointTypeId, POINT_TYPE } from '../features/scoring/pointTypes';
import type { Point } from '../types';

/** Side that won the point: `won` is true when my player won it. */
export function pointWinnerSide(point: Pick<Point, 'won'>): 'player' | 'opponent' {
  return point.won ? 'player' : 'opponent';
}

/** Side that served the point: `serving` is true when my player served it. */
export function pointServerSide(point: Pick<Point, 'serving'>): 'player' | 'opponent' {
  return point.serving ? 'player' : 'opponent';
}

/** Point fields removed by the schema migrations. */
export const LEGACY_POINT_FIELDS = [
  'winner', 'server', 'double_fault', 'free_error', 'attack_error', 'pressure_situation',
  'error_player', 'error_category', 'pressure_error_player',
] as const;

/** Converts a legacy point payload to the current shape:
 *  - `winner: 'player' | 'opponent'` becomes `won: boolean` (true when my player won the point);
 *  - `server: 'player' | 'opponent'` becomes `serving: boolean` (true when my player served the point);
 *  - `double_fault` / `free_error` become `point_type_id`; `attack_error`, `pressure_situation`, `error_player`,
 *    `error_category` and `pressure_error_player` are dropped;
 *  - a free error on a won point (the opponent's error, recorded before the point type referred only to my player)
 *    becomes an ordinary won point.
 *  Payloads already in the current shape, and non-objects, are returned unchanged. Used when restoring version 2
 *  JSON backups, which were written with the older point fields. */
export function migrateLegacyPointPayload<T>(payload: T): T {
  if (!payload || typeof payload !== 'object') return payload;
  const legacy = payload as Record<string, unknown>;
  const opponentFreeError = legacy.point_type_id === POINT_TYPE.free_error && legacy.won === true;
  if (!LEGACY_POINT_FIELDS.some(field => field in legacy) && !opponentFreeError) return payload;
  const next: Record<string, unknown> = { ...legacy };
  for (const field of LEGACY_POINT_FIELDS) delete next[field];
  if ('winner' in legacy && typeof legacy.won !== 'boolean') next.won = legacy.winner === 'player';
  if ('server' in legacy && typeof legacy.serving !== 'boolean') next.serving = legacy.server === 'player';
  if (('double_fault' in legacy || 'free_error' in legacy) && typeof legacy.point_type_id !== 'number') {
    next.point_type_id = legacyPointTypeId({ ...legacy, won: next.won });
  }
  if (next.point_type_id === POINT_TYPE.free_error && next.won === true) next.point_type_id = POINT_TYPE.win;
  return next as T;
}
