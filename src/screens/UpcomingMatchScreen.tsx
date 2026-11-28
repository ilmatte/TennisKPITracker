import './ScheduledMatch.css';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { startMatch } from '../db/sportsMutations';
import { playerAgeCategory } from '../features/players/ageCategories';
import { fitpRankingCode } from '../features/players/fitpRankings';
import { playerFullName } from '../features/players/playerNames';
import { tournamentCategoryLabel } from '../features/tournaments/tournaments';
import { initial, matchFormatLabel, matchRulesLabel, scheduleLabel } from '../features/matches/scheduledMatch';
import { NewMatch } from './NewMatchWizard';
import { StartMatchSheet } from './StartMatchSheet';
import type { Match, Player } from '../types';

/** Detail of a match In programma (opened from the Partite list): who plays, when, tournament, format, rules and who
 *  serves. "Avvia partita" opens the "Chi serve per primo?" sheet and, once confirmed, the match is In corso and this
 *  route shows the tracker. "Modifica dettagli" reopens the wizard on the match. */
export function UpcomingMatch({ match, player }: { match: Match; player: Player | undefined }) {
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tournament = useLiveQuery(
    async () => match.tournament_id ? db.tournaments.get(match.tournament_id) : undefined,
    [match.tournament_id],
  );

  const playerName = playerFullName(player);
  const category = player ? playerAgeCategory(player, Number(match.match_date.slice(0, 4))) : null;
  const playerDetails = [fitpRankingCode(match.player_ranking_snapshot), category ? tournamentCategoryLabel(category.id) : '']
    .filter(Boolean).join(' · ');
  const opponentDetails = fitpRankingCode(match.opponent_ranking_snapshot) || 'Avversario';
  const server = match.first_server === 'player' ? playerName : match.first_server === 'opponent' ? match.opponent : null;

  async function confirm(firstServer: NonNullable<Match['first_server']>) {
    setBusy(true);
    setError(null);
    try {
      // The live query of the match switches this route to the tracker once the match is In corso.
      await startMatch(match.family_id, match.id, firstServer);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossibile avviare la partita.');
      setBusy(false);
    }
  }

  return <div className="um-page">
    <header className="um-header">
      <button type="button" className="um-back" aria-label="Indietro" onClick={() => navigate('/matches')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <h1>Partita in programma</h1>
      <div className="um-players">
        <div className="um-player">
          <div className="um-avatar" aria-hidden="true">{initial(playerName)}</div>
          <strong>{playerName}</strong>
          {playerDetails && <small>{playerDetails}</small>}
        </div>
        <div className="um-vs" aria-hidden="true">vs</div>
        <div className="um-player">
          <div className="um-avatar opponent" aria-hidden="true">{initial(match.opponent)}</div>
          <strong>{match.opponent}</strong>
          <small>{opponentDetails}</small>
        </div>
      </div>
      <div className="um-status"><span>In programma · {scheduleLabel(match, ', ')}</span></div>
    </header>
    <main className="um-panel">
      <dl className="um-summary">
        <div><dt>Torneo</dt><dd>{tournament?.name ?? 'Nessun torneo'}</dd></div>
        <div><dt>Formato</dt><dd>{matchFormatLabel(match)}</dd></div>
        <div><dt>Regole</dt><dd>{matchRulesLabel(match)}</dd></div>
        <div><dt>Chi serve</dt><dd className={server ? '' : 'undecided'}>{server ?? 'Da decidere'}</dd></div>
      </dl>
      <button type="button" className="um-start" onClick={() => { setError(null); setBusy(false); setSheetOpen(true); }}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="#0B2A5B" stroke="#0B2A5B" strokeWidth="2" strokeLinejoin="round" /></svg>
        Avvia partita
      </button>
      <button type="button" className="um-edit" onClick={() => setEditing(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#17488F" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
        Modifica dettagli
      </button>
    </main>
    {sheetOpen && <StartMatchSheet playerName={playerName} opponent={match.opponent} initialServer={match.first_server}
      busy={busy} error={error} onCancel={() => setSheetOpen(false)} onConfirm={server => void confirm(server)} />}
    {editing && <NewMatch match={match} onClose={() => setEditing(false)} />}
  </div>;
}
