import './Home.css';
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMatchPoints } from '../db/database';
import { deriveSetScore } from '../features/scoring/scoring';
import { ProfileButton } from '../features/auth/ProfileButton';
import { useFamily } from '../features/families/FamilyContextDefinition';
import tennisLogo from '../assets/logo.svg';
import matchesIcon from '../assets/icone/trasparente/256/partite.png';
import trendIcon from '../assets/icone/trasparente/256/trend.png';
import statisticsIcon from '../assets/icone/trasparente/512/statistiche.png';
import calendarIcon from '../assets/icone/trasparente/512/calendario.png';
import historyIcon from '../assets/icone/trasparente/256/storico.png';
import tennisBallIcon from '../assets/icone/trasparente/512/pallina3d.png';
import { NewMatch } from './NewMatchWizard';
import { playerShortName } from '../features/players/playerNames';
import { STATUS, statusLabel } from '../features/statuses/statuses';
import type { Match, Player, ScoredPoint } from '../types';
export function HomeRoute() {
  const location = useLocation();
  let pendingInvite = false;
  try { pendingInvite = Boolean(sessionStorage.getItem('tennis-kpi-pending-invite')); } catch { /* Continue without a cached invitation. */ }
  if (new URLSearchParams(location.hash.slice(1)).has('invite') || pendingInvite) return <Navigate to="/settings" replace />;
  return <DashboardHome />;
}

