import { migrateLegacyStatus } from '../statuses/statuses';
import { legacyFitpRankingId } from '../players/fitpRankings';

/** Brings the columns of a match record written by an older app version (local database, backup, server row, queued
 *  payload) to the current shape. Idempotent; anything that is not an object is returned unchanged.
 *  - third_set_type is renamed last_set_type (it is the deciding set: the third or the fifth);
 *  - tiebreak_starts_at_363 is removed, after giving games_to_win_set its value when missing (true → 4, false → 6);
 *  - the text player_ranking_snapshot (a ranking code) becomes the fitp_rankings id, null when it matches none;
 *  - the free-text opponent_ranking becomes opponent_ranking_snapshot (fitp_rankings id, null when it matches none). */
export function migrateLegacyMatchColumns<T>(payload: T): T {
  if (!payload || typeof payload !== 'object') return payload;
  const record = payload as Record<string, unknown>;
  if (!('third_set_type' in record) && !('tiebreak_starts_at_363' in record) && !('opponent_ranking' in record) &&
    typeof record.player_ranking_snapshot !== 'string') return payload;
  const { third_set_type, tiebreak_starts_at_363, opponent_ranking, ...rest } = record;
  if (typeof rest.player_ranking_snapshot === 'string') rest.player_ranking_snapshot = legacyFitpRankingId(rest.player_ranking_snapshot);
  if ('opponent_ranking' in record && rest.opponent_ranking_snapshot === undefined) {
    rest.opponent_ranking_snapshot = legacyFitpRankingId(opponent_ranking);
  }
  if ('third_set_type' in record && rest.last_set_type === undefined) rest.last_set_type = third_set_type;
  if ('tiebreak_starts_at_363' in record && rest.games_to_win_set === undefined) {
    rest.games_to_win_set = tiebreak_starts_at_363 === false ? 6 : 4;
  }
  return rest as T;
}

/** A match record from an older app version in the current shape: legacy text status and legacy columns converted. */
export function migrateLegacyMatch<T>(payload: T): T {
  return migrateLegacyMatchColumns(migrateLegacyStatus('match', payload));
}
