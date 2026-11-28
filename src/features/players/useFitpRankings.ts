import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database';
import type { FitpRanking } from '../../types';

/** The FITP rankings registry (fitp_rankings reference table), from the lowest ranking to the highest. */
export function useFitpRankings(): FitpRanking[] {
  return useLiveQuery(() => db.fitp_rankings.orderBy('sort_order').toArray(), []) ?? [];
}

/** Value of a FITP ranking drop-down: the fitp_rankings id, or null for "Non indicata". */
export const fitpRankingValue = (value: string): number | null => value ? Number(value) : null;
