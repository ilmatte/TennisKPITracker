import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import TennisApp from '../TennisApp';
import { AuthContext } from '../features/auth/AuthContext';
import { FamilyProvider } from '../features/families/FamilyContext';
import { useFamily } from '../features/families/FamilyContextDefinition';
import { db, ensureLocalWorkspace } from './database';
import type { Family, Game, Match, Player, Point, TennisSet } from '../types';

const now = '2026-01-01T10:00:00.000Z';

function localFamily(id: string, created_at = now): Family {
  return {
    id,
    name: id,
    created_at,
    updated_at: created_at,
    created_by: null,
    local_only: true,
  };
}

beforeEach(async () => {
  await db.transaction('rw', [
    db.families, db.family_members, db.family_invitations,
    db.players, db.clubs, db.tournaments, db.matches, db.sets, db.games, db.points, db.syncQueue,
  ], async () => {
    await Promise.all([
      db.families.clear(), db.family_members.clear(), db.family_invitations.clear(),
      db.players.clear(), db.clubs.clear(), db.tournaments.clear(), db.matches.clear(), db.sets.clear(), db.games.clear(),
      db.points.clear(), db.syncQueue.clear(),
    ]);
  });
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
});

afterEach(() => cleanup());

function renderOfflineApp() {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: null, loading: false }}>
        <FamilyProvider><TennisApp /><WorkspaceProbe /></FamilyProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

function WorkspaceProbe() {
  const { activeFamily } = useFamily();
  return <output data-testid="active-workspace">{activeFamily?.id ?? ''}</output>;
}

