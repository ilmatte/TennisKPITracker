import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/database';
import { loadTournamentRows } from './tournamentRows';
import type { Club, Match, Tournament } from '../../types';

const now = '2026-01-01T10:00:00.000Z';
const base = { created_at: now, updated_at: now, version: 1, deleted: false };

const club: Club = { id: 'club', family_id: 'f1', name: 'TC Lambrate', city: '', surface: null, ...base };
const tournament = (id: string, start_date: string, extra: Partial<Tournament> = {}): Tournament =>
  ({ id, family_id: 'f1', club_id: club.id, name: id, age_category_id: 3, start_date, status: 'upcoming', ...base, ...extra });
const match = (id: string, tournament_id: string | null, match_date: string, extra: Partial<Match> = {}): Match => ({
  id, family_id: 'f1', match_date, player_id: 'p', player_ranking_snapshot: '', opponent: 'Bea', tournament_id,
  number_of_sets: 3, third_set_type: 'normal', super_tiebreak_target: 10, tiebreak_target: 7, tiebreak_starts_at_363: true,
  deuce_single_point: true, first_server: 'player', status: 'completed', ...base, ...extra,
});

beforeEach(async () => {
  await Promise.all([db.clubs.clear(), db.tournaments.clear(), db.matches.clear()]);
});

describe('loadTournamentRows', () => {
  it('groups active matches under their tournament, newest first, with club and status', async () => {
    await db.clubs.add(club);
    await db.tournaments.bulkAdd([
      tournament('old', '2026-01-01', { status: 'completed' }),
      tournament('current', '2026-11-20', { status: 'in-progress' }),
      tournament('upcoming', '2026-12-10'),
      tournament('gone', '2026-11-25', { deleted: true }),
      tournament('other-family', '2026-11-25', { family_id: 'f2' }),
    ]);
    await db.matches.bulkAdd([
      match('m1', 'current', '2026-11-21'),
      match('m2', 'current', '2026-11-24'),
      match('deleted', 'current', '2026-11-26', { deleted: true }),
      match('m3', 'old', '2026-01-02'),
      match('no-tournament', null, '2026-11-26'),
    ]);

    const rows = await loadTournamentRows('f1');

    expect(rows.map(row => [row.tournament.id, row.status])).toEqual([
      ['current', 'in-progress'], ['upcoming', 'upcoming'], ['old', 'completed'],
    ]);
    expect(rows[0].club?.name).toBe('TC Lambrate');
    expect(rows[0].matches.map(item => item.id)).toEqual(['m2', 'm1']);
    expect(rows[0].lastActivity).toBe('2026-11-24');
    expect(rows[1].matches).toEqual([]);
  });

  it('uses the stored status, whatever the dates', async () => {
    await db.clubs.add(club);
    await db.tournaments.bulkAdd([
      tournament('closed-early', '2026-11-25', { status: 'completed' }),
      tournament('still-running', '2026-01-01', { status: 'in-progress' }),
      tournament('long-past', '2020-01-01'),
    ]);
    await db.matches.add(match('recent', 'long-past', '2026-11-26'));

    const rows = await loadTournamentRows('f1');

    expect(rows.map(row => [row.tournament.id, row.status])).toEqual([
      ['still-running', 'in-progress'], ['long-past', 'upcoming'], ['closed-early', 'completed'],
    ]);
  });
});
