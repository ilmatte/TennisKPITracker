import { fitpRankingOptionLabel, groupFitpRankings } from '../features/players/fitpRankings';
import type { FitpRanking } from '../types';

/** Options of a FITP ranking drop-down: "Non indicata" (empty value), then the registry grouped by category (Quarta,
 *  Terza, Seconda) and ordered from the lowest ranking to the highest. Each option starts with the official code, so
 *  typing it on the focused menu selects it. `value` keeps an inactive ranking already stored visible. */
export function FitpRankingOptions({ rankings, value }: { rankings: readonly FitpRanking[]; value: number | null }) {
  return <>
    <option value="">Non indicata</option>
    {groupFitpRankings(rankings, value).map(group => <optgroup key={group.group} label={group.label}>
      {group.rankings.map(item => <option key={item.id} value={item.id}>{fitpRankingOptionLabel(item)}</option>)}
    </optgroup>)}
  </>;
}