describe('automatic local workspace', () => {
  it('creates one anonymous local workspace on an empty offline first launch', async () => {
    const user = userEvent.setup();
    localStorage.setItem('tennis-kpi-active-workspace', 'obsolete-workspace-id');
    renderOfflineApp();

    expect(await screen.findByText('Nessuna partita')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Giocatori' })).toBeTruthy();
    expect(screen.queryByText(/Crea o seleziona uno spazio dati/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Famiglia' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Spazio attivo' })).toBeNull();
    expect(screen.queryByText(/Crea spazio solo locale|Crea famiglia condivisa/)).toBeNull();
    expect(await db.families.count()).toBe(1);

    const [workspace] = await db.families.toArray();
    expect(workspace).toMatchObject({
      local_only: true,
      created_by: null,
      name: 'Tennis KPI Tracker',
    });
    expect(workspace.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(await db.family_members.count()).toBe(0);

    await user.click(screen.getByRole('link', { name: 'Giocatori' }));
    await user.click(screen.getByRole('button', { name: 'Aggiungi giocatore' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Ada');
    await user.type(screen.getByRole('textbox', { name: 'Cognome' }), 'Lovelace');
    await user.click(screen.getByRole('button', { name: 'Salva' }));

    const player = await waitFor(async () => {
      const saved = await db.players.toCollection().first();
      expect(saved).toBeDefined();
      return saved as Player;
    });
    expect(player.family_id).toBe(workspace.id);
    expect(await db.syncQueue.where('entity_id').equals(player.id).count()).toBe(1);
  });

  it('is idempotent under repeated and concurrent startup calls', async () => {
    const workspaces = await Promise.all([
      ensureLocalWorkspace(),
      ensureLocalWorkspace(),
      ensureLocalWorkspace(),
    ]);

    expect(new Set(workspaces.map(workspace => workspace.id)).size).toBe(1);
    expect(await db.families.count()).toBe(1);
    expect((await ensureLocalWorkspace()).id).toBe(workspaces[0].id);
  });

  it('reports duplicate local workspaces without selecting one or changing records', async () => {
    await db.families.bulkAdd([
      localFamily('workspace-later', '2026-01-02T10:00:00.000Z'),
      localFamily('workspace-earlier', '2026-01-01T10:00:00.000Z'),
    ]);
    const player: Player = {
      id: 'existing-player-id',
      family_id: 'workspace-later',
      first_name: 'Ada',
      last_name: 'Lovelace',
      birth_date: null,
      ranking: '',
      created_at: now,
      updated_at: now,
      version: 1,
      deleted: false,
    };
    const match: Match = {
      id: 'existing-match-id',
      family_id: 'workspace-later',
      match_date: '2026-01-01',
      player_id: player.id,
      player_ranking_snapshot: player.ranking,
     
      opponent: 'Opponent',
      number_of_sets: 3,
      third_set_type: 'normal',
      super_tiebreak_target: 10,
      tiebreak_target: 7,
      tiebreak_starts_at_363: true,
      deuce_single_point: true,
      first_server: 'player',
      status: 'in-progress',
      created_at: now,
      updated_at: now,
      version: 1,
      deleted: false,
    };
    const set: TennisSet = {
      id: 'existing-set-id', family_id: match.family_id, match_id: match.id, set_number: 1,
      player_games: 0, opponent_games: 0, created_at: now, updated_at: now, version: 1, deleted: false,
    };
    const game: Game = {
      id: 'existing-game-id', family_id: match.family_id, set_id: set.id, game_number: 1,
      player_points: 0, opponent_points: 0, created_at: now, updated_at: now, version: 1, deleted: false,
    };
    const point: Point = {
      id: 'existing-point-id', family_id: match.family_id, game_id: game.id, point_number: 1,
      won: true, serving: true, second_serve: false, point_type_id: 4, shot_count: 1,
      created_at: now, updated_at: now, version: 1, deleted: false,
    };
    await db.players.add(player);
    await db.matches.add(match);
    await db.sets.add(set);
    await db.games.add(game);
    await db.points.add(point);

    const view = renderOfflineApp();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Incoerenza nei dati locali: trovati 2 workspace locali.',
    );
    view.unmount();

    await expect(ensureLocalWorkspace()).rejects.toThrow(
      'Incoerenza nei dati locali: trovati 2 workspace locali.',
    );
    expect(await db.families.count()).toBe(2);
    expect(await db.families.get('workspace-later')).toEqual(
      localFamily('workspace-later', '2026-01-02T10:00:00.000Z'),
    );
    expect(await db.players.get(player.id)).toEqual(player);
    expect(await db.matches.get(match.id)).toEqual(match);
    expect(await db.sets.get(set.id)).toEqual(set);
    expect(await db.games.get(game.id)).toEqual(game);
    expect(await db.points.get(point.id)).toEqual(point);
  });

  it('keeps player, match, set, game and point IDs unchanged after app reopen', async () => {
    const user = userEvent.setup();
    const view = renderOfflineApp();
    await screen.findByText('Nessuna partita');

    await user.click(screen.getByRole('link', { name: 'Giocatori' }));
    await user.click(screen.getByRole('button', { name: 'Aggiungi giocatore' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Ada');
    await user.type(screen.getByRole('textbox', { name: 'Cognome' }), 'Lovelace');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await screen.findByText('Ada Lovelace');

    await user.click(screen.getByRole('link', { name: 'Le mie partite' }));
    await user.click(screen.getByRole('button', { name: 'Nuova partita' }));
    // Step 1: no tournament yet, so create one; with no clubs the new-club fields are shown directly.
    expect(await screen.findByText('Nessun torneo')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Avanti/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Crea un nuovo torneo' }));
    expect(screen.getAllByRole('button', { name: /^(U12|U14|U16|U18|Open)$/ }).map(chip => chip.textContent))
      .toEqual(['U12', 'U14', 'U16', 'U18', 'Open']);
    await user.type(screen.getByPlaceholderText('Nome del nuovo club'), 'TC Lambrate');
    await user.type(screen.getByLabelText('Nome torneo'), 'Torneo di primavera');
    await user.click(screen.getByRole('button', { name: 'U14' }));
    await user.click(screen.getByRole('button', { name: 'Crea torneo' }));
    // Back to the wizard with the new tournament selected.
    expect((await screen.findByRole('radio', { name: /Torneo di primavera/ })).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('dialog', { name: 'Nuovo torneo' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Avanti/ }));
    // Step 2: who plays.
    const savedPlayer = await db.players.toCollection().first();
    await user.selectOptions(screen.getByLabelText('Giocatore'), savedPlayer!.id);
    await user.type(screen.getByLabelText('Avversario'), 'Avversaria');
    await user.click(screen.getByRole('button', { name: /Avanti/ }));
    // Step 3: rules.
    await user.selectOptions(screen.getByLabelText('Game per vincere il set'), '6');
    await user.click(screen.getByRole('button', { name: 'Avvia partita' }));
    await waitFor(async () => expect(await db.matches.count()).toBe(1));
    const savedMatch = await db.matches.toCollection().first();
    const savedClub = await db.clubs.toCollection().first();
    const savedTournament = await db.tournaments.toCollection().first();
    expect(savedClub).toMatchObject({ name: 'TC Lambrate' });
    expect(savedTournament).toMatchObject({ name: 'Torneo di primavera', club_id: savedClub!.id, age_category_id: 2 });
    expect(savedMatch).toMatchObject({ tournament_id: savedTournament!.id, opponent: 'Avversaria', games_to_win_set: 6 });
    expect(await db.matches.get(savedMatch!.id)).toEqual(savedMatch);
    expect(savedMatch?.family_id).toBe(screen.getByTestId('active-workspace').textContent);
    const set: TennisSet = {
      id: crypto.randomUUID(), family_id: savedMatch!.family_id, match_id: savedMatch!.id,
      set_number: 1, player_games: 0, opponent_games: 0,
      created_at: now, updated_at: now, version: 1, deleted: false,
    };
    const game: Game = {
      id: crypto.randomUUID(), family_id: savedMatch!.family_id, set_id: set.id,
      game_number: 1, player_points: 1, opponent_points: 0,
      created_at: now, updated_at: now, version: 1, deleted: false,
    };
    const point: Point = {
      id: crypto.randomUUID(), family_id: savedMatch!.family_id, game_id: game.id,
      point_number: 1, won: true, serving: true, second_serve: false,
      point_type_id: 4, shot_count: 1,
      created_at: now, updated_at: now, version: 1, deleted: false,
    };
    await db.transaction('rw', [db.sets, db.games, db.points, db.syncQueue], async () => {
      await db.sets.add(set);
      await db.games.add(game);
      await db.points.add(point);
      await db.syncQueue.bulkAdd([
        { id: crypto.randomUUID(), family_id: set.family_id, entity_type: 'sets', entity_id: set.id, operation: 'upsert', payload: set, created_at: now, attempts: 0 },
        { id: crypto.randomUUID(), family_id: game.family_id, entity_type: 'games', entity_id: game.id, operation: 'upsert', payload: game, created_at: now, attempts: 0 },
        { id: crypto.randomUUID(), family_id: point.family_id, entity_type: 'points', entity_id: point.id, operation: 'upsert', payload: point, created_at: now, attempts: 0 },
      ]);
    });

    const before = {
      player: (await db.players.toCollection().first())?.id,
      match: (await db.matches.toCollection().first())?.id,
      set: (await db.sets.toCollection().first())?.id,
      game: (await db.games.toCollection().first())?.id,
      point: (await db.points.toCollection().first())?.id,
      family: (await db.families.toCollection().first())?.id,
    };

    view.unmount();
    renderOfflineApp();
    expect(await screen.findByRole('button', { name: /Avversaria/ })).toBeTruthy();
    expect(await db.families.count()).toBe(1);
    expect({
      player: (await db.players.toCollection().first())?.id,
      match: (await db.matches.toCollection().first())?.id,
      set: (await db.sets.toCollection().first())?.id,
      game: (await db.games.toCollection().first())?.id,
      point: (await db.points.toCollection().first())?.id,
      family: (await db.families.toCollection().first())?.id,
    }).toEqual(before);
    expect((await db.families.toArray()).every(family => family.local_only)).toBe(true);
  });
});
