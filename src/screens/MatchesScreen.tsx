import './Matches.css';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMatchPoints } from '../db/database';
import { deriveSetScore } from '../features/scoring/scoring';
import { countMatchDescendants, softDeleteMatch, updateMatch, type MatchChanges } from '../db/sportsMutations';
import { useFamily } from '../features/families/FamilyContextDefinition';
import tennisBallIcon from '../assets/icone/trasparente/512/pallina3d.png';
import { stamp, queueOperation } from './shared';
import type { Match } from '../types';
export function Matches() {
  const { activeFamily } = useFamily();
  const matches = useLiveQuery(
    async () => activeFamily
      ? (await db.matches.where('family_id').equals(activeFamily.id).toArray())
          .filter(match => !match.deleted).sort((a, b) => b.match_date.localeCompare(a.match_date))
      : [],
    [activeFamily?.id],
  ) ?? [];
  const matchOutcomes = useLiveQuery(async () => {
    if (!activeFamily) return [] as { id: string; won: boolean }[];
    return (await Promise.all(matches.map(async match => {
      const points = await getMatchPoints(activeFamily.id, match.id);
      let playerSets = 0;
      let opponentSets = 0;
      for (let setNumber = 1; setNumber <= match.number_of_sets; setNumber += 1) {
        const setScore = deriveSetScore(points, setNumber, match);
        if (setScore.player > setScore.opponent) playerSets += 1;
        if (setScore.opponent > setScore.player) opponentSets += 1;
      }
      return { id: match.id, won: playerSets > opponentSets };
    }))).filter(item => matches.find(match => match.id === item.id)?.status === 'completed');
  }, [activeFamily?.id, matches.map(match => match.id).join(',')]) ?? [];
  const [newOpen, setNewOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'won' | 'lost'>('all');
  const [editing, setEditing] = useState<Match | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const players = useLiveQuery(
    async () => activeFamily
      ? (await db.players.where('family_id').equals(activeFamily.id).toArray()).filter(player => !player.deleted)
      : [],
    [activeFamily?.id],
  ) ?? [];

  function openNewMatch() {
    if (!players.length) {
      navigate('/players', { state: { createMatchAfterPlayer: true } });
      return;
    }
    setNewOpen(true);
  }

  async function remove(match: Match) {
    if (!activeFamily) return;
    try {
      const count = await countMatchDescendants(activeFamily.id, match.id);
      const detail = `${count.sets} set, ${count.games} game e ${count.points} punti dipendenti`;
      if (!window.confirm(`Eliminare logicamente questa partita? Verranno marcati come cancellati anche ${detail}.`)) return;
      await softDeleteMatch(activeFamily.id, match.id);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile eliminare la partita.');
    }
  }

  const wonIds = new Set(matchOutcomes.filter(outcome => outcome.won).map(outcome => outcome.id));
  const lostIds = new Set(matchOutcomes.filter(outcome => !outcome.won).map(outcome => outcome.id));
  const visibleMatches = matches.filter(match => {
    if (filter === 'won') return wonIds.has(match.id);
    if (filter === 'lost') return lostIds.has(match.id);
    return true;
  });

  return <div className="page archive-page">
    <div className="page-heading"><div><p className="eyebrow">Archivio</p><h1>Le mie partite</h1></div><button className="primary" onClick={openNewMatch}>+ Nuova partita</button></div>
    <div className="archive-tabs" aria-label="Filtra partite">
      <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Tutte</button>
      <button className={filter === 'won' ? 'active' : ''} onClick={() => setFilter('won')}>Vinte</button>
      <button className={filter === 'lost' ? 'active' : ''} onClick={() => setFilter('lost')}>Perse</button>
    </div>
    {newOpen && <NewMatch onClose={() => setNewOpen(false)} />}
    {error && <p className="family-feedback error" role="alert">{error}</p>}
    <div className="match-list">
      {visibleMatches.map(match => <MatchCard key={match.id} match={match} open={() => navigate(`/match/${match.id}`)}
        onEdit={() => { setError(null); setEditing(match); }} onDelete={() => void remove(match)} />)}
      {!matches.length && <div className="empty-state"><strong>Nessuna partita</strong><span>Crea la prima partita per iniziare il tracking.</span></div>}
    </div>
    {editing && <MatchEditor match={editing} error={error} onClose={() => setEditing(null)} onSave={async changes => {
      if (!activeFamily) return;
      try {
        await updateMatch(activeFamily.id, editing.id, changes);
        setEditing(null);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Impossibile salvare la partita.');
      }
    }} />}
  </div>;
}

function MatchCard({ match, open, onEdit, onDelete }: {
  match: Match;
  open: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const points = useLiveQuery(() => getMatchPoints(match.family_id, match.id), [match.family_id, match.id]) ?? [];
  return <article className="match-card">
    <button className="match-card-open" onClick={open}>
    <div className="match-card-top"><span className={`chip ${match.status}`}>{match.status === 'completed' ? 'Terminata' : 'In corso'}</span><span>{new Date(match.match_date).toLocaleDateString('it-IT')}</span></div>
    <strong>{match.player_first_name_snapshot} {match.player_last_name_snapshot} <span>vs</span> {match.opponent}</strong>
    <div className="match-meta"><span>{match.player_ranking_snapshot} · {match.player_category_snapshot}</span><span>{match.tournament || 'Amichevole'}</span></div>
    <div className="set-scores">{[1, 2, 3].map(number => {
      const score = deriveSetScore(points, number, match);
      return <span key={number}>{score.player}-{score.opponent}</span>;
    })}</div>
    </button>
    <div className="record-actions"><button className="secondary" onClick={onEdit}>Modifica</button><button className="danger" onClick={onDelete}>Elimina</button></div>
  </article>;
}

export function MatchEditor({ match, error, onClose, onSave }: {
  match: Match;
  error: string | null;
  onClose: () => void;
  onSave: (changes: MatchChanges) => void;
}) {
  const { activeFamily } = useFamily();
  const players = useLiveQuery(async () => activeFamily
    ? (await db.players.where('family_id').equals(activeFamily.id).toArray()).filter(player => !player.deleted)
    : [], [activeFamily?.id]) ?? [];
  const [draft, setDraft] = useState<Match>(match);
  const field = <K extends keyof Match>(key: K, value: Match[K]) => setDraft(current => ({ ...current, [key]: value }));

  return <div className="modal-backdrop"><div className="modal-sheet">
    <div className="modal-heading"><h2>Modifica partita</h2><button className="icon-button" onClick={onClose}>×</button></div>
    <label>Data partita<input type="date" value={draft.match_date} onChange={event => field('match_date', event.target.value)} /></label>
    <label>Giocatore<select value={draft.player_id} onChange={event => field('player_id', event.target.value)}>
      {!players.some(player => player.id === match.player_id) && <option value={match.player_id}>{match.player_first_name_snapshot} {match.player_last_name_snapshot} (storico)</option>}
      {players.map(player => <option key={player.id} value={player.id}>{player.first_name} {player.last_name}</option>)}
    </select></label>
    <p className="snapshot-preview"><small>Lo snapshot viene aggiornato solo per la partita selezionata.</small></p>
    <div className="form-grid">
      <label>Avversario<input value={draft.opponent} onChange={event => field('opponent', event.target.value)} /></label>
      <label>Classifica avversario<input value={draft.opponent_ranking ?? ''} onChange={event => field('opponent_ranking', event.target.value || null)} /></label>
    </div>
    <div className="form-grid">
      <label>Categoria avversario<input value={draft.opponent_category ?? ''} onChange={event => field('opponent_category', event.target.value || null)} /></label>
      <label>Torneo<input value={draft.tournament ?? ''} onChange={event => field('tournament', event.target.value || null)} /></label>
    </div>
    <div className="form-grid">
      <label>Numero partita<input type="number" min="1" value={draft.tournament_match_number ?? ''} onChange={event => field('tournament_match_number', event.target.value ? Number(event.target.value) : null)} /></label>
      <label>Numero set<select value={draft.number_of_sets} onChange={event => field('number_of_sets', Number(event.target.value) as 3 | 5)}><option value={3}>Al meglio dei 3</option><option value={5}>Al meglio dei 5</option></select></label>
    </div>
    <div className="form-grid">
      <label>Terzo set<select value={draft.third_set_type} onChange={event => field('third_set_type', event.target.value as Match['third_set_type'])}><option value="normal">Normale</option><option value="super-tiebreak">Super tie-break</option></select></label>
      <label>Target super tie-break<input type="number" min="1" value={draft.super_tiebreak_target} onChange={event => field('super_tiebreak_target', Number(event.target.value))} /></label>
    </div>
    <div className="form-grid">
      <label>Target tie-break<input type="number" min="1" value={draft.tiebreak_target} onChange={event => field('tiebreak_target', Number(event.target.value))} /></label>
      <label>Primo servizio<select value={draft.first_server} onChange={event => field('first_server', event.target.value as Match['first_server'])}><option value="player">Tu</option><option value="opponent">Avversario</option></select></label>
    </div>
    <label>Stato<select value={draft.status} onChange={event => field('status', event.target.value as Match['status'])}><option value="in-progress">In corso</option><option value="completed">Terminata</option></select></label>
    <label>Risultato<input value={draft.result ?? ''} onChange={event => field('result', event.target.value || null)} /></label>
    <label className="toggle-row"><span>Punto secco al 40-40</span><input type="checkbox" checked={draft.deuce_single_point} onChange={event => field('deuce_single_point', event.target.checked)} /></label>
    <label className="toggle-row"><span>Tie-break da 3-3</span><input type="checkbox" checked={draft.tiebreak_starts_at_363} onChange={event => field('tiebreak_starts_at_363', event.target.checked)} /></label>
    {error && <p className="family-feedback error" role="alert">{error}</p>}
    <button className="primary wide" disabled={!draft.opponent.trim() || !draft.player_id || draft.tiebreak_target < 1 || draft.super_tiebreak_target < 1}
      onClick={() => onSave({
        match_date: draft.match_date,
        player_id: draft.player_id,
        opponent: draft.opponent.trim(),
        opponent_ranking: draft.opponent_ranking,
        opponent_category: draft.opponent_category,
        tournament: draft.tournament,
        tournament_match_number: draft.tournament_match_number,
        number_of_sets: draft.number_of_sets,
        third_set_type: draft.third_set_type,
        super_tiebreak_target: draft.super_tiebreak_target,
        tiebreak_target: draft.tiebreak_target,
        tiebreak_starts_at_363: draft.tiebreak_starts_at_363,
        deuce_single_point: draft.deuce_single_point,
        first_server: draft.first_server,
        status: draft.status,
        result: draft.result,
      })}>Salva modifiche</button>
  </div></div>;
}

export function NewMatch({ initialPlayerId, onClose }: { initialPlayerId?: string; onClose: () => void }) {
  const { activeFamily } = useFamily();
  const players = useLiveQuery(
    async () => activeFamily
      ? (await db.players.where('family_id').equals(activeFamily.id).toArray()).filter(player => !player.deleted)
      : [],
    [activeFamily?.id],
  ) ?? [];
  const navigate = useNavigate();
  const [playerId, setPlayerId] = useState(initialPlayerId ?? '');
  const [opponent, setOpponent] = useState('');
  const [matchDate, setMatchDate] = useState(new Date().toISOString().slice(0, 10));
  const [tournament, setTournament] = useState('');
  const [sets, setSets] = useState<3 | 5>(3);
  const [third, setThird] = useState<'normal' | 'super-tiebreak'>('normal');
  const [firstServer, setFirstServer] = useState<'player' | 'opponent'>('player');
  const [deuce, setDeuce] = useState(true);
  const [tb363, setTb363] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selected = players.find(player => player.id === playerId);

  async function create() {
    if (!selected || !activeFamily || !opponent.trim()) return;
    const created_at = stamp();
    const match: Match = {
      id: crypto.randomUUID(),
      family_id: activeFamily.id,
      match_date: matchDate,
      player_id: selected.id,
      player_first_name_snapshot: selected.first_name,
      player_last_name_snapshot: selected.last_name,
      player_ranking_snapshot: selected.ranking,
      player_category_snapshot: selected.category,
      opponent: opponent.trim(),
      tournament: tournament.trim(),
      number_of_sets: sets,
      third_set_type: third,
      super_tiebreak_target: 10,
      tiebreak_target: 7,
      tiebreak_starts_at_363: tb363,
      deuce_single_point: deuce,
      first_server: firstServer,
      status: 'in-progress',
      created_at,
      updated_at: created_at,
      version: 1,
      deleted: false,
    };
    try {
      await db.transaction('rw', [db.players, db.matches, db.syncQueue], async () => {
        const currentPlayer = await db.players.get(selected.id);
        if (!currentPlayer || currentPlayer.family_id !== activeFamily.id || currentPlayer.deleted) {
          throw new Error('Il giocatore selezionato non appartiene allo spazio attivo.');
        }
        await db.matches.add(match);
        await db.syncQueue.add(queueOperation(activeFamily.id, 'matches', match, created_at));
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile salvare la partita.');
      return;
    }
    onClose();
    navigate(`/match/${match.id}`);
  }

  return <div className="modal-backdrop new-match-backdrop"><div className="modal-sheet new-match-sheet">
    <div className="new-match-hero">
      <button className="new-match-back" aria-label="Indietro" onClick={onClose}><span>‹</span></button>
      <img src={tennisBallIcon} alt="" />
      <h2>Nuova partita</h2>
    </div>
    <div className="new-match-content">
    <div className="new-match-fields">
    <label>Data partita<input type="date" value={matchDate} onChange={event => setMatchDate(event.target.value)} /></label>
    <label>Giocatore<select value={playerId} onChange={event => setPlayerId(event.target.value)}>
      <option value="">Seleziona un giocatore</option>
      {players.map(player => <option key={player.id} value={player.id}>{player.first_name} {player.last_name}</option>)}
    </select></label>
    {selected && <div className="snapshot-preview"><span>{selected.ranking}</span><span>{selected.category}</span><small>Dati congelati alla creazione</small></div>}
    {!players.length && <p className="family-feedback">Aggiungi prima un giocatore in questo spazio.</p>}
    {error && <p className="family-feedback error" role="alert">{error}</p>}
    <label>Avversario<input value={opponent} onChange={event => setOpponent(event.target.value)} placeholder="Nome avversario" /></label>
    <label>Torneo<input value={tournament} onChange={event => setTournament(event.target.value)} /></label>
    <div className="form-grid">
      <label>Set<select value={sets} onChange={event => setSets(Number(event.target.value) as 3 | 5)}><option value={3}>Al meglio dei 3</option><option value={5}>Al meglio dei 5</option></select></label>
      <label>Terzo set<select value={third} onChange={event => setThird(event.target.value as 'normal' | 'super-tiebreak')}><option value="normal">Normale</option><option value="super-tiebreak">Super tie-break</option></select></label>
    </div>
    <label className="toggle-row"><span>Chi serve per primo</span><select value={firstServer} onChange={event => setFirstServer(event.target.value as 'player' | 'opponent')}><option value="player">Tu</option><option value="opponent">Avversario</option></select></label>
    <label className="toggle-row"><span>Punto secco al 40-40</span><input type="checkbox" checked={deuce} onChange={event => setDeuce(event.target.checked)} /></label>
    <label className="toggle-row"><span>Tie-break da 3-3</span><input type="checkbox" checked={tb363} onChange={event => setTb363(event.target.checked)} /></label>
    </div>
    <button className="player-editor-save new-match-submit" disabled={!selected || !opponent.trim()} onClick={() => void create()}><span aria-hidden="true">▶</span>Avvia partita</button>
    </div>
  </div></div>;
}
