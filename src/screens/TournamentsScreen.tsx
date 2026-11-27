import './Matches.css';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMatchPoints } from '../db/database';
import { setTournamentStatus, softDeleteTournament } from '../db/sportsMutations';
import { useFamily } from '../features/families/FamilyContextDefinition';
import { MATCH_OUTCOME_LABELS, formatMatchDate, summarizeMatch, type MatchSummary } from '../features/matches/matchSummary';
import { playerShortName } from '../features/players/playerNames';
import { loadTournamentRows, type TournamentRow } from '../features/tournaments/tournamentRows';
import { TOURNAMENT_STATUS_LABELS, formatTournamentDate, tournamentCategoryLabel } from '../features/tournaments/tournaments';
import tennisBallIcon from '../assets/icone/trasparente/512/pallina3d.png';
import tournamentIcon from '../assets/icone/scuro/256/tornei.png';
import { BrandBar } from './BrandBar';
import { MatchesTabs } from './MatchesTabs';
import { NewTournament } from './NewTournamentScreen';
import type { Tournament, TournamentStatus } from '../types';

type Filter = 'all' | 'in-progress' | 'completed';
const FILTERS: readonly (readonly [Filter, string])[] = [['all', 'Tutti'], ['in-progress', 'In corso'], ['completed', 'Conclusi']];
// Statuses the badge menu offers: a tournament is created "In programma", then started and concluded by hand.
const MENU_STATUSES: readonly TournamentStatus[] = ['in-progress', 'completed'];
const EMPTY_FILTER_TEXT: Record<Exclude<Filter, 'all'>, string> = { 'in-progress': 'Nessun torneo in corso', completed: 'Nessun torneo concluso' };

