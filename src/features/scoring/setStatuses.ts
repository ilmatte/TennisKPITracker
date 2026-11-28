import type { Game, Match, Point, ScoredPoint, TennisSet } from '../../types';
import { deriveSetStatusId } from './scoring';

/** Sets with status_id recomputed from their points (deriveSetStatusId), for records stored before sets had a status:
 *  the local database upgrade and JSON backups. Deleted sets, games and points are ignored; a set whose match is not
 *  among `matches` is returned unchanged. */
export function withDerivedSetStatuses<T extends TennisSet>(
  matches: readonly Match[],
  sets: readonly T[],
  games: readonly Game[],
  points: readonly Point[],
): T[] {
  const matchById = new Map(matches.map(match => [match.id, match]));
  const setById = new Map(sets.filter(set => !set.deleted).map(set => [set.id, set]));
  const gameById = new Map(games.filter(game => !game.deleted && setById.has(game.set_id)).map(game => [game.id, game]));
  const pointsByMatch = new Map<string, ScoredPoint[]>();
  for (const point of points) {
    const game = point.deleted ? undefined : gameById.get(point.game_id);
    const set = game ? setById.get(game.set_id) : undefined;
    if (!game || !set) continue;
    const list = pointsByMatch.get(set.match_id) ?? [];
    list.push({ ...point, set_number: set.set_number, game_number: game.game_number });
    pointsByMatch.set(set.match_id, list);
  }
  return sets.map(set => {
    const match = matchById.get(set.match_id);
    if (!match) return set;
    return { ...set, status_id: deriveSetStatusId(pointsByMatch.get(set.match_id) ?? [], set.set_number, match) };
  });
}
