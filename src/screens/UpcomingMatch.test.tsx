import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import TennisApp from '../TennisApp';
import { AuthContext } from '../features/auth/AuthContext';
import { FamilyProvider } from '../features/families/FamilyContext';
import { db, ensureLocalWorkspace } from '../db/database';
import { createMatch, createTournament, type NewMatchInput } from '../db/sportsMutations';
import type { Match } from '../types';

beforeEach(async () => {
  await Promise.all([
    db.families.clear(), db.players.clear(), db.clubs.clear(), db.tournaments.clear(), db.matches.clear(), db.syncQueue.clear(),
  ]);
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function seed(matches: Partial<NewMatchInput>[]): Promise<Match[]> {
  const family = await ensureLocalWorkspace();
  const now = new Date().toISOString();
  await db.players.add({ id: 'p1', family_id: family.id, first_name: 'Ale', last_name: 'Rossi', ranking_id: 7, created_at: now, updated_at: now, version: 1, deleted: false });
  const { tournament } = await createTournament(family.id, { name: 'Torneo di primavera', age_category_id: 5, start_date: '2026-11-01' },
    { create: { name: 'TC Lambrate', city: '', surface: null } });
  const created: Match[] = [];
  for (const overrides of matches) {
    created.push(await createMatch(family.id, {
      tournament_id: tournament.id, match_date: '2026-11-30', match_time: '10:00', player_id: 'p1', opponent: 'Gialli',
      opponent_ranking_snapshot: null, number_of_sets: 3, last_set_type: 'super-tiebreak', super_tiebreak_target: 10,
      tiebreak_target: 7, games_to_win_set: 4, short_set_tiebreak_at: 3, deuce_single_point: true,
      first_server: null, status_id: 1, ...overrides,
    }));
  }
  return created;
}

function renderAt(pathname: string) {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <AuthContext.Provider value={{ user: null, loading: false }}>
        <FamilyProvider><TennisApp /></FamilyProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}

describe('Partite: sezione In programma', () => {
  it('lists upcoming matches first, soonest first, then the played ones; the filter shows only the upcoming ones', async () => {
    await seed([
      { opponent: 'Verdi', match_date: '2026-12-05', match_time: null },
      { opponent: 'Gialli', match_date: '2026-11-30' },
      { opponent: 'Neri', match_date: '2026-11-20', first_server: 'player', status_id: 2 },
    ]);
    const user = renderAt('/matches');
    const upcoming = await screen.findByRole('region', { name: 'In programma' });
    await within(upcoming).findByText('Rossi vs Gialli');
    expect(within(upcoming).getAllByRole('article').map(card => within(card).getByText(/vs/).textContent))
      .toEqual(['Rossi vs Gialli', 'Rossi vs Verdi']);
    expect(await within(upcoming).findByText('lun • 10:00 • Torneo di primavera')).toBeTruthy();
    expect(within(upcoming).getByText('NOV')).toBeTruthy();
    const played = await screen.findByRole('region', { name: 'Giocate' });
    expect(within(played).getByText('Rossi vs Neri')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'In programma' }));
    expect(screen.queryByRole('region', { name: 'Giocate' })).toBeNull();
    expect(screen.getByRole('region', { name: 'In programma' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Vinte' }));
    expect(screen.queryByRole('region', { name: 'In programma' })).toBeNull();
  });

  it('starts an upcoming match from its card: Inizia partita stays disabled until a server is chosen', async () => {
    const [match] = await seed([{}]);
    const user = renderAt('/matches');
    await user.click(await screen.findByRole('button', { name: 'Avvia Rossi vs Gialli' }));
    const sheet = await screen.findByRole('dialog', { name: 'Chi serve per primo?' });
    expect((within(sheet).getByRole('button', { name: 'Scegli chi serve per iniziare' }) as HTMLButtonElement).disabled).toBe(true);
    // The card did not open the detail behind the sheet.
    expect(screen.queryByRole('heading', { name: 'Partita in programma' })).toBeNull();
    const opponentTile = within(sheet).getByRole('button', { name: /Gialli/ });
    await user.click(opponentTile);
    expect(opponentTile.getAttribute('aria-pressed')).toBe('true');
    await user.click(within(sheet).getByRole('button', { name: 'Inizia partita' }));
    await waitFor(async () => expect(await db.matches.get(match.id)).toMatchObject({ status_id: 2, first_server: 'opponent' }));
    expect((await db.matches.get(match.id))?.started_at).toBeTruthy();
  });
});

describe('Dettaglio partita in programma', () => {
  it('shows the summary and starts the match, with the server chosen in the wizard preselected', async () => {
    const [match] = await seed([{ first_server: 'player' }]);
    const user = renderAt(`/match/${match.id}`);
    expect(await screen.findByRole('heading', { name: 'Partita in programma' })).toBeTruthy();
    expect(screen.getByText('In programma · lun 30 nov, 10:00')).toBeTruthy();
    expect(await screen.findByText('Torneo di primavera')).toBeTruthy();
    expect(screen.getByText('Punto secco · TB da 3-3')).toBeTruthy();
    expect(screen.getAllByText('Ale Rossi').length).toBeGreaterThan(1);

    await user.click(screen.getByRole('button', { name: 'Avvia partita' }));
    const sheet = await screen.findByRole('dialog', { name: 'Chi serve per primo?' });
    expect(within(sheet).getByRole('button', { name: /Ale Rossi/ }).getAttribute('aria-pressed')).toBe('true');
    await user.click(within(sheet).getByRole('button', { name: 'Inizia partita' }));
    await waitFor(async () => expect(await db.matches.get(match.id)).toMatchObject({ status_id: 2, first_server: 'player' }));
    // The same route now shows the match in progress.
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Partita in programma' })).toBeNull());
  });

  it('shows "Da decidere" and edits every wizard field while the match is upcoming', async () => {
    const [match] = await seed([{}]);
    const user = renderAt(`/match/${match.id}`);
    expect(await screen.findByText('Da decidere')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Modifica dettagli' }));
    const wizard = await screen.findByRole('dialog', { name: 'Modifica partita' });
    await user.click(await within(wizard).findByRole('radio', { name: /Torneo di primavera/ }));
    await user.click(within(wizard).getByRole('button', { name: 'Avanti' }));
    const opponent = await within(wizard).findByLabelText('Avversario');
    await user.clear(opponent);
    await user.type(opponent, 'Bianchi');
    await user.click(within(wizard).getByRole('button', { name: 'Avanti' }));
    await user.click(within(wizard).getByRole('button', { name: 'Bianchi' }));
    await user.click(within(wizard).getByRole('button', { name: 'Salva modifiche' }));
    await waitFor(async () => expect(await db.matches.get(match.id)).toMatchObject({
      status_id: 1, opponent: 'Bianchi', first_server: 'opponent', match_time: '10:00', version: 2,
    }));
    // The detail shows the new opponent as the server.
    expect(await screen.findByText('Bianchi', { selector: 'dd' })).toBeTruthy();
  });
});
