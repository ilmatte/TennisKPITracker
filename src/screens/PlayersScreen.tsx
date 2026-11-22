import './Players.css';
import { useEffect, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { createPlayer, softDeletePlayer, updatePlayer } from '../db/sportsMutations';
import { useAuth } from '../features/auth/AuthContext';
import { useFamily } from '../features/families/FamilyContextDefinition';
import tennisBallIcon from '../assets/icone/trasparente/512/pallina3d.png';
import settingsBackground from '../assets/background-settings.png';
import { stamp } from './shared';
import { BrandBar } from './BrandBar';
import type { Player } from '../types';

/** Where the player editor was opened from: decides where "Salva" goes next. */
type EditorOrigin = 'new-match' | 'players';

export function Players() {
  const { activeFamily } = useFamily();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const players = useLiveQuery(
    async () => activeFamily
      ? (await db.players.where('family_id').equals(activeFamily.id).toArray()).filter(player => !player.deleted)
      : [],
    [activeFamily?.id],
  ) ?? [];
  const matchCounts = useLiveQuery(async () => {
    const counts = new Map<string, number>();
    if (!activeFamily) return counts;
    for (const match of await db.matches.where('family_id').equals(activeFamily.id).toArray()) {
      if (!match.deleted) counts.set(match.player_id, (counts.get(match.player_id) ?? 0) + 1);
    }
    return counts;
  }, [activeFamily?.id]) ?? new Map<string, number>();
  const [editing, setEditing] = useState<Player | null>(null);
  const [origin, setOrigin] = useState<EditorOrigin>('players');
  const [error, setError] = useState<string | null>(null);

  function blankPlayer(familyId: string): Player {
    const now = stamp();
    return {
      id: crypto.randomUUID(), family_id: familyId, first_name: '', last_name: '',
      birth_date: null, category: '', ranking: '', created_at: now, updated_at: now, version: 0, deleted: false,
    };
  }

  // Opened from the "Nuova partita" button (no players yet): open the editor straight away.
  useEffect(() => {
    const state = location.state as { createMatchAfterPlayer?: boolean } | null;
    if (state?.createMatchAfterPlayer && activeFamily) {
      setOrigin('new-match');
      setError(null);
      setEditing(blankPlayer(activeFamily.id));
      navigate('/players', { replace: true, state: null });
    }
  }, [location.state, activeFamily, navigate]);

  async function save(player: Player) {
    if (!activeFamily || player.family_id !== activeFamily.id) {
      setError('Lo spazio dati è cambiato: riapri la scheda e riprova.');
      return;
    }
    try {
      const existing = await db.players.get(player.id);
      if (existing) {
        await updatePlayer(activeFamily.id, player.id, {
          first_name: player.first_name,
          last_name: player.last_name,
          birth_date: player.birth_date,
          category: player.category,
          ranking: player.ranking,
        });
      } else {
        await createPlayer({ ...player, version: 1 }, user?.id ?? null);
      }
      setError(null);
      setEditing(null);
      if (origin === 'new-match') {
        navigate('/', { state: { openNewMatch: true, initialPlayerId: player.id } });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile salvare il giocatore.');
    }
  }

  function add() {
    if (!activeFamily) return;
    setOrigin('players');
    setError(null);
    setEditing(blankPlayer(activeFamily.id));
  }

  function edit(player: Player) {
    setOrigin('players');
    setError(null);
    setEditing(player);
  }

  async function remove(player: Player) {
    if (!activeFamily || player.family_id !== activeFamily.id) {
      setError('Lo spazio dati è cambiato: riapri la scheda e riprova.');
      return;
    }
    if (!window.confirm('Eliminare logicamente questo giocatore? Le partite storiche e i relativi snapshot resteranno invariati.')) return;
    try {
      await softDeletePlayer(activeFamily.id, player.id);
      setError(null);
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile eliminare il giocatore.');
    }
  }

  return <div className="pl-page" style={{ '--pl-bg': `url(${settingsBackground})` } as CSSProperties}>
    <div className="pl-top" aria-hidden="true" />
    <BrandBar shadow />
    <button className="pl-back" onClick={() => navigate('/settings')} aria-label="Indietro">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <h1 className="pl-title">Giocatori</h1>
    <section className="pl-card">
      {players.map(player => {
        const count = matchCounts.get(player.id) ?? 0;
        return <button className="pl-row" key={player.id} onClick={() => edit(player)}>
          <span className="pl-avatar">{player.first_name[0]}{player.last_name[0]}</span>
          <span className="pl-text"><strong>{player.first_name} {player.last_name}</strong><small>{count === 1 ? '1 partita' : `${count} partite`}</small></span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>;
      })}
      {!players.length && <div className="pl-empty"><strong>Nessun giocatore</strong><span>Aggiungi il primo giocatore per iniziare.</span></div>}
    </section>
    <button className="pl-add" onClick={add} disabled={!activeFamily}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      Aggiungi giocatore
    </button>
    {editing && <PlayerModal player={editing} error={error} onClose={() => setEditing(null)} onSave={save}
      onDelete={editing.version > 0 ? () => void remove(editing) : undefined} />}
  </div>;
}

function PlayerModal({ player, error, onClose, onSave, onDelete }: {
  player: Player;
  error: string | null;
  onClose: () => void;
  onSave: (player: Player) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(player);
  const editingExisting = Boolean(draft.first_name || draft.last_name || draft.version > 0);
  return <div className="player-editor-backdrop"><section className="player-editor" role="dialog" aria-modal="true" aria-label={editingExisting ? 'Modifica giocatore' : 'Nuovo giocatore'}>
    <header className="player-editor-header">
      <img className="player-editor-ball" src={tennisBallIcon} alt="" />
      <button className="player-editor-back" onClick={onClose} aria-label="Indietro">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
      </button>
      <h1>{editingExisting ? 'Modifica giocatore' : 'Nuovo giocatore'}</h1>
    </header>
    <div className="player-editor-panel">
      <div className="player-editor-fields">
        <div className="player-editor-row">
          <label>Nome<input autoComplete="given-name" value={draft.first_name} onChange={event => setDraft({ ...draft, first_name: event.target.value })} /></label>
          <label>Cognome<input autoComplete="family-name" value={draft.last_name} onChange={event => setDraft({ ...draft, last_name: event.target.value })} /></label>
        </div>
        <label>Data di nascita<input type="date" value={draft.birth_date ?? ''} onChange={event => setDraft({ ...draft, birth_date: event.target.value || null })} /></label>
        <div className="player-editor-row">
          <label>Categoria<input value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })} /></label>
          <label>Classifica FITP<input value={draft.ranking} onChange={event => setDraft({ ...draft, ranking: event.target.value })} /></label>
        </div>
      </div>
      {error && <p className="family-feedback error" role="alert">{error}</p>}
      <div className="player-editor-actions">
        <button className="player-editor-save" disabled={!draft.first_name.trim()} onClick={() => onSave(draft)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>Salva
        </button>
        <button className="player-editor-cancel" onClick={onClose}>Annulla</button>
        {onDelete && <button className="player-editor-delete" onClick={onDelete}>Elimina giocatore</button>}
      </div>
    </div>
  </section></div>;
}
