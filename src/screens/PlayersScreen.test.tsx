import 'fake-indexeddb/auto';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import TennisApp from '../TennisApp';
import { AuthContext } from '../features/auth/AuthContext';
import { FamilyProvider } from '../features/families/FamilyContext';
import { db, ensureLocalWorkspace } from '../db/database';
import { createMatch, createTournament } from '../db/sportsMutations';
import { localIsoDate } from '../features/tournaments/tournaments';

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

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider value={{ user: null, loading: false }}>
        <FamilyProvider><TennisApp /></FamilyProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('Classifica FITP in the player editor', () => {
  it('offers the registry grouped by category, saves the choice and leaves match snapshots unchanged', async () => {
    const family = await ensureLocalWorkspace();
    const now = new Date().toISOString();
    await db.players.add({ id: 'p1', family_id: family.id, first_name: 'Ale', last_name: 'Rossi', ranking_id: 7, created_at: now, updated_at: now, version: 1, deleted: false });
    const { tournament } = await createTournament(family.id, { name: 'Open', age_category_id: 5, start_date: localIsoDate() },
      { create: { name: 'TC Lambrate', city: '', surface: null } });
    const match = await createMatch(family.id, {
      tournament_id: tournament.id, match_date: localIsoDate(), player_id: 'p1', opponent: 'Bianchi', number_of_sets: 3,
      last_set_type: 'super-tiebreak', super_tiebreak_target: 10, tiebreak_target: 7, games_to_win_set: 4,
      short_set_tiebreak_at: 3, deuce_single_point: true, first_server: 'player',
    });
    expect(match.player_ranking_snapshot).toBe('4.1');
    const user = userEvent.setup();
    renderApp('/players');

    // The card shows the code read from the registry.
    expect(await screen.findByText(/FITP 4\.1/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Ale Rossi/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifica giocatore' });
    const select = within(dialog).getByRole('combobox', { name: 'Classifica FITP' }) as HTMLSelectElement;

    const groups = [...select.querySelectorAll('optgroup')];
    expect(groups.map(group => group.label)).toEqual(['Quarta categoria', 'Terza categoria', 'Seconda categoria']);
    expect([...select.options].map(option => option.text.split(' · ')[0])).toEqual([
      'Non indicata', '4.NC', '4.6', '4.5', '4.4', '4.3', '4.2', '4.1',
      '3.5', '3.4', '3.3', '3.2', '3.1', '2.8', '2.7', '2.6', '2.5', '2.4', '2.3', '2.2', '2.1',
    ]);
    expect(select.selectedOptions[0].text).toBe('4.1 · IV categoria 1° gruppo');

    await user.selectOptions(select, '3.4 · III categoria 4° gruppo');
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));

    expect(await screen.findByText(/FITP 3\.4/)).toBeTruthy();
    expect(await db.players.get('p1')).toMatchObject({ ranking_id: 9, version: 2 });
    // The match keeps the ranking the player had when it was registered.
    expect(await db.matches.get(match.id)).toMatchObject({ player_ranking_snapshot: '4.1' });
  });

  it('creates a player as non classificato', async () => {
    await ensureLocalWorkspace();
    const user = userEvent.setup();
    renderApp('/players');

    await user.click(await screen.findByRole('button', { name: 'Aggiungi giocatore' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuovo giocatore' });
    await user.type(within(dialog).getByLabelText('Nome'), 'Bea');
    const select = within(dialog).getByRole('combobox', { name: 'Classifica FITP' }) as HTMLSelectElement;
    expect(select.value).toBe('');
    await user.selectOptions(select, '4.NC · IV categoria NC (non classificato)');
    await user.click(within(dialog).getByRole('button', { name: 'Salva' }));

    expect(await screen.findByText(/FITP 4\.NC/)).toBeTruthy();
    expect((await db.players.toArray())[0]).toMatchObject({ first_name: 'Bea', ranking_id: 1 });
  });
});
