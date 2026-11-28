import type { FitpRanking, FitpRankingCategoryGroup } from '../../types';

/** FITP season the registry refers to. The sequence below is the one of Tabella 1 of the official "Metodo per la
 *  compilazione delle classifiche federali" 2026 and 2027 (identical in both). A future change of the classification
 *  gets new rows (new ids) with their season; existing rows are deactivated, never renumbered. */
export const FITP_RANKINGS_SEASON = 2026;

export const FITP_RANKING_CATEGORY_LABELS: Record<FitpRankingCategoryGroup, string> = {
  fourth: 'Quarta categoria',
  third: 'Terza categoria',
  second: 'Seconda categoria',
};

/** Roman numeral of the category, as in the FITP documents ("IV categoria 1° gruppo"). */
const CATEGORY_NUMERALS: Record<FitpRankingCategoryGroup, string> = { fourth: 'IV', third: 'III', second: 'II' };

const ranking = (id: number, code: string, categoryGroup: FitpRankingCategoryGroup, group: string): FitpRanking => ({
  id,
  code,
  name: `${CATEGORY_NUMERALS[categoryGroup]} categoria ${group}`,
  category_group: categoryGroup,
  sort_order: id,
  is_active: true,
  season: FITP_RANKINGS_SEASON,
});

/** Rows of the `fitp_rankings` reference table (supabase/initial_schema.sql and the Dexie store), from the lowest
 *  ranking to the highest. Ids are stable: never renumber them. Prima categoria and professional players are not part
 *  of the registry yet. */
export const FITP_RANKINGS: readonly FitpRanking[] = [
  ranking(1, '4.NC', 'fourth', 'NC (non classificato)'),
  ranking(2, '4.6', 'fourth', '6° gruppo'),
  ranking(3, '4.5', 'fourth', '5° gruppo'),
  ranking(4, '4.4', 'fourth', '4° gruppo'),
  ranking(5, '4.3', 'fourth', '3° gruppo'),
  ranking(6, '4.2', 'fourth', '2° gruppo'),
  ranking(7, '4.1', 'fourth', '1° gruppo'),
  ranking(8, '3.5', 'third', '5° gruppo'),
  ranking(9, '3.4', 'third', '4° gruppo'),
  ranking(10, '3.3', 'third', '3° gruppo'),
  ranking(11, '3.2', 'third', '2° gruppo'),
  ranking(12, '3.1', 'third', '1° gruppo'),
  ranking(13, '2.8', 'second', '8° gruppo'),
  ranking(14, '2.7', 'second', '7° gruppo'),
  ranking(15, '2.6', 'second', '6° gruppo'),
  ranking(16, '2.5', 'second', '5° gruppo'),
  ranking(17, '2.4', 'second', '4° gruppo'),
  ranking(18, '2.3', 'second', '3° gruppo'),
  ranking(19, '2.2', 'second', '2° gruppo'),
  ranking(20, '2.1', 'second', '1° gruppo'),
];

/** Rankings grouped by category, each group and each ranking ordered from the lowest to the highest level. Inactive
 *  rankings are left out, except `keepId` (the value already stored on a player, which must stay visible). */
export function groupFitpRankings(
  rankings: readonly FitpRanking[],
  keepId: number | null = null,
): { group: FitpRankingCategoryGroup; label: string; rankings: FitpRanking[] }[] {
  const sorted = rankings.filter(item => item.is_active || item.id === keepId)
    .sort((a, b) => a.sort_order - b.sort_order);
  const groups: { group: FitpRankingCategoryGroup; label: string; rankings: FitpRanking[] }[] = [];
  for (const item of sorted) {
    let last = groups.at(-1);
    if (!last || last.group !== item.category_group) {
      last = { group: item.category_group, label: FITP_RANKING_CATEGORY_LABELS[item.category_group], rankings: [] };
      groups.push(last);
    }
    last.rankings.push(item);
  }
  return groups;
}

/** Text of a ranking in a drop-down: the official code first (so that typing "3.4" selects it), then the category. */
export function fitpRankingOptionLabel(item: FitpRanking): string {
  return `${item.code} · ${item.name}`;
}

/** Official code of the ranking with the given id ('' when the player has none or the id is unknown). */
export function fitpRankingCode(rankingId: number | null | undefined, rankings: readonly FitpRanking[] = FITP_RANKINGS): string {
  if (rankingId === null || rankingId === undefined) return '';
  return rankings.find(item => item.id === rankingId)?.code ?? '';
}

/** Id of the registry ranking a free-text ranking typed before the registry existed refers to, or null when it matches
 *  none. Spaces are ignored, case and decimal comma tolerated; "NC", "N.C." and "4NC" mean 4.NC. The same rules are
 *  applied by the Supabase migration (supabase/migrations/20261128_fitp_rankings.sql). */
export function legacyFitpRankingId(text: unknown, rankings: readonly FitpRanking[] = FITP_RANKINGS): number | null {
  if (typeof text !== 'string') return null;
  let code = text.replace(/\s+/g, '').replace(/,/g, '.').toUpperCase();
  if (['NC', 'N.C.', 'N.C', '4NC', '4.N.C.', '4.N.C'].includes(code)) code = '4.NC';
  return rankings.find(item => item.code === code)?.id ?? null;
}

/** Converts a player payload written before the registry existed (free-text `ranking`) to `ranking_id`. Used when
 *  upgrading the local database, restoring JSON backups and applying downloaded or queued records; payloads already
 *  converted are returned unchanged. An existing `ranking_id` wins over the legacy text. */
export function migrateLegacyPlayerRanking<T>(payload: T): T {
  if (!payload || typeof payload !== 'object') return payload;
  const record = payload as Record<string, unknown>;
  if (!('ranking' in record) && 'ranking_id' in record) return payload;
  const { ranking: legacy, ...rest } = record;
  const rankingId = typeof rest.ranking_id === 'number' ? rest.ranking_id : legacyFitpRankingId(legacy);
  return { ...rest, ranking_id: rankingId } as T;
}

/** True when the value is the id of a registry row. */
export function isFitpRankingId(value: unknown, rankings: readonly FitpRanking[] = FITP_RANKINGS): value is number {
  return typeof value === 'number' && rankings.some(item => item.id === value);
}
