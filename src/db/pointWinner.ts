import type { Point } from '../types';

/** Side that won the point: `won` is true when my player won it. */
export function pointWinnerSide(point: Pick<Point, 'won'>): 'player' | 'opponent' {
  return point.won ? 'player' : 'opponent';
}

/** Side that served the point: `serving` is true when my player served it. */
export function pointServerSide(point: Pick<Point, 'serving'>): 'player' | 'opponent' {
  return point.serving ? 'player' : 'opponent';
}

/** Converts a legacy point payload to the current shape:
 *  - `winner: 'player' | 'opponent'` becomes `won: boolean` (true when my player won the point);
 *  - `server: 'player' | 'opponent'` becomes `serving: boolean` (true when my player served the point).
 *  Payloads already in the current shape, and non-objects, are returned unchanged. Used by the local database
 *  upgrades, for queued sync operations and for remote changes written before the migrations. */
export function migrateLegacyPointPayload<T>(payload: T): T {
  if (!payload || typeof payload !== 'object' || !('winner' in payload || 'server' in payload)) return payload;
  const { winner, server, ...rest } = payload as Record<string, unknown>;
  const next: Record<string, unknown> = { ...rest };
  if (winner !== undefined && typeof rest.won !== 'boolean') next.won = winner === 'player';
  if (server !== undefined && typeof rest.serving !== 'boolean') next.serving = server === 'player';
  return next as T;
}
