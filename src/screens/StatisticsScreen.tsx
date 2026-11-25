import './Statistics.css';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db, getMatchPoints } from '../db/database';
import { freeErrorStats, serveKpi, servicePlusOne } from '../features/kpi/kpi';
import { useFamily } from '../features/families/FamilyContextDefinition';
import type { ScoredPoint } from '../types';
export function Dashboard() {
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
  const playerErrors = freeErrorStats(points);
  const playerPlusOne = servicePlusOne(points, 'player');
  const opponentPlusOne = servicePlusOne(points, 'opponent');
  const data = [
    { name: 'Tu', Punti: player.pointsWon, Errori: playerErrors.total },
    { name: 'Avversario', Punti: opponent.pointsWon },
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
      <Kpi label="Rally" value={playerErrors.rally} />
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
