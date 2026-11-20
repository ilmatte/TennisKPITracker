import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { jsPDF } from 'jspdf';
import { db, getMatchPoints, persistSnapshotStorage } from './db/database';
import { nextPointNumber } from './db/pointNumbers';
import type { ErrorCategory, Game, Match, Player, Point, ScoredPoint, SyncOperation, TennisSet } from './types';
import { configuredSetNavigation, deriveGameScore, deriveSetScore, getServer, nextGameNumber, pointsToGame, sortedPoints } from './features/scoring/scoring';
import { freeErrorStats, serveKpi, servicePlusOne } from './features/kpi/kpi';
import './features/sports/sports.css';
import {
  countGameDescendants,
  countMatchDescendants,
  countSetDescendants,
  createPlayer,
  softDeleteGame,
  softDeleteMatch,
  softDeletePlayer,
  softDeletePoint,
  softDeleteSet,
  updateGame,
  updateMatch,
  updatePlayer,
  updatePoint,
  updateSet,
  type MatchChanges,
  type PointChanges,
} from './db/sportsMutations';
import AuthStatus from './features/auth/AuthStatus';
import { useAuth } from './features/auth/AuthContext';
import { useFamily } from './features/families/FamilyContextDefinition';
import FamilyManager from './features/families/FamilyManager';

const stamp = () => new Date().toISOString();

function mutationError(cause: unknown, fallback: string, conflict: string): string {
  if (cause instanceof Error && cause.name === 'ConstraintError') return conflict;
  return cause instanceof Error ? cause.message : fallback;
}

function queueOperation<T>(
  family_id: string,
  entity_type: SyncOperation['entity_type'],
  entity: T & { id: string },
  created_at: string,
): SyncOperation {
  return {
    id: crypto.randomUUID(),
    family_id,
    entity_type,
    entity_id: entity.id,
    operation: 'upsert',
    payload: entity,
    created_at,
    attempts: 0,
  };
}

export default function TennisApp() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    void persistSnapshotStorage();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return <div className="app-shell">
    <header className="topbar">
      <div><span className="brand-mark">TK</span><strong>Tennis KPI</strong></div>
      <div className="topbar-actions">
        <span className={`status ${online ? 'online' : 'offline'}`}>{online ? 'Online' : 'Offline'}</span>
        <AuthStatus />
      </div>
    </header>
    <main><Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/players" element={<Players />} />
      <Route path="/match/:id" element={<Tracker />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></main>
    <nav className="bottom-nav">
      <NavLink to="/">Partite</NavLink><NavLink to="/players">Giocatori</NavLink>
      <NavLink to="/dashboard">KPI</NavLink><NavLink to="/settings">Impostazioni</NavLink>
    </nav>
  </div>;
}

function HomeRoute() {
  const location = useLocation();
  let pendingInvite = false;
  try { pendingInvite = Boolean(sessionStorage.getItem('tennis-kpi-pending-invite')); } catch { /* Continue without a cached invitation. */ }
  if (new URLSearchParams(location.hash.slice(1)).has('invite') || pendingInvite) return <Navigate to="/settings" replace />;
  return <Matches />;
}