export function DashboardHome() {
  const { activeFamily } = useFamily();
  const matches = useLiveQuery(
    async () => activeFamily
      ? (await db.matches.where('family_id').equals(activeFamily.id).toArray())
          .filter(match => !match.deleted).sort((a, b) => b.match_date.localeCompare(a.match_date))
      : [],
    [activeFamily?.id],
  ) ?? [];
  const [newOpen, setNewOpen] = useState(false);
  const [initialPlayerId, setInitialPlayerId] = useState<string | undefined>();
  const navigate = useNavigate();
  const location = useLocation();
  const players = useLiveQuery(
    async () => activeFamily
      ? (await db.players.where('family_id').equals(activeFamily.id).toArray()).filter(player => !player.deleted)
      : [],
    [activeFamily?.id],
  ) ?? [];

  const results = useLiveQuery(async () => {
    if (!activeFamily) return [] as { match: Match; won: boolean }[];
    return (await Promise.all(matches.map(async match => {
      const points = await getMatchPoints(activeFamily.id, match.id);
      let playerSets = 0;
      let opponentSets = 0;
      for (let setNumber = 1; setNumber <= match.number_of_sets; setNumber += 1) {
        const setScore = deriveSetScore(points, setNumber, match);
        if (setScore.player > setScore.opponent) playerSets += 1;
        if (setScore.opponent > setScore.player) opponentSets += 1;
      }
      return { match, won: playerSets > opponentSets };
    }))).filter(item => item.match.status_id === STATUS.completed);
  }, [activeFamily?.id, matches.map(match => `${match.id}:${match.status_id}`).join(',')]) ?? [];

  const wins = results.filter(result => result.won).length;
  const winRate = results.length ? Math.round((wins / results.length) * 100) : 0;
  useEffect(() => {
    const state = location.state as { openNewMatch?: boolean; initialPlayerId?: string } | null;
    if (state?.openNewMatch) {
      setInitialPlayerId(state.initialPlayerId);
      setNewOpen(true);
      navigate('/', { replace: true, state: null });
    }
  }, [location.state, navigate]);

  function openNewMatch() {
    if (!players.length) {
      navigate('/players', { state: { createMatchAfterPlayer: true } });
      return;
    }
    setInitialPlayerId(undefined);
    setNewOpen(true);
  }

  const recentDetails = useLiveQuery(async () => {
    if (!activeFamily) return [] as { match: Match; points: ScoredPoint[]; player: Player | undefined }[];
    const inProgressMatches = matches.filter(match => match.status_id === STATUS.in_progress);
    const completedMatches = matches.filter(match => match.status_id === STATUS.completed);
    const recentMatches = [...inProgressMatches, ...completedMatches].slice(0, 2);
    return Promise.all(recentMatches.map(async match => ({
      match,
      points: await getMatchPoints(activeFamily.id, match.id),
      player: await db.players.get(match.player_id), // also a deleted player, so that the name is still shown
    })));
  }, [activeFamily?.id, matches.map(match => `${match.id}:${match.status_id}`).join(',')]) ?? [];

  return <div className="home-page">
    <section className="home-hero">
      <div className="home-brand">
        <img src={tennisLogo} alt="" />
        <strong>Tennis <span>KPI Tracker</span></strong>
      </div>
      <ProfileButton className="home-profile" />
      <div className="hero-tennis-ball" aria-hidden="true"><span /></div>
      <div className="home-welcome"><p>Benvenuto!</p><span>Monitora, migliora, gioca meglio</span></div>
      <button className="lime-button" onClick={openNewMatch}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
        <span>Nuova Partita</span>
      </button>
    </section>
    <section className="home-summary">
      <button className="summary-heading" onClick={() => navigate('/dashboard')}>
        <span className="summary-title"><img className="summary-kpi-icon" src={statisticsIcon} alt="" />I tuoi KPI</span>
        <svg className="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
      </button>
      <div className="summary-grid">
        <div><strong>{winRate}%</strong><span>Vittorie</span><img className="summary-icon" src={matchesIcon} alt="" /></div>
        <div><strong>{wins ? `+${wins}` : '0%'}</strong><span>vs mese scorso</span><img className="summary-icon" src={trendIcon} alt="" /></div>
        <div><strong>{matches.length}</strong><span>Partite</span><img className="summary-icon" src={calendarIcon} alt="" /></div>
      </div>
    </section>
    <section className="home-recent">
      <button className="summary-heading" onClick={() => navigate('/matches')}>
        <span className="summary-title"><img className="recent-history-icon" src={historyIcon} alt="" />Le tue ultime partite</span>
        <svg className="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
      </button>
      <div className="recent-list">
        {recentDetails.map(({ match, points, player }) => {
          let playerSets = 0;
          let opponentSets = 0;
          for (let setNumber = 1; setNumber <= match.number_of_sets; setNumber += 1) {
            const score = deriveSetScore(points, setNumber, match);
            if (score.player > score.opponent) playerSets += 1;
            if (score.opponent > score.player) opponentSets += 1;
          }
          const inProgress = match.status_id === STATUS.in_progress;
          const won = !inProgress && playerSets > opponentSets;
          const setLabels = [1, 2, 3].map(setNumber => deriveSetScore(points, setNumber, match)).filter(score => score.player || score.opponent);
          const scoreText = setLabels.map(score => `${score.player}-${score.opponent}`).join(' ');
          return <button className="recent-match" key={match.id} onClick={() => navigate(`/match/${match.id}`)}>
            <img className="recent-match-ball" src={tennisBallIcon} alt="" />
            <span className="recent-info"><strong>{playerShortName(player)} vs {match.opponent}</strong><small>{new Date(match.match_date).toLocaleDateString('it-IT')}</small></span>
            <strong className="recent-score">{scoreText || '—'}</strong>
            <span className={`match-result ${inProgress ? 'in-progress' : won ? 'win' : 'loss'}`}>{inProgress ? statusLabel(STATUS.in_progress, 'match') : won ? 'Vinta' : 'Persa'}</span>
            <svg className="recent-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
          </button>;
        })}
        {!matches.length && <div className="empty-state"><strong>Nessuna partita</strong><span>Crea la prima partita per iniziare il tracking.</span></div>}
      </div>
    </section>
    {newOpen && <NewMatch initialPlayerId={initialPlayerId} onClose={() => setNewOpen(false)} />}
  </div>;
}
