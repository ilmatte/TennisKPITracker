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

describe('Tornei screen', () => {
  it('is reached from the Partite switch and lists each tournament with its matches', async () => {
    const family = await ensureLocalWorkspace();
    const now = new Date().toISOString();
    await db.players.add({ id: 'p1', family_id: family.id, first_name: 'Ale', last_name: 'Rossi', ranking: '4.1', created_at: now, updated_at: now, version: 1, deleted: false });
    const { tournament } = await createTournament(family.id, { name: 'Torneo di primavera', age_category_id: 3, start_date: localIsoDate() },
      { create: { name: 'TC Lambrate', city: '', surface: null } });
    await createMatch(family.id, {
      tournament_id: tournament.id, match_date: localIsoDate(), player_id: 'p1', opponent: 'Bianchi', number_of_sets: 3,
      third_set_type: 'super-tiebreak', super_tiebreak_target: 10, tiebreak_target: 7, games_to_win_set: 4,
      short_set_tiebreak_at: 3, deuce_single_point: true, first_server: 'player',
    });
    const user = userEvent.setup();
    renderApp('/matches');

    expect(await screen.findByRole('heading', { name: 'Partite' })).toBeTruthy();
    await user.click(within(screen.getByRole('navigation', { name: 'Sezioni partite' })).getByRole('link', { name: 'Tornei' }));

    expect(await screen.findByRole('heading', { name: 'Tornei' })).toBeTruthy();
    const group = await screen.findByRole('article', { name: 'Torneo di primavera' });
    expect(within(group).getByText(/TC Lambrate • U16 • dal/)).toBeTruthy();
    expect(group.querySelector('.mt-badge')?.textContent).toBe('In corso');
    const matchRow = await within(group).findByRole('button', { name: /vs Bianchi/ });
    expect(within(matchRow).getByText('In corso')).toBeTruthy();
    // The bottom bar shows the Tornei item (light tornei.png) in place of Partite.
    const navItem = document.querySelector('.bottom-nav a[href="/tournaments"]');
    expect(navItem?.className).toContain('active');
    expect(navItem?.textContent).toBe('Tornei');
    expect(navItem?.querySelector('img')?.getAttribute('src')).toMatch(/chiaro\/256\/tornei\.png/);
    expect(document.querySelector('.bottom-nav a[href="/matches"]')).toBeNull();
    expect(group.querySelector('.mt-icon')?.getAttribute('src')).toMatch(/scuro\/256\/tornei\.png/);

    await user.click(screen.getByRole('button', { name: 'Conclusi' }));
    expect(await screen.findByText('Nessun torneo concluso')).toBeTruthy();
    await user.click(within(screen.getByRole('navigation', { name: 'Sezioni partite' })).getByRole('link', { name: 'Partite' }));
    expect(await screen.findByRole('heading', { name: 'Partite' })).toBeTruthy();
  });

  it('creates a tournament with "Nuovo torneo" and goes back to the list', async () => {
    await ensureLocalWorkspace();
    const user = userEvent.setup();
    renderApp('/tournaments');

    expect(await screen.findByText('Nessun torneo')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Nuovo torneo' }));
    await user.type(screen.getByPlaceholderText('Nome del nuovo club'), 'TC Lambrate');
    await user.type(screen.getByLabelText('Nome torneo'), 'Open d’autunno');
    await user.click(screen.getByRole('button', { name: 'Crea torneo' }));

    expect(await screen.findByRole('article', { name: 'Open d’autunno' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Nuovo torneo' })).toBeNull();
    expect(await db.tournaments.count()).toBe(1);
  });

  it('opens "Modifica torneo" from a tournament row, prefilled, and saves back to the list', async () => {
    const family = await ensureLocalWorkspace();
    const { tournament } = await createTournament(family.id, { name: 'Memorial Conti', age_category_id: 3, start_date: '2026-06-14' },
      { create: { name: 'TC Roma Nord', city: 'Roma', surface: null } });
    const user = userEvent.setup();
    renderApp('/tournaments');

    const group = await screen.findByRole('article', { name: 'Memorial Conti' });
    await user.click(within(group).getByRole('button', { name: /Memorial Conti/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Modifica torneo' });
    expect((within(dialog).getByLabelText('Nome torneo') as HTMLInputElement).value).toBe('Memorial Conti');
    expect((within(dialog).getByLabelText('Club') as HTMLSelectElement).value).toBe(tournament.club_id);
    expect(within(dialog).getByRole('button', { name: 'U16' }).getAttribute('aria-pressed')).toBe('true');
    expect((within(dialog).getByLabelText('Data di inizio') as HTMLInputElement).value).toBe('2026-06-14');

    await user.clear(within(dialog).getByLabelText('Nome torneo'));
    await user.type(within(dialog).getByLabelText('Nome torneo'), 'Memorial Conti 2026');
    await user.click(within(dialog).getByRole('button', { name: 'Open' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salva torneo' }));

    expect(await screen.findByRole('article', { name: 'Memorial Conti 2026' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Modifica torneo' })).toBeNull();
    expect(await db.tournaments.get(tournament.id)).toMatchObject({ name: 'Memorial Conti 2026', age_category_id: 5, version: 2 });
    expect(await db.tournaments.count()).toBe(1);
  });

  it('deletes a tournament from "Modifica torneo" after confirmation', async () => {
    const family = await ensureLocalWorkspace();
    const { tournament } = await createTournament(family.id, { name: 'Memorial Conti', age_category_id: 3, start_date: '2026-06-14' },
      { create: { name: 'TC Roma Nord', city: '', surface: null } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    renderApp('/tournaments');

    await user.click(within(await screen.findByRole('article', { name: 'Memorial Conti' })).getByRole('button', { name: /Memorial Conti/ }));
    // Cancelled: nothing changes and the form stays open.
    await user.click(screen.getByRole('button', { name: 'Elimina torneo' }));
    expect(confirm).toHaveBeenLastCalledWith('Eliminare il torneo “Memorial Conti”?');
    expect(screen.getByRole('dialog', { name: 'Modifica torneo' })).toBeTruthy();
    expect(await db.tournaments.get(tournament.id)).toMatchObject({ deleted: false });

    await user.click(screen.getByRole('button', { name: 'Elimina torneo' }));
    expect(await screen.findByText('Nessun torneo')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Modifica torneo' })).toBeNull();
    expect(await db.tournaments.get(tournament.id)).toMatchObject({ deleted: true });
  });

  it('offers no delete button when creating a tournament', async () => {
    await ensureLocalWorkspace();
    const user = userEvent.setup();
    renderApp('/tournaments');
    await user.click(await screen.findByRole('button', { name: 'Nuovo torneo' }));
    expect(screen.queryByRole('button', { name: 'Elimina torneo' })).toBeNull();
  });
});
