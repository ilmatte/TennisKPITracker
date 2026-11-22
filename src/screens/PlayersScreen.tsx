import './Players.css';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { createPlayer, softDeletePlayer, updatePlayer } from '../db/sportsMutations';
import { useAuth } from '../features/auth/AuthContext';
import { useFamily } from '../features/families/FamilyContextDefinition';
import tennisBallIcon from '../assets/icone/trasparente/512/pallina3d.png';
import { stamp } from './shared';
import type { Player } from '../types';
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
  const [editing, setEditing] = useState<Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [continueToMatch, setContinueToMatch] = useState(Boolean((location.state as { createMatchAfterPlayer?: boolean } | null)?.createMatchAfterPlayer));

  useEffect(() => {
    const state = location.state as { createMatchAfterPlayer?: boolean } | null;
    if (state?.createMatchAfterPlayer) setContinueToMatch(true);
    if (state?.createMatchAfterPlayer && activeFamily && !players.length && !editing) {
      const now = stamp();
      setEditing({
        id: crypto.randomUUID(), family_id: activeFamily.id, first_name: '', last_name: '',
        birth_date: null, category: '', ranking: '', created_at: now, updated_at: now, version: 0, deleted: false,
      });
      navigate('/players', { replace: true, state: null });
    }
  }, [location.state, activeFamily, players.length, editing, navigate]);

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
      if (continueToMatch) {
        navigate('/', { state: { openNewMatch: true, initialPlayerId: player.id } });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile salvare il giocatore.');
    }
  }

  function add() {
    if (!activeFamily) return;
    const now = stamp();
    setEditing({
      id: crypto.randomUUID(), family_id: activeFamily.id, first_name: '', last_name: '',
      birth_date: null, category: '', ranking: '', created_at: now, updated_at: now, version: 0, deleted: false,
    });
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

  return <div className="page">
    <div className="page-heading"><div><p className="eyebrow">Anagrafica</p><h1>Giocatori</h1></div><button className="primary" onClick={add}>+ Aggiungi</button></div>
    <div className="player-list">{players.map(player => <div className="player-row" key={player.id}>
      <button className="player-row-open" onClick={() => setEditing(player)}>
        <div className="avatar">{player.first_name[0]}{player.last_name[0]}</div>
        <div><strong>{player.first_name} {player.last_name}</strong><span>{player.category || 'Nessuna categoria'} · {player.ranking || 'Nessuna classifica'}</span></div>
      </button>
      <div className="record-actions"><button className="secondary" onClick={() => setEditing(player)}>Modifica</button>
        <button className="danger" onClick={() => void remove(player)}>Elimina</button></div>
    </div>)}</div>
    {!players.length && <div className="empty-state"><strong>Nessun giocatore</strong><span>Aggiungi manualmente il primo giocatore.</span></div>}
    {editing && <PlayerModal player={editing} error={error} onClose={() => setEditing(null)} onSave={save} />}
  </div>;
}

function PlayerModal({ player, error, onClose, onSave }: {
  player: Player;
  error: string | null;
  onClose: () => void;
  onSave: (player: Player) => void;
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
      </div>
    </div>
  </section></div>;
}
