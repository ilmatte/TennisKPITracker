import type { Point } from '../types';

/** Side that won the point: `won` is true when my player won it. */
export function pointWinnerSide(point: Pick<Point, 'won'>): 'player' | 'opponent' {
  return point.won ? 'player' : 'opponent';
}

/** Converts a legacy point payload (`winner: 'player' | 'opponent'`) to the current shape (`won: boolean`).
 *  Payloads already in the current shape, and non-objects, are returned unchanged. Used by the local database
 *  upgrade, for queued sync operations and for remote changes written before the migration. */
export function migrateLegacyPointPayload<T>(payload: T): T {
  if (!payload || typeof payload !== 'object' || !('winner' in payload)) return payload;
  const { winner, ...rest } = payload as Record<string, unknown>;
  return { ...rest, won: typeof rest.won === 'boolean' ? rest.won : winner === 'player' } as T;
}