function Matches() {
  const { activeFamily } = useFamily();
  const matches = useLiveQuery(
    async () => activeFamily
      ? (await db.matches.where('family_id').equals(activeFamily.id).toArray())
          .filter(match => !match.deleted).sort((a, b) => b.match_date.localeCompare(a.match_date))
      : [],
    [activeFamily?.id],
  ) ?? [];
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<Match | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

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

  return <div className="page">
    <div className="page-heading"><div><p className="eyebrow">Archivio</p><h1>Partite</h1></div><button className="primary" onClick={() => setNewOpen(true)}>+ Nuova</button></div>
    {newOpen && <NewMatch onClose={() => setNewOpen(false)} />}
    {error && <p className="family-feedback error" role="alert">{error}</p>}
    <div className="match-list">
      {matches.map(match => <MatchCard key={match.id} match={match} open={() => navigate(`/match/${match.id}`)}
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

function MatchEditor({ match, error, onClose, onSave }: {
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

function NewMatch({ onClose }: { onClose: () => void }) {
  const { activeFamily } = useFamily();
  const players = useLiveQuery(
    async () => activeFamily
      ? (await db.players.where('family_id').equals(activeFamily.id).toArray()).filter(player => !player.deleted)
      : [],
    [activeFamily?.id],
  ) ?? [];
  const navigate = useNavigate();
  const [playerId, setPlayerId] = useState('');
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

  return <div className="modal-backdrop"><div className="modal-sheet">
    <div className="modal-heading"><h2>Nuova partita</h2><button className="icon-button" onClick={onClose}>×</button></div>
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
    <button className="primary wide" disabled={!selected || !opponent.trim()} onClick={() => void create()}>Avvia partita</button>
  </div></div>;
}

function Players() {
  const { activeFamily } = useFamily();
  const { user } = useAuth();
  const players = useLiveQuery(
    async () => activeFamily
      ? (await db.players.where('family_id').equals(activeFamily.id).toArray()).filter(player => !player.deleted)
      : [],
    [activeFamily?.id],
  ) ?? [];
  const [editing, setEditing] = useState<Player | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  return <div className="modal-backdrop"><div className="modal-sheet">
    <div className="modal-heading"><h2>{draft.first_name ? 'Modifica giocatore' : 'Nuovo giocatore'}</h2><button className="icon-button" onClick={onClose}>×</button></div>
    <div className="form-grid">
      <label>Nome<input value={draft.first_name} onChange={event => setDraft({ ...draft, first_name: event.target.value })} /></label>
      <label>Cognome<input value={draft.last_name} onChange={event => setDraft({ ...draft, last_name: event.target.value })} /></label>
    </div>
    <label>Data di nascita<input type="date" value={draft.birth_date ?? ''} onChange={event => setDraft({ ...draft, birth_date: event.target.value || null })} /></label>
    <div className="form-grid">
      <label>Categoria<input value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })} /></label>
      <label>Classifica FITP<input value={draft.ranking} onChange={event => setDraft({ ...draft, ranking: event.target.value })} /></label>
    </div>
    {error && <p className="family-feedback error" role="alert">{error}</p>}
    <button className="primary wide" disabled={!draft.first_name.trim()} onClick={() => onSave(draft)}>Salva</button>
  </div></div>;
}

function Tracker() {
  const { id } = useParams();
  const { activeFamily } = useFamily();
  const match = useLiveQuery(async () => {
    if (!activeFamily || !id) return undefined;
    const record = await db.matches.get(id);
    return record?.family_id === activeFamily.id && !record.deleted ? record : undefined;
  }, [id, activeFamily?.id]);
  const points = useLiveQuery(
    () => activeFamily && id ? getMatchPoints(activeFamily.id, id) : Promise.resolve([] as ScoredPoint[]),
    [id, activeFamily?.id],
  ) ?? [];
  const hierarchy = useLiveQuery(async () => {
    if (!activeFamily || !id) return { sets: [] as TennisSet[], games: [] as Game[] };
    const sets = (await db.sets.where('family_id').equals(activeFamily.id).toArray())
      .filter(set => set.match_id === id && !set.deleted);
    const setIds = new Set(sets.map(set => set.id));
    const games = (await db.games.where('family_id').equals(activeFamily.id).toArray())
      .filter(game => setIds.has(game.set_id) && !game.deleted);
    return { sets, games };
  }, [id, activeFamily?.id]) ?? { sets: [], games: [] };
  const [setNumber, setSetNumber] = useState(1);
  const [selectedGame, setSelectedGame] = useState<number | null>(null);
  const [winner, setWinner] = useState<'player' | 'opponent'>('player');
  const [shotCount, setShotCount] = useState(1);
  const [doubleFault, setDoubleFault] = useState(false);
  const [secondServe, setSecondServe] = useState(false);
  const [freeError, setFreeError] = useState(false);
  const [errorPlayer, setErrorPlayer] = useState<'player' | 'opponent'>('opponent');
  const [attack, setAttack] = useState(false);
  const [pressure, setPressure] = useState(false);
  const [trackerError, setTrackerError] = useState<string | null>(null);
  const [editingSet, setEditingSet] = useState<TennisSet | null>(null);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [editingPoint, setEditingPoint] = useState<ScoredPoint | null>(null);

  const setTabs = match ? configuredSetNavigation(match.number_of_sets, hierarchy.sets) : [];
  const selectedSetNumber = match && setNumber > match.number_of_sets ? 1 : setNumber;
  const currentGameNumber = match ? nextGameNumber(points, selectedSetNumber, match) : 1;
  const gameNumber = selectedGame ?? currentGameNumber;
  const currentSet = hierarchy.sets.find(set => set.set_number === selectedSetNumber);
  const currentGame = hierarchy.games.find(game => game.set_id === currentSet?.id && game.game_number === gameNumber);
  const gamePoints = sortedPoints(points, selectedSetNumber, gameNumber);
  const gameComplete = match ? Boolean(pointsToGame(gamePoints, 'player', match.deuce_single_point)) : false;
  const setScore = match ? deriveSetScore(points, selectedSetNumber, match) : { player: 0, opponent: 0 };
  const recordedGameNumbers = hierarchy.games.filter(game => game.set_id === currentSet?.id).map(game => game.game_number);
  recordedGameNumbers.push(...points.filter(point => point.set_number === selectedSetNumber).map(point => point.game_number));
  const lastGameNumber = Math.max(currentGameNumber, ...recordedGameNumbers);

  useEffect(() => {
    if (doubleFault) setWinner('opponent');
  }, [doubleFault]);
  useEffect(() => {
    if (freeError) setWinner(errorPlayer === 'player' ? 'opponent' : 'player');
  }, [freeError, errorPlayer]);
  useEffect(() => {
    setWinner('player');
    setShotCount(1);
    setDoubleFault(false);
    setSecondServe(false);
    setFreeError(false);
    setErrorPlayer('opponent');
    setAttack(false);
    setPressure(false);
  }, [selectedSetNumber, gameNumber]);

  if (!match || !activeFamily) return <div className="page"><div className="empty-state">Partita non trovata</div></div>;
  const activeMatch = match;

  function selectGame(number: number) {
    setSelectedGame(number === currentGameNumber ? null : number);
  }

  async function savePoint() {
    if (gameComplete) return;
    const created_at = stamp();
    try {
      await db.transaction('rw', [db.matches, db.sets, db.games, db.points, db.syncQueue], async () => {
        const currentMatch = await db.matches.get(activeMatch.id);
        if (!currentMatch || currentMatch.family_id !== activeMatch.family_id || currentMatch.deleted) {
          throw new Error('La partita non è più attiva nello spazio corrente.');
        }
        const existingSet = await db.sets.where('[match_id+set_number]').equals([currentMatch.id, selectedSetNumber]).first();
        const tennisSet: TennisSet = existingSet ?? {
          id: crypto.randomUUID(), family_id: currentMatch.family_id, match_id: currentMatch.id, set_number: selectedSetNumber,
          player_games: 0, opponent_games: 0, created_at, updated_at: created_at, version: 1, deleted: false,
        };
        if (tennisSet.family_id !== currentMatch.family_id || tennisSet.deleted) {
          throw new Error('Il set selezionato non appartiene alla famiglia attiva.');
        }
        const existingGame = await db.games.where('[set_id+game_number]').equals([tennisSet.id, gameNumber]).first();
        const tennisGame: Game = existingGame ?? {
          id: crypto.randomUUID(), family_id: currentMatch.family_id, set_id: tennisSet.id, game_number: gameNumber,
          player_points: 0, opponent_points: 0, created_at, updated_at: created_at, version: 1, deleted: false,
        };
        if (tennisGame.family_id !== currentMatch.family_id || tennisGame.deleted) {
          throw new Error('Il game selezionato non appartiene alla famiglia attiva.');
        }
        await db.sets.put(tennisSet);
        await db.games.put(tennisGame);

        const matchSets = await db.sets.where('family_id').equals(currentMatch.family_id)
          .filter(set => set.match_id === currentMatch.id && !set.deleted).toArray();
        const setIds = new Set(matchSets.map(set => set.id));
        const matchGames = await db.games.where('family_id').equals(currentMatch.family_id)
          .filter(game => setIds.has(game.set_id) && !game.deleted).toArray();
        const gameIds = new Set(matchGames.map(game => game.id));
        const storedPoints = gameIds.size ? await db.points.where('game_id').anyOf([...gameIds]).toArray() : [];
        const setById = new Map(matchSets.map(set => [set.id, set]));
        const gameById = new Map(matchGames.map(game => [game.id, game]));
        const scoredPoints: ScoredPoint[] = storedPoints.flatMap(stored => {
          const game = gameById.get(stored.game_id);
          const set = game ? setById.get(game.set_id) : undefined;
          return set && game && stored.family_id === currentMatch.family_id
            ? [{ ...stored, set_number: set.set_number, game_number: game.game_number }]
            : [];
        });
        const point: Point = {
          id: crypto.randomUUID(), family_id: activeMatch.family_id, game_id: tennisGame.id,
          point_number: nextPointNumber(scoredPoints.filter(existing => existing.game_id === tennisGame.id)),
          winner, server: getServer(currentMatch, selectedSetNumber, gameNumber), second_serve: secondServe,
          double_fault: doubleFault, shot_count: shotCount, free_error: freeError,
          error_player: freeError ? errorPlayer : undefined, error_category: freeError ? 'other' : undefined,
          attack_error: attack, pressure_situation: pressure, pressure_error_player: pressure ? errorPlayer : undefined,
          created_at, updated_at: created_at, version: 1, deleted: false,
        };
        const updatedPoints: ScoredPoint[] = [...scoredPoints, { ...point, set_number: selectedSetNumber, game_number: gameNumber }];
        const updatedGamePoints = sortedPoints(updatedPoints, selectedSetNumber, gameNumber);
        const updatedSetScore = deriveSetScore(updatedPoints, selectedSetNumber, currentMatch);
        const updatedGame: Game = {
          ...tennisGame,
          player_points: updatedGamePoints.filter(existing => existing.winner === 'player').length,
          opponent_points: updatedGamePoints.filter(existing => existing.winner === 'opponent').length,
          updated_at: created_at,
          version: existingGame ? existingGame.version + 1 : 1,
        };
        const updatedSet: TennisSet = {
          ...tennisSet,
          player_games: updatedSetScore.player,
          opponent_games: updatedSetScore.opponent,
          updated_at: created_at,
          version: existingSet ? existingSet.version + 1 : 1,
        };

      await db.sets.put(updatedSet);
      await db.games.put(updatedGame);
      await db.points.add(point);
      await db.syncQueue.bulkPut([
        queueOperation(currentMatch.family_id, 'sets', updatedSet, created_at),
        queueOperation(currentMatch.family_id, 'games', updatedGame, created_at),
        queueOperation(currentMatch.family_id, 'points', point, created_at),
      ]);
      });
    } catch (cause) {
      setTrackerError(cause instanceof Error ? cause.message : 'Impossibile salvare il punto.');
      return;
    }
    setTrackerError(null);
    setDoubleFault(false);
    setSecondServe(false);
    setFreeError(false);
    setAttack(false);
    setPressure(false);
    setShotCount(1);
  }

  async function removePoint(point: ScoredPoint) {
    if (!window.confirm(`Eliminare logicamente il punto ${point.point_number}? I punteggi e i KPI saranno ricalcolati.`)) return;
    try {
      await softDeletePoint(activeMatch.family_id, point.id);
      setTrackerError(null);
    } catch (cause) {
      setTrackerError(cause instanceof Error ? cause.message : 'Impossibile eliminare il punto.');
    }
  }

  async function removeSet(set: TennisSet) {
    try {
      const count = await countSetDescendants(activeMatch.family_id, set.id);
      if (!window.confirm(`Eliminare logicamente il set? Verranno marcati come cancellati anche ${count.games} game e ${count.points} punti.`)) return;
      await softDeleteSet(activeMatch.family_id, set.id);
      setTrackerError(null);
    } catch (cause) {
      setTrackerError(cause instanceof Error ? cause.message : 'Impossibile eliminare il set.');
    }
  }

  async function removeGame(game: Game) {
    try {
      const count = await countGameDescendants(activeMatch.family_id, game.id);
      if (!window.confirm(`Eliminare logicamente il game? Verranno marcati come cancellati anche ${count} punti.`)) return;
      await softDeleteGame(activeMatch.family_id, game.id);
      setSelectedGame(null);
      setTrackerError(null);
    } catch (cause) {
      setTrackerError(cause instanceof Error ? cause.message : 'Impossibile eliminare il game.');
    }
  }

  async function savePointChanges(changes: PointChanges) {
    if (!editingPoint) return;
    await updatePoint(activeMatch.family_id, editingPoint.id, changes);
    setEditingPoint(null);
    setTrackerError(null);
  }

  async function completeMatch() {
    try {
      await db.transaction('rw', db.matches, db.syncQueue, async () => {
        const current = await db.matches.get(activeMatch.id);
        if (!current || current.family_id !== activeMatch.family_id || current.deleted) {
          throw new Error('La partita non è più attiva nello spazio corrente.');
        }
        const updated_at = stamp();
        const updated = { ...current, status: 'completed' as const, updated_at, version: current.version + 1 };
        await db.matches.put(updated);
        await db.syncQueue.put(queueOperation(activeMatch.family_id, 'matches', updated, updated_at));
      });
      setTrackerError(null);
    } catch (cause) {
      setTrackerError(cause instanceof Error ? cause.message : 'Impossibile completare la partita.');
    }
  }

  return <div className="tracking-page">
    <div className="tracking-header">
      <button className="icon-button" onClick={() => window.history.back()} aria-label="Indietro">‹</button>
      <div><span>SET {selectedSetNumber} · GAME {gameNumber}</span><strong>{match.player_first_name_snapshot} vs {match.opponent}</strong></div>
      <button className="icon-button" onClick={() => void completeMatch()} aria-label="Termina">✓</button>
    </div>
    <div className="scoreboard">
      <div><span>Tu</span><strong>{deriveGameScore(gamePoints, match.deuce_single_point).player}</strong></div>
      <div className="game-count"><strong>{setScore.player}-{setScore.opponent}</strong><span>Game {gameNumber}</span></div>
      <div><span>{match.opponent}</span><strong>{deriveGameScore(gamePoints, match.deuce_single_point).opponent}</strong></div>
    </div>
    <div className="set-tabs">{setTabs.map(({ set_number, exists }) =>
      <button key={set_number} className={set_number === selectedSetNumber ? 'active' : ''} onClick={() => { setSetNumber(set_number); setSelectedGame(null); }}>
        Set {set_number}<span>{exists ? 'Registrato' : 'Da registrare'}</span>
      </button>
    )}</div>
    {currentSet && <div className="record-actions set-actions">
      <button className="secondary" onClick={() => setEditingSet(currentSet)}>Modifica set {selectedSetNumber}</button>
      <button className="danger" onClick={() => void removeSet(currentSet)}>Elimina set {selectedSetNumber}</button>
    </div>}
    <div className="game-navigation" aria-label="Seleziona game">
      {Array.from({ length: lastGameNumber }, (_, index) => index + 1).map(number => {
        const selectedPoints = sortedPoints(points, selectedSetNumber, number);
        const result = pointsToGame(selectedPoints, 'player', match.deuce_single_point);
        const label = result ? `${result.player}-${result.opponent}` : 'in corso';
        const isCurrent = number === currentGameNumber;
        const isSelected = number === gameNumber;
        return <button key={number} className={`${isSelected ? 'active' : ''}${isCurrent ? ' current' : ''}`} onClick={() => selectGame(number)}>
          Game {number}<span>{isCurrent ? 'Corrente' : label}</span>
        </button>;
      })}
    </div>
    {currentGame && <div className="record-actions set-actions">
      <button className="secondary" onClick={() => setEditingGame(currentGame)}>Modifica game {gameNumber}</button>
      <button className="danger" onClick={() => void removeGame(currentGame)}>Elimina game {gameNumber}</button>
    </div>}
    <div className="tracking-controls">
      <div className="winner-grid">
        <button className={`winner player ${winner === 'player' ? 'active' : ''}`} onClick={() => setWinner('player')}>Punto tuo</button>
        <button className={`winner opponent ${winner === 'opponent' ? 'active' : ''}`} onClick={() => setWinner('opponent')}>Punto avversario</button>
      </div>
      <div className="quick-options">
        <button className={secondServe ? 'active' : ''} onClick={() => setSecondServe(value => !value)}>Seconda palla</button>
        <button className={doubleFault ? 'active danger' : ''} onClick={() => setDoubleFault(value => !value)}>Doppio fallo</button>
        <button className={freeError ? 'active' : ''} onClick={() => setFreeError(value => !value)}>Errore gratuito</button>
      </div>
      {freeError && <div className="quick-options">
        <button className={errorPlayer === 'player' ? 'active' : ''} onClick={() => setErrorPlayer('player')}>Errore mio</button>
        <button className={errorPlayer === 'opponent' ? 'active' : ''} onClick={() => setErrorPlayer('opponent')}>Errore avversario</button>
      </div>}
      <label className="shot-control"><span>Colpi complessivi</span><div>
        <button onClick={() => setShotCount(value => Math.max(1, value - 1))}>−</button><strong>{shotCount}</strong>
        <button onClick={() => setShotCount(value => value + 1)}>+</button>
      </div></label>
      <div className="quick-options">
        <button className={attack ? 'active' : ''} onClick={() => setAttack(value => !value)}>Errore in attacco</button>
        <button className={pressure ? 'active' : ''} onClick={() => setPressure(value => !value)}>Pressione</button>
      </div>
      {gameComplete && <p className="completed-game-note">Game concluso. Per correggerlo, elimina il punto errato dalla lista qui sotto.</p>}
      {trackerError && <p className="family-feedback error" role="alert">{trackerError}</p>}
      <button className="primary save-point" disabled={gameComplete} onClick={() => void savePoint()}>Salva punto</button>
    </div>
    {gamePoints.length > 0 && <div className="point-history">
      <h3>Punti del game {gameNumber}</h3>
      {gamePoints.map(point => <div className="point-row" key={point.id}>
        <span>{point.point_number}</span><strong>{point.winner === 'player' ? 'Tu' : match.opponent}</strong>
        <span>{point.shot_count} colpi</span><span className="point-actions">
          <button onClick={() => setEditingPoint(point)}>Modifica</button><button onClick={() => void removePoint(point)}>Elimina</button>
        </span>
      </div>)}
    </div>}
    {editingSet && <SetEditor set={editingSet} onClose={() => setEditingSet(null)} onSave={async set_number => {
      await updateSet(activeMatch.family_id, editingSet.id, { set_number });
      setSetNumber(set_number);
      setEditingSet(null);
      setTrackerError(null);
    }} />}
    {editingGame && <GameEditor game={editingGame} onClose={() => setEditingGame(null)} onSave={async game_number => {
      await updateGame(activeMatch.family_id, editingGame.id, { game_number });
      setSelectedGame(game_number);
      setEditingGame(null);
      setTrackerError(null);
    }} />}
    {editingPoint && <PointEditor point={editingPoint} onClose={() => setEditingPoint(null)} onSave={savePointChanges} />}
  </div>;
}

function SetEditor({ set, onClose, onSave }: {
  set: TennisSet;
  onClose: () => void;
  onSave: (number: number) => Promise<void>;
}) {
  const [number, setNumber] = useState(String(set.set_number));
  const [error, setError] = useState<string | null>(null);
  return <div className="modal-backdrop"><div className="modal-sheet">
    <div className="modal-heading"><h2>Modifica set</h2><button className="icon-button" onClick={onClose}>×</button></div>
    <label>Numero set<input type="number" min="1" value={number} onChange={event => setNumber(event.target.value)} /></label>
    <p className="family-feedback">I punteggi sono calcolati dai game e dai punti registrati.</p>
    {error && <p className="family-feedback error" role="alert">{error}</p>}
    <button className="primary wide" disabled={!Number.isInteger(Number(number)) || Number(number) < 1}
      onClick={() => void onSave(Number(number)).catch(cause => setError(mutationError(cause, 'Impossibile modificare il set.', 'Esiste già un set con questo numero.')))}>Salva modifiche</button>
  </div></div>;
}

function GameEditor({ game, onClose, onSave }: {
  game: Game;
  onClose: () => void;
  onSave: (number: number) => Promise<void>;
}) {
  const [number, setNumber] = useState(String(game.game_number));
  const [error, setError] = useState<string | null>(null);
  return <div className="modal-backdrop"><div className="modal-sheet">
    <div className="modal-heading"><h2>Modifica game</h2><button className="icon-button" onClick={onClose}>×</button></div>
    <label>Numero game<input type="number" min="1" value={number} onChange={event => setNumber(event.target.value)} /></label>
    <p className="family-feedback">I punteggi sono calcolati dai punti registrati.</p>
    {error && <p className="family-feedback error" role="alert">{error}</p>}
    <button className="primary wide" disabled={!Number.isInteger(Number(number)) || Number(number) < 1}
      onClick={() => void onSave(Number(number)).catch(cause => setError(mutationError(cause, 'Impossibile modificare il game.', 'Esiste già un game con questo numero nel set.')))}>Salva modifiche</button>
  </div></div>;
}

function PointEditor({ point, onClose, onSave }: {
  point: ScoredPoint;
  onClose: () => void;
  onSave: (changes: PointChanges) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PointChanges>({
    winner: point.winner,
    server: point.server,
    second_serve: point.second_serve,
    double_fault: point.double_fault,
    shot_count: point.shot_count,
    free_error: point.free_error,
    error_player: point.error_player,
    error_category: point.error_category,
    attack_error: point.attack_error,
    pressure_situation: point.pressure_situation,
    pressure_error_player: point.pressure_error_player,
  });
  const field = <K extends keyof PointChanges>(key: K, value: PointChanges[K]) =>
    setDraft(current => ({ ...current, [key]: value }));
  const [error, setError] = useState<string | null>(null);

  return <div className="modal-backdrop"><div className="modal-sheet">
    <div className="modal-heading"><h2>Modifica punto {point.point_number}</h2><button className="icon-button" onClick={onClose}>×</button></div>
    <div className="form-grid">
      <label>Vincitore<select value={draft.winner} onChange={event => field('winner', event.target.value as Point['winner'])}><option value="player">Tu</option><option value="opponent">Avversario</option></select></label>
      <label>Battitore<select value={draft.server} onChange={event => field('server', event.target.value as Point['server'])}><option value="player">Tu</option><option value="opponent">Avversario</option></select></label>
    </div>
    <div className="form-grid">
      <label>Numero colpi<input type="number" min="1" value={draft.shot_count} onChange={event => field('shot_count', Number(event.target.value))} /></label>
      <label>Autore errore<select value={draft.error_player ?? ''} onChange={event => field('error_player', event.target.value ? event.target.value as Point['error_player'] : undefined)}><option value="">Nessuno</option><option value="player">Tu</option><option value="opponent">Avversario</option></select></label>
    </div>
    <label>Categoria errore<select value={draft.error_category ?? ''} onChange={event => field('error_category', event.target.value ? event.target.value as ErrorCategory : undefined)}>
      <option value="">Nessuna</option><option value="forehand">Dritto</option><option value="backhand">Rovescio</option>
      <option value="serve">Servizio</option><option value="volley">Volée</option><option value="net">Rete</option><option value="other">Altro</option>
    </select></label>
    <label className="toggle-row"><span>Seconda di servizio</span><input type="checkbox" checked={draft.second_serve} onChange={event => field('second_serve', event.target.checked)} /></label>
    <label className="toggle-row"><span>Doppio fallo</span><input type="checkbox" checked={draft.double_fault} onChange={event => field('double_fault', event.target.checked)} /></label>
    <label className="toggle-row"><span>Errore gratuito</span><input type="checkbox" checked={draft.free_error} onChange={event => field('free_error', event.target.checked)} /></label>
    <label className="toggle-row"><span>Errore in attacco</span><input type="checkbox" checked={draft.attack_error} onChange={event => field('attack_error', event.target.checked)} /></label>
    <label className="toggle-row"><span>Situazione di pressione</span><input type="checkbox" checked={draft.pressure_situation} onChange={event => field('pressure_situation', event.target.checked)} /></label>
    <label>Autore errore sotto pressione<select value={draft.pressure_error_player ?? ''} onChange={event => field('pressure_error_player', event.target.value ? event.target.value as Point['pressure_error_player'] : undefined)}>
      <option value="">Nessuno</option><option value="player">Tu</option><option value="opponent">Avversario</option>
    </select></label>
    <p className="family-feedback">Il punteggio del game, quello del set e i KPI saranno ricalcolati al salvataggio.</p>
    {error && <p className="family-feedback error" role="alert">{error}</p>}
    <button className="primary wide" disabled={!Number.isInteger(draft.shot_count) || draft.shot_count < 1}
      onClick={() => void onSave(draft).catch(cause => setError(mutationError(cause, 'Impossibile modificare il punto.', 'Modifica non consentita dal vincolo locale.')))}>Salva modifiche</button>
  </div></div>;
}

function Dashboard() {
  const { activeFamily } = useFamily();
  const matches = useLiveQuery(
    async () => activeFamily
      ? (await db.matches.where('family_id').equals(activeFamily.id).toArray()).filter(match => !match.deleted)
      : [],
    [activeFamily?.id],
  ) ?? [];
  const [matchId, setMatchId] = useState('all');
  const points = useLiveQuery(async () => {
    if (!activeFamily) return [] as ScoredPoint[];
    const selected = matchId === 'all' ? matches : matches.filter(match => match.id === matchId);
    return (await Promise.all(selected.map(match => getMatchPoints(activeFamily.id, match.id)))).flat();
  }, [activeFamily?.id, matchId, matches.map(match => match.id).join(',')]) ?? [];
  const player = serveKpi(points, 'player');
  const opponent = serveKpi(points, 'opponent');
  const playerErrors = freeErrorStats(points, 'player');
  const opponentErrors = freeErrorStats(points, 'opponent');
  const playerPlusOne = servicePlusOne(points, 'player');
  const opponentPlusOne = servicePlusOne(points, 'opponent');
  const data = [
    { name: 'Tu', Punti: player.pointsWon, Errori: playerErrors.total },
    { name: 'Avversario', Punti: opponent.pointsWon, Errori: opponentErrors.total },
  ];

  return <div className="page">
    <div className="page-heading"><div><p className="eyebrow">Analisi</p><h1>Dashboard KPI</h1></div></div>
    <label className="filter"><span>Partita</span><select value={matchId} onChange={event => setMatchId(event.target.value)}>
      <option value="all">Tutte le partite</option>
      {matches.map(match => <option key={match.id} value={match.id}>{new Date(match.match_date).toLocaleDateString('it-IT')} · {match.opponent}</option>)}
    </select></label>
    <section className="dashboard-section"><h2>Servizio</h2><div className="kpi-grid">
      <Kpi label="Prime palle" value={`${player.firstServePercentage.toFixed(0)}%`} />
      <Kpi label="Doppi falli" value={player.doubleFaults} />
      <Kpi label="Punti al servizio" value={player.pointsWon} />
      <Kpi label="Seconda palla" value={player.secondServes} />
    </div></section>
    <section className="dashboard-section"><h2>Errori gratuiti</h2><div className="kpi-grid">
      <Kpi label="Totali tu" value={playerErrors.total} /><Kpi label="Entro 4" value={playerErrors.under4} />
      <Kpi label="Rally" value={playerErrors.rally} /><Kpi label="Pressione" value={playerErrors.pressure} />
    </div></section>
    <section className="dashboard-section"><h2>Servizio +1</h2><div className="kpi-grid">
      <Kpi label="Tu" value={`${playerPlusOne.percentage.toFixed(0)}%`} detail={`${playerPlusOne.won}/${playerPlusOne.total}`} />
      <Kpi label="Avversario" value={`${opponentPlusOne.percentage.toFixed(0)}%`} detail={`${opponentPlusOne.won}/${opponentPlusOne.total}`} />
    </div></section>
    <section className="dashboard-section"><h2>Confronto</h2><div className="chart">
      <ResponsiveContainer width="100%" height="100%"><BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" /><YAxis /><Tooltip />
        <Bar dataKey="Punti" fill="#16856b" radius={[4, 4, 0, 0]} /><Bar dataKey="Errori" fill="#d85e38" radius={[4, 4, 0, 0]} />
      </BarChart></ResponsiveContainer>
    </div></section>
  </div>;
}

function Kpi({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <div className="kpi"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

function Settings() {
  const { activeFamily } = useFamily();
  const location = useLocation();
  const [message, setMessage] = useState('');
  let pendingInvite = false;
  try { pendingInvite = Boolean(sessionStorage.getItem('tennis-kpi-pending-invite')); } catch { /* Continue without a cached invitation. */ }
  const invitationFlow = new URLSearchParams(location.hash.slice(1)).has('invite') || pendingInvite;

  async function jsonExport() {
    if (!activeFamily) return;
    const [players, matches, sets, games] = await Promise.all([
      db.players.where('family_id').equals(activeFamily.id).toArray(),
      db.matches.where('family_id').equals(activeFamily.id).toArray(),
      db.sets.where('family_id').equals(activeFamily.id).toArray(),
      db.games.where('family_id').equals(activeFamily.id).toArray(),
    ]);
    const gameIds = new Set(games.map(game => game.id));
    const points = gameIds.size ? await db.points.where('game_id').anyOf([...gameIds]).toArray() : [];
    const backup = { version: 2, exported_at: stamp(), family_id: activeFamily.id, players, matches, sets, games, points };
    download(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `tennis-kpi-backup-${new Date().toISOString().slice(0, 10)}.json`);
    setMessage('Backup JSON esportato');
  }

  async function csvExport() {
    if (!activeFamily) return;
    const matches = (await db.matches.where('family_id').equals(activeFamily.id).toArray()).filter(match => !match.deleted);
    const sets = await db.sets.where('family_id').equals(activeFamily.id).toArray();
    const games = await db.games.where('family_id').equals(activeFamily.id).toArray();
    const setById = new Map(sets.map(set => [set.id, set]));
    const matchById = new Map(matches.map(match => [match.id, match]));
    const gameToMatch = new Map(games.flatMap(game => {
      const set = setById.get(game.set_id);
      return set && matchById.has(set.match_id) ? [[game.id, set.match_id] as const] : [];
    }));
    const allPoints = (await Promise.all(matches.map(match => getMatchPoints(activeFamily.id, match.id)))).flat().filter(point => !point.deleted);
    const csv = [
      'id,match_id,set,game,point,winner,server,shot_count,free_error',
      ...allPoints.map(point => [point.id, gameToMatch.get(point.game_id) ?? '', point.set_number, point.game_number, point.point_number, point.winner, point.server, point.shot_count, point.free_error].join(',')),
    ].join('\n');
    download(new Blob([csv], { type: 'text/csv' }), 'tennis-kpi.csv');
    setMessage('CSV esportato');
  }

  async function pdfExport() {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('Tennis KPI Report', 14, 20);
    doc.setFontSize(11);
    doc.text(`Generato il ${new Date().toLocaleString('it-IT')}`, 14, 30);
    doc.save('tennis-kpi-report.pdf');
    setMessage('PDF esportato');
  }

  async function restore(event: React.ChangeEvent<HTMLInputElement>) {
    if (!activeFamily) return;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const backup: unknown = JSON.parse(await file.text());
      if (!backup || typeof backup !== 'object' || !('version' in backup) || backup.version !== 2 ||
        !('family_id' in backup) || backup.family_id !== activeFamily.id) {
        throw new Error('Il backup deve essere versione 2 e appartenere allo spazio attivo.');
      }
      const data = backup as {
        players?: Player[]; matches?: Match[]; sets?: TennisSet[]; games?: Game[]; points?: Point[];
      };
      const players = data.players ?? [];
      const matches = data.matches ?? [];
      const sets = data.sets ?? [];
      const games = data.games ?? [];
      const points = data.points ?? [];
      const sameFamily = [...players, ...matches, ...sets, ...games, ...points].every(record => record.family_id === activeFamily.id);
      const playerIds = new Set(players.map(player => player.id));
      const matchIds = new Set(matches.map(match => match.id));
      const setIds = new Set(sets.map(set => set.id));
      const gameIds = new Set(games.map(game => game.id));
      if (!sameFamily || matches.some(match => !playerIds.has(match.player_id)) ||
        sets.some(set => !matchIds.has(set.match_id)) || games.some(game => !setIds.has(game.set_id)) ||
        points.some(point => !gameIds.has(point.game_id))) {
        throw new Error('Il backup contiene dati con famiglia o relazioni non valide.');
      }
      const updated_at = stamp();
      await db.transaction('rw', [
        db.players, db.matches, db.sets, db.games, db.points, db.syncQueue,
      ], async () => {
        const [storedPlayers, storedMatches, storedSets, storedGames, storedPoints] = await Promise.all([
          db.players.bulkGet(players.map(player => player.id)),
          db.matches.bulkGet(matches.map(match => match.id)),
          db.sets.bulkGet(sets.map(set => set.id)),
          db.games.bulkGet(games.map(game => game.id)),
          db.points.bulkGet(points.map(point => point.id)),
        ]);
        const refreshVersions = <T extends { id: string; updated_at: string; version: number }>(
          records: T[],
          existing: (T | undefined)[],
        ): T[] => records.map((record, index) => {
          const previous = existing[index];
          return {
            ...record,
            updated_at,
            version: previous
              ? Math.max(previous.version, record.version) + 1
              : Math.max(1, record.version),
          };
        });
        const updatedPlayers = refreshVersions(players, storedPlayers);
        const updatedMatches = refreshVersions(matches, storedMatches);
        const updatedSets = refreshVersions(sets, storedSets);
        const updatedGames = refreshVersions(games, storedGames);
        const updatedPoints = refreshVersions(points, storedPoints);
        await db.players.bulkPut(updatedPlayers);
        await db.matches.bulkPut(updatedMatches);
        await db.sets.bulkPut(updatedSets);
        await db.games.bulkPut(updatedGames);
        await db.points.bulkPut(updatedPoints);
        await db.syncQueue.bulkPut([
          ...updatedPlayers.map(record => queueOperation(activeFamily.id, 'players', record, updated_at)),
          ...updatedMatches.map(record => queueOperation(activeFamily.id, 'matches', record, updated_at)),
          ...updatedSets.map(record => queueOperation(activeFamily.id, 'sets', record, updated_at)),
          ...updatedGames.map(record => queueOperation(activeFamily.id, 'games', record, updated_at)),
          ...updatedPoints.map(record => queueOperation(activeFamily.id, 'points', record, updated_at)),
        ]);
      });
      setMessage('Backup ripristinato nello spazio attivo.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'File backup non valido');
    } finally {
      event.target.value = '';
    }
  }

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className="page">
    <div className="page-heading"><div><p className="eyebrow">Dati e account</p><h1>Impostazioni</h1></div></div>
    {invitationFlow && <FamilyManager invitationOnly />}
    <section className="settings-section"><h2>Backup</h2>
      <button className="setting-row" onClick={() => void jsonExport()} disabled={!activeFamily}><span>Esporta JSON dello spazio</span><b>›</b></button>
      <button className="setting-row" onClick={() => void csvExport()} disabled={!activeFamily}><span>Esporta KPI CSV</span><b>›</b></button>
      <button className="setting-row" onClick={() => void pdfExport()}><span>Esporta report PDF</span><b>›</b></button>
      <label className="setting-row"><span>Ripristina backup JSON v2</span><b>›</b><input type="file" accept="application/json" onChange={event => void restore(event)} /></label>
    </section>
    <section className="settings-section"><h2>Sincronizzazione</h2>
      <div className="cloud-state"><span>Solo su questo dispositivo</span><small>L’accesso Google non attiva né associa la sincronizzazione. L’attivazione sarà disponibile in una fase successiva.</small></div>
    </section>
    {message && <div className="toast" role="status">{message}</div>}
  </div>;
}
