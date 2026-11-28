import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import TennisApp from '../TennisApp';
import { AuthContext } from '../features/auth/AuthContext';
import { FamilyProvider } from '../features/families/FamilyContext';
import { db, ensureLocalWorkspace } from '../db/database';
import { createTournament } from '../db/sportsMutations';
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

describe('Nuova partita: classifica avversario', () => {
  it('offers the FITP rankings registry and saves the choice as the opponent snapshot, with the player one', async () => {
    const family = await ensureLocalWorkspace();
    const now = new Date().toISOString();
    await db.players.add({ id: 'p1', family_id: family.id, first_name: 'Ale', last_name: 'Rossi', ranking_id: 7, created_at: now, updated_at: now, version: 1, deleted: false });
    await createTournament(family.id, { name: 'Open estivo', age_category_id: 5, start_date: localIsoDate() },
      { create: { name: 'TC Lambrate', city: '', surface: null } });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[{ pathname: '/', state: { openNewMatch: true, initialPlayerId: 'p1' } }]}>
        <AuthContext.Provider value={{ user: null, loading: false }}>
          <FamilyProvider><TennisApp /></FamilyProvider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    const wizard = await screen.findByRole('dialog', { name: 'Nuova partita' });
    await user.click(await within(wizard).findByRole('radio', { name: /Open estivo/ }));
    await user.click(within(wizard).getByRole('button', { name: 'Avanti' }));

    // The player's current ranking, read from the registry, is shown as the snapshot to be frozen.
    expect(await within(wizard).findByText('4.1')).toBeTruthy();
    await user.type(within(wizard).getByLabelText('Avversario'), 'Bianchi');
    const select = within(wizard).getByLabelText('Classifica avversario') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect([...select.querySelectorAll('optgroup')].map(group => group.label))
      .toEqual(['Quarta categoria', 'Terza categoria', 'Seconda categoria']);
    expect(select.options).toHaveLength(21);
    await user.selectOptions(select, '3.5 · III categoria 5° gruppo');
    await user.click(within(wizard).getByRole('button', { name: 'Avanti' }));
    await user.click(within(wizard).getByRole('button', { name: 'Avvia partita' }));

    await waitFor(async () => expect(await db.matches.count()).toBe(1));
    expect((await db.matches.toArray())[0]).toMatchObject({
      opponent: 'Bianchi', player_ranking_snapshot: 7, opponent_ranking_snapshot: 8,
    });
  });
});
