import type { Player, PlayerAgeCategory } from '../../types';

/** FITP age sectors. */
export type AgeCategorySector = 'youth' | 'open' | 'veterans';

/** How the age compared with a category's thresholds is measured in the sporting year:
 *  - `january_1`: years completed on 1 January of the sporting year (youth sectors and Open);
 *  - `calendar_year`: age reached during the sporting year, i.e. sporting year minus birth year (veterans: a player
 *    belongs to Over 30 in the year of their 30th birthday). */
export type AgeBasis = 'january_1' | 'calendar_year';

export const AGE_CATEGORY_SECTOR_LABELS: Record<AgeCategorySector, string> = {
  youth: 'Giovanile',
  open: 'Ordinari',
  veterans: 'Veterani',
};

const veteran = (id: number, age: number, maxAge: number | null): PlayerAgeCategory => ({
  id, code: `O${age}`, name: `Over ${age}`, sector: 'veterans', sort_order: id, is_active: false,
  min_age: age, max_age: maxAge, age_basis: 'calendar_year',
});

/** Rows of the `player_age_categories` reference table (supabase/initial_schema.sql and the Dexie store).
 *  Ids are stable: never renumber them. U8 and U10 are intentionally not part of the registry.
 *  The veterans categories (Over 30 and above) are currently inactive: until they are activated, adult players are
 *  attributed to Open.
 *  `max_age` is exclusive; null means no upper limit. */
export const PLAYER_AGE_CATEGORIES: readonly PlayerAgeCategory[] = [
  { id: 1, code: 'U12', name: 'Under 12', sector: 'youth', sort_order: 1, is_active: true, min_age: 10, max_age: 12, age_basis: 'january_1' },
  { id: 2, code: 'U14', name: 'Under 14', sector: 'youth', sort_order: 2, is_active: true, min_age: 12, max_age: 14, age_basis: 'january_1' },
  { id: 3, code: 'U16', name: 'Under 16', sector: 'youth', sort_order: 3, is_active: true, min_age: 14, max_age: 16, age_basis: 'january_1' },
  { id: 4, code: 'U18', name: 'Under 18', sector: 'youth', sort_order: 4, is_active: true, min_age: 16, max_age: 18, age_basis: 'january_1' },
  { id: 5, code: 'OPEN', name: 'Open', sector: 'open', sort_order: 5, is_active: true, min_age: 18, max_age: null, age_basis: 'january_1' },
  veteran(6, 30, 35),
  veteran(7, 35, 40),
  veteran(8, 40, 45),
  veteran(9, 45, 50),
  veteran(10, 50, 55),
  veteran(11, 55, 60),
  veteran(12, 60, 65),
  veteran(13, 65, 70),
  veteran(14, 70, 75),
  veteran(15, 75, 80),
  veteran(16, 80, null),
];

/** FITP sporting year: it coincides with the calendar year. */
export function currentSportingYear(today: Date = new Date()): number {
  return today.getFullYear();
}

/** Parses an ISO calendar date (YYYY-MM-DD) without time zones; null when missing or not a real date. */
export function parseBirthDate(birthDate: string | null | undefined): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate ?? '');
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Years completed on 1 January of the sporting year. A birthday falling on 1 January counts as already completed. */
export function ageOnJanuaryFirst(birthDate: string, sportingYear: number): number | null {
  const date = parseBirthDate(birthDate);
  if (!date) return null;
  const age = sportingYear - date.year - (date.month === 1 && date.day === 1 ? 0 : 1);
  return age >= 0 ? age : null;
}

/** Age reached during the sporting year (sporting year minus birth year). */
export function ageReachedInYear(birthDate: string, sportingYear: number): number | null {
  const date = parseBirthDate(birthDate);
  if (!date || sportingYear < date.year) return null;
  return sportingYear - date.year;
}

/** The single main age category of a player in a sporting year, or null when none applies (younger than the U12
 *  threshold, missing or invalid birth date). Thresholds are read from the registry, so updated FITP rules only need
 *  updated rows. When several categories match (an Open-age player who reaches a veterans threshold), the most
 *  specific one wins: the matching category with the highest sort order. Inactive categories are ignored. */
export function ageCategoryFor(
  birthDate: string | null | undefined,
  sportingYear: number,
  categories: readonly PlayerAgeCategory[] = PLAYER_AGE_CATEGORIES,
): PlayerAgeCategory | null {
  if (!birthDate || !parseBirthDate(birthDate)) return null;
  let best: PlayerAgeCategory | null = null;
  for (const category of categories) {
    if (!category.is_active) continue;
    const age = category.age_basis === 'january_1' ? ageOnJanuaryFirst(birthDate, sportingYear) : ageReachedInYear(birthDate, sportingYear);
    if (age === null || age < category.min_age || (category.max_age !== null && age >= category.max_age)) continue;
    if (!best || category.sort_order > best.sort_order) best = category;
  }
  return best;
}

/** Age category of a player in a sporting year (current year by default). Independent from the FITP technical
 *  ranking (`player.ranking`). */
export function playerAgeCategory(
  player: Pick<Player, 'birth_date'>,
  sportingYear: number = currentSportingYear(),
  categories: readonly PlayerAgeCategory[] = PLAYER_AGE_CATEGORIES,
): PlayerAgeCategory | null {
  return ageCategoryFor(player.birth_date, sportingYear, categories);
}