/** "Tornei": the family's tournaments, each with its matches. Reached from the "Partite | Tornei" switch. */
export function Tournaments() {
  const { activeFamily } = useFamily();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  // null: form closed; 'new': "Nuovo torneo"; a tournament: "Modifica torneo".
  const [editing, setEditing] = useState<Tournament | 'new' | null>(null);
  // Id of the tournament whose status menu is open.
  const [statusMenu, setStatusMenu] = useState<string | null>(null);
  // Match lists opened or closed by hand. Otherwise only the first tournament of the list (the most recent) is open.
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const rows = useLiveQuery(
    async () => activeFamily ? loadTournamentRows(activeFamily.id) : [] as TournamentRow[],
    [activeFamily?.id],
  ) ?? [];
  const matchKey = rows.flatMap(row => row.matches.map(match => `${match.id}:${match.status}:${match.version}`)).join(',');
  const summaries = useLiveQuery(async () => {
    if (!activeFamily) return new Map<string, MatchSummary>();
    const all = await Promise.all(rows.flatMap(row => row.matches)
      .map(async match => summarizeMatch(match, await getMatchPoints(activeFamily.id, match.id))));
    return new Map(all.map(summary => [summary.match.id, summary]));
  }, [activeFamily?.id, matchKey]) ?? new Map<string, MatchSummary>();
  // Every player of the family, deleted ones included, so that older matches still show their player's name.
  const players = useLiveQuery(
    async () => activeFamily ? db.players.where('family_id').equals(activeFamily.id).toArray() : [],
    [activeFamily?.id],
  ) ?? [];
  const playersById = new Map(players.map(player => [player.id, player]));
  async function remove(tournament: Tournament) {
    if (!activeFamily) return;
    const count = rows.find(row => row.tournament.id === tournament.id)?.matches.length ?? 0;
    const kept = count === 1 ? ' La sua partita resta nello storico.' : count > 1 ? ` Le sue ${count} partite restano nello storico.` : '';
    if (!window.confirm(`Eliminare il torneo “${tournament.name}”?${kept}`)) return;
    await softDeleteTournament(activeFamily.id, tournament.id);
    setEditing(null);
  }

  async function changeStatus(tournament: Tournament, status: TournamentStatus) {
    setStatusMenu(null);
    if (!activeFamily) return;
    try {
      await setTournamentStatus(activeFamily.id, tournament.id, status);
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : 'Impossibile cambiare lo stato del torneo.');
    }
  }

  const visible = rows.filter(row => filter === 'all' || row.status === filter);

  return <div className="mg-page">
    <svg className="mg-waves" width="390" height="140" viewBox="0 0 390 140" aria-hidden="true"><path d="M120 120C220 110 320 80 390 20V60C330 100 220 135 120 135z" fill="#2F8F3E" opacity=".55" /><path d="M200 128C280 120 340 95 390 60V84C340 112 280 134 200 136z" fill="#C8F03A" opacity=".35" /></svg>
    <header className="mg-header">
      <BrandBar />
      <MatchesTabs active="tournaments" />
      <button className="mg-new-tournament" onClick={() => setEditing('new')} disabled={!activeFamily}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Nuovo torneo
      </button>
      <div className="mg-filters" role="group" aria-label="Filtra tornei">
        {FILTERS.map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
    </header>
    <section className="mg-panel mt-panel">
      {visible.map(({ tournament, club, status, matches }, index) => {
        const expanded = expandedById[tournament.id] ?? index === 0;
        const matchesId = `mt-matches-${tournament.id}`;
        const details = [club?.name, tournamentCategoryLabel(tournament.age_category_id), `dal ${formatTournamentDate(tournament.start_date)}`]
          .filter(Boolean).join(' • ');
        return <article className="mt-group" key={tournament.id} aria-label={tournament.name}>
          <div className="mt-head-row">
            <button type="button" className="mt-head" onClick={() => setEditing(tournament)}>
              <img className="mt-icon" src={tournamentIcon} alt="" />
              <span className="mg-info"><strong>{tournament.name}</strong><small>{details}</small></span>
            </button>
            <div className="mt-status">
              <button type="button" className={`mt-badge ${status}`} aria-haspopup="menu" aria-expanded={statusMenu === tournament.id}
                aria-label={`Stato: ${TOURNAMENT_STATUS_LABELS[status]}. Cambia stato`}
                onClick={() => setStatusMenu(statusMenu === tournament.id ? null : tournament.id)}>
                {TOURNAMENT_STATUS_LABELS[status]}
              </button>
              {statusMenu === tournament.id && <div className="mt-status-menu" role="menu" aria-label="Stato del torneo">
                {MENU_STATUSES.map(value => <button key={value} type="button" role="menuitemradio" aria-checked={status === value}
                  onClick={() => changeStatus(tournament, value)}>{TOURNAMENT_STATUS_LABELS[value]}</button>)}
              </div>}
            </div>
            {matches.length > 0 && <button type="button" className="mt-toggle" aria-expanded={expanded} aria-controls={matchesId}
              aria-label={`${expanded ? 'Nascondi' : 'Mostra'} le partite di ${tournament.name}`}
              onClick={() => setExpandedById({ ...expandedById, [tournament.id]: !expanded })}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>}
          </div>
          {matches.length > 0 && expanded && <div className="mt-matches" id={matchesId}>
            {matches.map(match => {
              const summary = summaries.get(match.id);
              const outcome = summary?.outcome ?? (match.status === 'completed' ? null : 'in-progress');
              return <button key={match.id} className="mt-match" onClick={() => navigate(`/match/${match.id}`)}>
                <img src={tennisBallIcon} alt="" />
                <span className="mg-info">
                  <strong>{playerShortName(playersById.get(match.player_id))} vs {match.opponent}</strong>
                  <small>{formatMatchDate(match.match_date)}{summary?.duration && ` • ${summary.duration}`}</small>
                </span>
                <span className="mt-score">{summary?.scoreText || '—'}</span>
                {outcome && <span className={`mt-result ${outcome}`}>{MATCH_OUTCOME_LABELS[outcome]}</span>}
              </button>;
            })}
          </div>}
        </article>;
      })}
      {!rows.length && <div className="mg-empty"><strong>Nessun torneo</strong><span>Crea un torneo per raggruppare le sue partite.</span></div>}
      {rows.length > 0 && !visible.length && filter !== 'all' && <div className="mg-empty"><strong>{EMPTY_FILTER_TEXT[filter]}</strong></div>}
    </section>
    {statusMenu && <button type="button" className="mt-status-backdrop" aria-label="Chiudi menu stato" onClick={() => setStatusMenu(null)} />}
    {/* Opened from here, saving goes back to this list. */}
    {editing && <NewTournament key={editing === 'new' ? 'new' : editing.id} tournament={editing === 'new' ? undefined : editing}
      onClose={() => setEditing(null)} onSaved={() => setEditing(null)}
      onDelete={editing === 'new' ? undefined : () => remove(editing)} />}
  </div>;
}
