import './Players.css';
import { useEffect, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMatchPoints } from '../db/database';
import { deriveSetScore } from '../features/scoring/scoring';
import { createPlayer, softDeletePlayer, updatePlayer } from '../db/sportsMutations';
import { useAuth } from '../features/auth/AuthContext';
import { useFamily } from '../features/families/FamilyContextDefinition';
import { STATUS } from '../features/statuses/statuses';
import tennisBallIcon from '../assets/icone/trasparente/512/pallina3d.png';
import settingsBackground from '../assets/background-settings.png';
import { stamp } from './shared';
import { BrandBar } from './BrandBar';
import { currentSportingYear, playerAgeCategory } from '../features/players/ageCategories';
import { fitpRankingCode } from '../features/players/fitpRankings';
import { FitpRankingOptions } from './FitpRankingOptions';
import { fitpRankingValue, useFitpRankings } from '../features/players/useFitpRankings';
import type { FitpRanking, Player } from '../types';

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
  // Per player: matches played, completed and won (won = more sets than the opponent).
  const playerStats = useLiveQuery(async () => {
    const stats = new Map<string, { played: number; completed: number; won: number }>();
    if (!activeFamily) return stats;
    const matches = (await db.matches.where('family_id').equals(activeFamily.id).toArray()).filter(match => !match.deleted);
    for (const match of matches) {
      const entry = stats.get(match.player_id) ?? { played: 0, completed: 0, won: 0 };
      entry.played += 1;
      if (match.status_id === STATUS.completed) {
        entry.completed += 1;
        const points = await getMatchPoints(activeFamily.id, match.id);
        let playerSets = 0;
        let opponentSets = 0;
        for (let setNumber = 1; setNumber <= match.number_of_sets; setNumber += 1) {
          const score = deriveSetScore(points, setNumber, match);
          if (score.player > score.opponent) playerSets += 1;
          if (score.opponent > score.player) opponentSets += 1;
        }
        if (playerSets > opponentSets) entry.won += 1;
      }
      stats.set(match.player_id, entry);
    }
    return stats;
  }, [activeFamily?.id]) ?? new Map<string, { played: number; completed: number; won: number }>();
  const rankings = useFitpRankings();
  const [editing, setEditing] = useState<Player | null>(null);
  const [origin, setOrigin] = useState<EditorOrigin>('players');
  const [error, setError] = useState<string | null>(null);

  function blankPlayer(familyId: string): Player {
    const now = stamp();
    return {
      id: crypto.randomUUID(), family_id: familyId, first_name: '', last_name: '',
      birth_date: null, ranking_id: null, created_at: now, updated_at: now, version: 0, deleted: false,
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
          ranking_id: player.ranking_id,
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
    {players.length > 0 && players.length <= 2
      ? <div className="pl-big-list">{players.map(player => {
        const stats = playerStats.get(player.id) ?? { played: 0, completed: 0, won: 0 };
        const rankingCode = fitpRankingCode(player.ranking_id, rankings);
        const details = [playerAgeCategory(player)?.name, rankingCode && `FITP ${rankingCode}`].filter(Boolean).join(' • ');
        return <button className="pl-big-card" key={player.id} onClick={() => edit(player)}>
          <span className="pl-big-head">
            <span className="pl-avatar big">{player.first_name[0]}{player.last_name[0]}</span>
            <span className="pl-text"><strong className="big">{player.first_name} {player.last_name}</strong><small>{details || 'Nessuna categoria'}</small></span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </span>
          <span className="pl-stats">
            <span><b>{stats.played}</b><small>Partite</small></span>
            <i aria-hidden="true" />
            <span><b className="won">{stats.won}</b><small>Vinte</small></span>
            <i aria-hidden="true" />
            <span><b>{stats.completed ? `${Math.round((stats.won / stats.completed) * 100)}%` : '—'}</b><small>Vittorie</small></span>
          </span>
        </button>;
      })}</div>
      : <section className="pl-card">
        {players.map(player => {
          const count = playerStats.get(player.id)?.played ?? 0;
          return <button className="pl-row" key={player.id} onClick={() => edit(player)}>
            <span className="pl-avatar">{player.first_name[0]}{player.last_name[0]}</span>
            <span className="pl-text"><strong>{player.first_name} {player.last_name}</strong><small>{count === 1 ? '1 partita' : `${count} partite`}</small></span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>;
        })}
        {!players.length && <div className="pl-empty"><strong>Nessun giocatore</strong><span>Aggiungi il primo giocatore per iniziare.</span></div>}
      </section>}
    <button className={`pl-add${players.length > 0 && players.length <= 2 ? ' compact' : ''}`} onClick={add} disabled={!activeFamily}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      Aggiungi giocatore
    </button>
    {editing && <PlayerModal player={editing} rankings={rankings} error={error} onClose={() => setEditing(null)} onSave={save}
      onDelete={editing.version > 0 ? () => void remove(editing) : undefined} />}
  </div>;
}

function PlayerModal({ player, rankings, error, onClose, onSave, onDelete }: {
  player: Player;
  rankings: readonly FitpRanking[];
  error: string | null;
  onClose: () => void;
  onSave: (player: Player) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(player);
  const sportingYear = currentSportingYear();
  const ageCategory = playerAgeCategory(draft, sportingYear);
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
        {/* The age category is not entered: it is computed from the birth date for the current sporting year. */}
        {draft.birth_date && <p className="player-editor-category" role="status">
          Categoria {sportingYear}: <strong>{ageCategory ? ageCategory.name : 'nessuna (meno di 10 anni)'}</strong>
        </p>}
        <label>Classifica FITP
          <select className="player-editor-select" value={draft.ranking_id ?? ''}
            onChange={event => setDraft({ ...draft, ranking_id: fitpRankingValue(event.target.value) })}>
            <FitpRankingOptions rankings={rankings} value={draft.ranking_id} />
          </select>
        </label>
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
