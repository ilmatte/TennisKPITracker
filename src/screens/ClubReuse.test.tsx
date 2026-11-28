import 'fake-indexeddb/auto';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import TennisApp from '../TennisApp';
import { AuthContext } from '../features/auth/AuthContext';
import { FamilyProvider } from '../features/families/FamilyContext';
import { db, ensureLocalWorkspace } from '../db/database';

beforeEach(async () => {
  await Promise.all([db.families.clear(), db.players.clear(), db.clubs.clear(), db.tournaments.clear(), db.syncQueue.clear()]);
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
});
afterEach(cleanup);

it('offers a club created in Impostazioni (local only) in Nuova partita > Nuovo torneo', async () => {
  const family = await ensureLocalWorkspace();
  const now = new Date().toISOString();
  await db.players.add({ id: 'p1', family_id: family.id, first_name: 'Ale', last_name: 'Rossi', ranking_id: 7, created_at: now, updated_at: now, version: 1, deleted: false });
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={['/clubs']}><AuthContext.Provider value={{ user: null, loading: false }}>
    <FamilyProvider><TennisApp /></FamilyProvider></AuthContext.Provider></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: /Aggiungi club/ }));
  await user.type(screen.getByPlaceholderText('Es. TC Lambrate'), 'TC Prova');
  await user.click(screen.getByRole('button', { name: /Salva club/ }));
  await screen.findByText('TC Prova');
  expect(await db.clubs.count()).toBe(1);

  cleanup();
  render(<MemoryRouter initialEntries={['/matches']}><AuthContext.Provider value={{ user: null, loading: false }}>
    <FamilyProvider><TennisApp /></FamilyProvider></AuthContext.Provider></MemoryRouter>);
  const newMatch = await screen.findByRole('button', { name: 'Nuova partita' });
  // Wait for the players list to load: with no players the button opens Giocatori instead of the wizard.
  await new Promise(resolve => setTimeout(resolve, 300));
  await user.click(newMatch);
  await screen.findByText('Nessun torneo');
  await user.click(screen.getByText(/Crea un nuovo torneo/));
  const select = await screen.findByLabelText('Club') as HTMLSelectElement;
  expect(within(select).getByRole('option').textContent).toBe('TC Prova');
});
