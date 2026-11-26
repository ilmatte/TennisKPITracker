import { PLAYER_AGE_CATEGORIES } from '../players/ageCategories';
import type { PlayerAgeCategory } from '../../types';

/** Categories a tournament can be created for: the youth sectors and Open (U12 to Open). They are rows of the
 *  player_age_categories reference table, which tournaments.age_category_id points to. */
export const TOURNAMENT_CATEGORIES: readonly PlayerAgeCategory[] = PLAYER_AGE_CATEGORIES
  .filter(category => category.sector === 'youth' || category.sector === 'open')
  .sort((a, b) => a.sort_order - b.sort_order);

/** Default category of the "Nuovo torneo" form. */
export const DEFAULT_TOURNAMENT_CATEGORY_ID = TOURNAMENT_CATEGORIES.find(category => category.code === 'U16')?.id
  ?? TOURNAMENT_CATEGORIES[0].id;

/** Short label of a category, as shown on the chips: "U12" … "U18", "Open". */
export function tournamentCategoryLabel(categoryId: number): string {
  const category = PLAYER_AGE_CATEGORIES.find(item => item.id === categoryId);
  if (!category) return '';
  return category.sector === 'youth' ? category.code : category.name;
}

/** Today's date in the device's time zone, as YYYY-MM-DD (toISOString would give the UTC date). */
export function localIsoDate(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayNumber(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** "12 apr 2025" for 2025-04-12 (no time-zone shift). */
export function formatTournamentDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A tournament stays "in corso" for this many days after its start or after its last recorded match. */
export const TOURNAMENT_ACTIVE_DAYS = 14;

export type TournamentStatus = 'upcoming' | 'in-progress' | 'completed';

export const TOURNAMENT_STATUS_LABELS: Record<TournamentStatus, string> = {
  upcoming: 'In programma',
  'in-progress': 'In corso',
  completed: 'Concluso',
};

/** Tournaments have no end date, so their status is estimated: upcoming before the start date, in progress until
 *  TOURNAMENT_ACTIVE_DAYS have passed since the latest of the start date and the last match date, then completed. */
export function tournamentStatus(startDate: string, lastMatchDate: string | null, today: string = localIsoDate()): TournamentStatus {
  if (startDate > today) return 'upcoming';
  const lastActivity = lastMatchDate && lastMatchDate > startDate ? lastMatchDate : startDate;
  return dayNumber(today) - dayNumber(lastActivity) <= TOURNAMENT_ACTIVE_DAYS ? 'in-progress' : 'completed';
}
