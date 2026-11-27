import { db } from '../../db/database';
import { localIsoDate, tournamentStatus, type TournamentStatus } from './tournaments';
import type { Club, Match, Tournament } from '../../types';

export type TournamentRow = {
  tournament: Tournament;
  club: Club | undefined;
  status: TournamentStatus;
  /** Latest of the start date and the last match date. */
  lastActivity: string;
  /** The tournament's matches, most recent first. */
  matches: Match[];
};

const STATUS_ORDER: Record<TournamentStatus, number> = { 'in-progress': 0, upcoming: 1, completed: 2 };

/** Active tournaments of a family with their club, estimated status and matches: those in progress first, then the
 *  upcoming and the completed ones, each group by most recent activity. */
export async function loadTournamentRows(familyId: string, today: string = localIsoDate()): Promise<TournamentRow[]> {
  const [tournaments, clubs, matches] = await Promise.all([
    db.tournaments.where('family_id').equals(familyId).toArray(),
    db.clubs.where('family_id').equals(familyId).toArray(),
    db.matches.where('family_id').equals(familyId).toArray(),
  ]);
  const clubById = new Map(clubs.map(club => [club.id, club]));
  const matchesByTournament = new Map<string, Match[]>();
  for (const match of matches) {
    if (match.deleted || !match.tournament_id) continue;
    matchesByTournament.set(match.tournament_id, [...matchesByTournament.get(match.tournament_id) ?? [], match]);
  }
  return tournaments.filter(tournament => !tournament.deleted).map(tournament => {
    const tournamentMatches = (matchesByTournament.get(tournament.id) ?? [])
      .sort((a, b) => b.match_date.localeCompare(a.match_date) || b.created_at.localeCompare(a.created_at));
    const last = tournamentMatches[0]?.match_date ?? null;
    return {
      tournament,
      club: clubById.get(tournament.club_id),
      status: tournamentStatus(tournament.start_date, last, today),
      lastActivity: last && last > tournament.start_date ? last : tournament.start_date,
      matches: tournamentMatches,
    };
  }).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || b.lastActivity.localeCompare(a.lastActivity)
    || a.tournament.name.localeCompare(b.tournament.name, 'it'));
}
