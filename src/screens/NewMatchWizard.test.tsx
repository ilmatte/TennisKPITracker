import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    await user.click(within(wizard).getByRole('button', { name: 'Rossi' }));
    await user.click(within(wizard).getByRole('button', { name: 'Avvia partita' }));

    await waitFor(async () => expect(await db.matches.count()).toBe(1));
    expect((await db.matches.toArray())[0]).toMatchObject({
      opponent: 'Bianchi', player_ranking_snapshot: 7, opponent_ranking_snapshot: 8,
    });
  });
});

async function openWizardAtStep3() {
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
  await within(wizard).findByText('4.1');
  fireEvent.change(within(wizard).getByLabelText('Data partita'), { target: { value: '2026-11-30' } });
  fireEvent.change(within(wizard).getByLabelText('Ora (facoltativa)'), { target: { value: '10:00' } });
  await user.type(within(wizard).getByLabelText('Avversario'), 'Gialli');
  await user.click(within(wizard).getByRole('button', { name: 'Avanti' }));
  return { user, wizard };
}

describe('Nuova partita: passo 3 e partite in programma', () => {
  it('shows the summary and "Decidi dopo" by default, without the Indietro button', async () => {
    const { user, wizard } = await openWizardAtStep3();
    expect(within(wizard).getByText('Rossi vs Gialli')).toBeTruthy();
    expect(within(wizard).getByText(/lun 30 nov · 10:00 · Open estivo/)).toBeTruthy();
    expect(within(wizard).getByRole('button', { name: 'Decidi dopo' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(wizard).getByText(/Lo indicherai quando avvii la partita/)).toBeTruthy();
    // Only the header arrow goes back: no "Indietro" button at the bottom.
    expect(within(wizard).getAllByRole('button', { name: 'Indietro' }).map(button => button.className)).toEqual(['cw-back']);
    expect(within(wizard).getByRole('button', { name: 'Salva in programma' })).toBeTruthy();
    expect(within(wizard).getByRole('button', { name: 'Avvia subito' })).toBeTruthy();
    expect(within(wizard).queryByRole('button', { name: 'Avvia partita' })).toBeNull();
    // Choosing a server swaps the buttons and the help text.
    await user.click(within(wizard).getByRole('button', { name: 'Gialli' }));
    expect(within(wizard).getByText(/Serve Gialli il primo game/)).toBeTruthy();
    expect(within(wizard).getByRole('button', { name: 'Avvia partita' })).toBeTruthy();
    expect(within(wizard).getByRole('button', { name: 'Salva in programma' })).toBeTruthy();
  });

  it('saves an upcoming match without a server and lists it under In programma', async () => {
    const { user, wizard } = await openWizardAtStep3();
    await user.click(within(wizard).getByRole('button', { name: 'Salva in programma' }));
    await waitFor(async () => expect(await db.matches.count()).toBe(1));
    expect((await db.matches.toArray())[0]).toMatchObject({
      status_id: 1, first_server: null, match_date: '2026-11-30', match_time: '10:00', started_at: null,
    });
    // Back to the Partite list, with the match in the In programma section.
    const section = await screen.findByRole('region', { name: 'In programma' });
    expect(within(section).getByText('Rossi vs Gialli')).toBeTruthy();
    expect(within(section).getByText('Servizio: da decidere')).toBeTruthy();
  });

  it('saves an upcoming match with the server chosen in the wizard', async () => {
    const { user, wizard } = await openWizardAtStep3();
    await user.click(within(wizard).getByRole('button', { name: 'Rossi' }));
    await user.click(within(wizard).getByRole('button', { name: 'Salva in programma' }));
    await waitFor(async () => expect(await db.matches.count()).toBe(1));
    expect((await db.matches.toArray())[0]).toMatchObject({ status_id: 1, first_server: 'player' });
    expect(await screen.findByText('Servizio: Ale Rossi')).toBeTruthy();
  });

  it('starts the match right away when the server is chosen in the wizard', async () => {
    const { user, wizard } = await openWizardAtStep3();
    await user.click(within(wizard).getByRole('button', { name: 'Gialli' }));
    await user.click(within(wizard).getByRole('button', { name: 'Avvia partita' }));
    await waitFor(async () => expect(await db.matches.count()).toBe(1));
    const [match] = await db.matches.toArray();
    expect(match).toMatchObject({ status_id: 2, first_server: 'opponent' });
    expect(match.started_at).toBe(match.created_at);
  });

  it('"Avvia subito" asks who serves and saves nothing until it is confirmed', async () => {
    const { user, wizard } = await openWizardAtStep3();
    await user.click(within(wizard).getByRole('button', { name: 'Avvia subito' }));
    let sheet = await screen.findByRole('dialog', { name: 'Chi serve per primo?' });
    expect((within(sheet).getByRole('button', { name: 'Scegli chi serve per iniziare' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(sheet).getByRole('button', { name: 'Chiudi' }));
    expect(await db.matches.count()).toBe(0);

    await user.click(within(wizard).getByRole('button', { name: 'Avvia subito' }));
    sheet = await screen.findByRole('dialog', { name: 'Chi serve per primo?' });
    await user.click(within(sheet).getByRole('button', { name: /Ale Rossi/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Inizia partita' }));
    await waitFor(async () => expect(await db.matches.count()).toBe(1));
    expect((await db.matches.toArray())[0]).toMatchObject({ status_id: 2, first_server: 'player' });
  });
});
