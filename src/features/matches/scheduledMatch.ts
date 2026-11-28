import type { Match } from '../../types';

/** Local date of an ISO calendar date (YYYY-MM-DD), without the UTC shift of `new Date('YYYY-MM-DD')`. */
function localDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

/** Planned time as "HH:MM" (Supabase returns "HH:MM:SS"), or null. */
export function matchTimeLabel(time: string | null | undefined): string | null {
  return time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : null;
}

/** "dom 30 nov" for 2026-11-30. */
export function shortDayLabel(isoDate: string): string {
  return localDate(isoDate).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '');
}

/** Day and planned time: "dom 30 nov · 10:00", or "dom 30 nov" without a time. `separator` joins them. */
export function scheduleLabel(match: Pick<Match, 'match_date' | 'match_time'>, separator = ' · '): string {
  const time = matchTimeLabel(match.match_time);
  return time ? `${shortDayLabel(match.match_date)}${separator}${time}` : shortDayLabel(match.match_date);
}

/** Month and day of the date box of an upcoming match card: { month: "NOV", day: "30" }. */
export function dateBoxParts(isoDate: string): { month: string; day: string } {
  const date = localDate(isoDate);
  return {
    month: date.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '').toUpperCase(),
    day: String(date.getDate()),
  };
}

/** Upcoming matches first by date, then by planned time (matches without a time last on their day), then by creation. */
export function compareUpcomingMatches(a: Match, b: Match): number {
  return a.match_date.localeCompare(b.match_date)
    || (matchTimeLabel(a.match_time) ?? '99:99').localeCompare(matchTimeLabel(b.match_time) ?? '99:99')
    || a.created_at.localeCompare(b.created_at);
}

/** "3 set · super tie-break", "5 set · set completo". */
export function matchFormatLabel(match: Pick<Match, 'number_of_sets' | 'last_set_type' | 'games_to_win_set'>): string {
  const last = match.last_set_type === 'super-tiebreak' ? 'super tie-break' : 'set completo';
  return `${match.number_of_sets} set a ${match.games_to_win_set} game · ${last}`;
}

/** "Punto secco · TB da 3-3", "Vantaggi · TB da 6-6". */
export function matchRulesLabel(match: Pick<Match, 'deuce_single_point' | 'games_to_win_set' | 'short_set_tiebreak_at'>): string {
  const deuce = match.deuce_single_point ? 'Punto secco' : 'Vantaggi';
  const at = match.games_to_win_set === 4 ? (match.short_set_tiebreak_at ?? 3) : 6;
  return `${deuce} · TB da ${at}-${at}`;
}

/** Initial shown in the avatar of a player. */
export const initial = (name: string): string => name.trim().charAt(0).toUpperCase() || '?';
