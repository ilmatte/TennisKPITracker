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


/** "12 apr 2025" for 2025-04-12 (no time-zone shift). */
export function formatTournamentDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

