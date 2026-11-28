import './Matches.css';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMatchPoints } from '../db/database';
import { MATCH_OUTCOME_LABELS, formatMatchDate, summarizeMatch, type MatchSummary } from '../features/matches/matchSummary';
import type { MatchChanges } from '../db/sportsMutations';
import { useFamily } from '../features/families/FamilyContextDefinition';
import tennisBallIcon from '../assets/icone/trasparente/512/pallina3d.png';
import { NewMatch, ServerOptions } from './NewMatchWizard';
import { FitpRankingOptions } from './FitpRankingOptions';
import { fitpRankingValue, useFitpRankings } from '../features/players/useFitpRankings';
import { BrandBar } from './BrandBar';
import { MatchesTabs } from './MatchesTabs';
import { playerFullName, playerShortName } from '../features/players/playerNames';
import { tournamentCategoryLabel } from '../features/tournaments/tournaments';
import { MATCH_STATUS_IDS, statusLabel } from '../features/statuses/statuses';
import type { Match } from '../types';
import { compareMatchesNewestFirst } from '../features/matches/matchTime';

export function Matches() {
  const { activeFamily } = useFamily();
  const matches = useLiveQuery(
    async () => activeFamily
      ? (await db.matches.where('family_id').equals(activeFamily.id).toArray())
          .filter(match => !match.deleted).sort(compareMatchesNewestFirst)
      : [],
    [activeFamily?.id],
  ) ?? [];
  const summaries = useLiveQuery(async () => {
    if (!activeFamily) return [] as MatchSummary[];
    return Promise.all(matches.map(async match => summarizeMatch(match, await getMatchPoints(activeFamily.id, match.id))));
  }, [activeFamily?.id, matches.map(match => `${match.id}:${match.status_id}:${match.version}`).join(',')]) ?? [];
  const [newOpen, setNewOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'won' | 'lost'>('all');
  const navigate = useNavigate();
  // Every player of the family, deleted ones included, so that older matches still show their player's name.
  const allPlayers = useLiveQuery(
    async () => activeFamily ? db.players.where('family_id').equals(activeFamily.id).toArray() : [],
    [activeFamily?.id],
  ) ?? [];
  const players = allPlayers.filter(player => !player.deleted);
  const playersById = new Map(allPlayers.map(player => [player.id, player]));

  function openNewMatch() {
    if (!players.length) {
      navigate('/players', { state: { createMatchAfterPlayer: true } });
      return;
    }
    setNewOpen(true);
  }

  const visible = summaries.filter(summary => filter === 'all' || summary.outcome === filter);
  const filters = [['all', 'Tutte'], ['won', 'Vinte'], ['lost', 'Perse']] as const;

  return <div className="mg-page">
    <svg className="mg-waves" width="390" height="140" viewBox="0 0 390 140" aria-hidden="true"><path d="M120 120C220 110 320 80 390 20V60C330 100 220 135 120 135z" fill="#2F8F3E" opacity=".55" /><path d="M200 128C280 120 340 95 390 60V84C340 112 280 134 200 136z" fill="#C8F03A" opacity=".35" /></svg>
    <header className="mg-header">
      <BrandBar />
      <MatchesTabs active="matches" />
      <div className="mg-filters" role="group" aria-label="Filtra partite">
        {filters.map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        <button className="mg-new" onClick={openNewMatch} aria-label="Nuova partita" title="Nuova partita">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
    </header>
    <section className="mg-panel">
      {visible.map(({ match, scoreText, outcome, duration }) => <button key={match.id} className="mg-row" onClick={() => navigate(`/match/${match.id}`)}>
        <img src={tennisBallIcon} alt="" />
        <span className="mg-info">
          <strong>{playerShortName(playersById.get(match.player_id))} vs {match.opponent}</strong>
          <small>{formatMatchDate(match.match_date)}{duration && ` • ${duration}`}</small>
        </span>
        <span className="mg-score">{scoreText || '—'}</span>
        <span className={`mg-badge ${outcome}`}>{MATCH_OUTCOME_LABELS[outcome]}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </button>)}
      {!matches.length && <div className="mg-empty"><strong>Nessuna partita</strong><span>Crea la prima partita per iniziare il tracking.</span></div>}
      {matches.length > 0 && !visible.length && <div className="mg-empty"><strong>{filter === 'won' ? 'Nessuna partita vinta' : 'Nessuna partita persa'}</strong></div>}
    </section>
    {newOpen && <NewMatch onClose={() => setNewOpen(false)} />}
  </div>;
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
  const [draft, setDraft] = useState<Match>(() => ({
    ...match,
    tiebreak_target: match.tiebreak_target === 7 ? 7 : 10,
    super_tiebreak_target: match.super_tiebreak_target === 7 ? 7 : 10,
  }));
  const rankings = useFitpRankings();
  const field = <K extends keyof Match>(key: K, value: Match[K]) => setDraft(current => ({ ...current, [key]: value }));
  // The match's own player, even if it has since been deleted.
  const matchPlayer = useLiveQuery(() => db.players.get(match.player_id), [match.player_id]);
  const editorPlayer = players.find(player => player.id === draft.player_id) ?? (draft.player_id === match.player_id ? matchPlayer : undefined);
  const editorPlayerName = playerFullName(editorPlayer);
  // Active tournaments, plus the match's own one even if it has since been deleted.
  const tournaments = useLiveQuery(async () => activeFamily
    ? (await db.tournaments.where('family_id').equals(activeFamily.id).toArray())
        .filter(tournament => !tournament.deleted || tournament.id === match.tournament_id)
        .sort((a, b) => b.start_date.localeCompare(a.start_date))
    : [], [activeFamily?.id, match.tournament_id]) ?? [];

  return <div className="modal-backdrop"><div className="modal-sheet">
    <div className="modal-heading"><h2>Modifica partita</h2><button className="icon-button" onClick={onClose}>×</button></div>
    <label>Data partita<input type="date" value={draft.match_date} onChange={event => field('match_date', event.target.value)} /></label>
    <label>Giocatore<select value={draft.player_id} onChange={event => field('player_id', event.target.value)}>
      {!players.some(player => player.id === match.player_id) && <option value={match.player_id}>{playerFullName(matchPlayer)} (eliminato)</option>}
      {players.map(player => <option key={player.id} value={player.id}>{player.first_name} {player.last_name}</option>)}
    </select></label>
    <p className="snapshot-preview"><small>Lo snapshot viene aggiornato solo per la partita selezionata.</small></p>
    <div className="form-grid">
      <label>Avversario<input value={draft.opponent} onChange={event => field('opponent', event.target.value)} /></label>
      <label>Classifica avversario<select value={draft.opponent_ranking_snapshot ?? ''}
        onChange={event => field('opponent_ranking_snapshot', fitpRankingValue(event.target.value))}>
        <FitpRankingOptions rankings={rankings} value={draft.opponent_ranking_snapshot ?? null} />
      </select></label>
    </div>
    <label>Torneo<select value={draft.tournament_id ?? ''} onChange={event => field('tournament_id', event.target.value || null)}>
      {/* Matches created before tournaments existed have none. */}
      {!match.tournament_id && <option value="">Nessun torneo</option>}
      {tournaments.map(tournament => <option key={tournament.id} value={tournament.id}>
        {tournament.name} • {tournamentCategoryLabel(tournament.age_category_id)}{tournament.deleted ? ' (eliminato)' : ''}
      </option>)}
    </select></label>
    <div className="form-grid">
      <label>Numero partita<input type="number" min="1" value={draft.tournament_match_number ?? ''} onChange={event => field('tournament_match_number', event.target.value ? Number(event.target.value) : null)} /></label>
      <label>Numero set<select value={draft.number_of_sets} onChange={event => field('number_of_sets', Number(event.target.value) as 3 | 5)}><option value={3}>Al meglio dei 3</option><option value={5}>Al meglio dei 5</option></select></label>
    </div>
    <div className="form-grid">
      <label>Set decisivo<select value={draft.last_set_type} onChange={event => field('last_set_type', event.target.value as Match['last_set_type'])}><option value="normal">Normale</option><option value="super-tiebreak">Super tie-break</option></select></label>
      <label>Target super tie-break<select value={draft.super_tiebreak_target} onChange={event => field('super_tiebreak_target', Number(event.target.value))}><option value={7}>7 punti</option><option value={10}>10 punti</option></select></label>
    </div>
    <div className="form-grid">
      <label>Target tie-break<select value={draft.tiebreak_target} onChange={event => field('tiebreak_target', Number(event.target.value))}><option value={7}>7 punti</option><option value={10}>10 punti</option></select></label>
      <label>Primo servizio<select value={draft.first_server} onChange={event => field('first_server', event.target.value as Match['first_server'])}><ServerOptions playerName={editorPlayerName} opponent={draft.opponent} /></select></label>
    </div>
    <label>Stato<select value={draft.status_id} onChange={event => field('status_id', Number(event.target.value) as Match['status_id'])}>
      {MATCH_STATUS_IDS.map(statusId => <option key={statusId} value={statusId}>{statusLabel(statusId, 'match')}</option>)}
    </select></label>
    <label>Risultato<input value={draft.result ?? ''} onChange={event => field('result', event.target.value || null)} /></label>
    <label className="toggle-row"><span>Punto secco al 40-40</span><input type="checkbox" checked={draft.deuce_single_point} onChange={event => field('deuce_single_point', event.target.checked)} /></label>
    <div className="form-grid">
      <label>Game per vincere il set<select value={draft.games_to_win_set} onChange={event => field('games_to_win_set', Number(event.target.value) as 4 | 6)}><option value={4}>4 game</option><option value={6}>6 game</option></select></label>
      {draft.games_to_win_set === 4 && <label>Tie-break sul<select value={draft.short_set_tiebreak_at ?? 3} onChange={event => field('short_set_tiebreak_at', Number(event.target.value) as 3 | 4)}><option value={3}>3-3</option><option value={4}>4-4</option></select></label>}
    </div>
    {error && <p className="family-feedback error" role="alert">{error}</p>}
    <button className="primary wide" disabled={!draft.opponent.trim() || !draft.player_id || draft.tiebreak_target < 1 || draft.super_tiebreak_target < 1}
      onClick={() => onSave({
        match_date: draft.match_date,
        player_id: draft.player_id,
        opponent: draft.opponent.trim(),
        opponent_ranking_snapshot: draft.opponent_ranking_snapshot ?? null,
        tournament_id: draft.tournament_id ?? null,
        tournament_match_number: draft.tournament_match_number,
        number_of_sets: draft.number_of_sets,
        last_set_type: draft.last_set_type,
        super_tiebreak_target: draft.super_tiebreak_target,
        tiebreak_target: draft.tiebreak_target,
        games_to_win_set: draft.games_to_win_set,
        short_set_tiebreak_at: draft.short_set_tiebreak_at ?? 3,
        deuce_single_point: draft.deuce_single_point,
        first_server: draft.first_server,
        status_id: draft.status_id,
        result: draft.result,
      })}>Salva modifiche</button>
  </div></div>;
}
