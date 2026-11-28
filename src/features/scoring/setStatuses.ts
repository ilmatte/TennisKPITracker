import type { Game, Match, Point, ScoredPoint, TennisSet } from '../../types';
import { deriveGameStatusId, deriveSetStatusId } from './scoring';

/** Active points of each match, with the set and game numbers the status rules need. Deleted sets, games and points
 *  are ignored. */
function scoredPointsByMatch(
  sets: readonly TennisSet[],
  games: readonly Game[],
  points: readonly Point[],
): Map<string, ScoredPoint[]> {
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
  return pointsByMatch;
}

/** Sets with status_id recomputed from their points (deriveSetStatusId), for records stored before sets had a status:
 *  the local database upgrade and JSON backups. A set whose match is not among `matches` is returned unchanged. */
export function withDerivedSetStatuses<T extends TennisSet>(
  matches: readonly Match[],
  sets: readonly T[],
  games: readonly Game[],
  points: readonly Point[],
): T[] {
  const matchById = new Map(matches.map(match => [match.id, match]));
  const pointsByMatch = scoredPointsByMatch(sets, games, points);
  return sets.map(set => {
    const match = matchById.get(set.match_id);
    if (!match) return set;
    return { ...set, status_id: deriveSetStatusId(pointsByMatch.get(set.match_id) ?? [], set.set_number, match) };
  });
}

/** Games with status_id recomputed from their points (deriveGameStatusId), for records stored before games had a
 *  status: the local database upgrade and JSON backups. A game whose set or match is unknown is returned unchanged. */
export function withDerivedGameStatuses<T extends Game>(
  matches: readonly Match[],
  sets: readonly TennisSet[],
  games: readonly T[],
  points: readonly Point[],
): T[] {
  const matchById = new Map(matches.map(match => [match.id, match]));
  const setById = new Map(sets.map(set => [set.id, set]));
  const pointsByMatch = scoredPointsByMatch(sets, games, points);
  return games.map(game => {
    const set = setById.get(game.set_id);
    const match = set ? matchById.get(set.match_id) : undefined;
    if (!set || !match) return game;
    return {
      ...game,
      status_id: deriveGameStatusId(pointsByMatch.get(match.id) ?? [], match, set.set_number, game.game_number),
    };
  });
}
