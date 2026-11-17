import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { jsPDF } from 'jspdf';
import { db, persistSnapshotStorage, seedPlayers } from './db/database';
import type { Match, Player, Point } from './types';
import { deriveGameScore, deriveSetScore, getServer, sortedPoints } from './features/scoring/scoring';
import { freeErrorStats, serveKpi, servicePlusOne } from './features/kpi/kpi';

const stamp = () => new Date().toISOString();

export default function TennisApp() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    seedPlayers(); persistSnapshotStorage();
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return <BrowserRouter><div className="app-shell">
    <header className="topbar"><div><span className="brand-mark">TK</span><strong>Tennis KPI</strong></div><span className={`status ${online ? 'online' : 'offline'}`}>{online ? 'Online' : 'Offline'}</span></header>
    <main><Routes>
      <Route path="/" element={<Matches />} /><Route path="/players" element={<Players />} />
      <Route path="/match/:id" element={<Tracker />} /><Route path="/dashboard" element={<Dashboard />} />
      <Route path="/settings" element={<Settings />} />
    </Routes></main>
    <nav className="bottom-nav"><NavLink to="/">Partite</NavLink><NavLink to="/players">Giocatori</NavLink><NavLink to="/dashboard">KPI</NavLink><NavLink to="/settings">Altro</NavLink></nav>
  </div></BrowserRouter>;
}

function Matches() {
  const matches = useLiveQuery(async () => (await db.matches.toArray()).filter(match => !match.deleted).sort((a, b) => b.matchDate.localeCompare(a.matchDate)), []) ?? [];
  const [newOpen, setNewOpen] = useState(false); const navigate = useNavigate();
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">Archivio</p><h1>Partite</h1></div><button className="primary" onClick={() => setNewOpen(true)}>+ Nuova</button></div>
    {newOpen && <NewMatch onClose={() => setNewOpen(false)} />}
    <div className="match-list">{matches.map(match => <MatchCard key={match.id} match={match} open={() => navigate(`/match/${match.id}`)} />)}
      {!matches.length && <div className="empty-state"><strong>Nessuna partita</strong><span>Crea la prima partita per iniziare il tracking.</span></div>}</div>
  </div>;
}

function MatchCard({ match, open }: { match: Match; open: () => void }) {
  const points = useLiveQuery(() => db.points.where('matchId').equals(match.id).filter(p => !p.deleted).toArray(), [match.id]) ?? [];
  return <button className="match-card" onClick={open}><div className="match-card-top"><span className={`chip ${match.status}`}>{match.status === 'completed' ? 'Terminata' : 'In corso'}</span><span>{new Date(match.matchDate).toLocaleDateString('it-IT')}</span></div><strong>{match.playerFirstNameSnapshot} {match.playerLastNameSnapshot} <span>vs</span> {match.opponent}</strong><div className="match-meta"><span>{match.playerRankingSnapshot} · {match.playerCategorySnapshot}</span><span>{match.tournament || 'Amichevole'}</span></div><div className="set-scores">{[1,2,3].map(n => { const s = deriveSetScore(points,n,match); return <span key={n}>{s.player}-{s.opponent}</span>; })}</div></button>;
}

function NewMatch({ onClose }: { onClose: () => void }) {
  const players = useLiveQuery(async () => (await db.players.toArray()).filter(player => !player.deleted), []) ?? [];
  const navigate = useNavigate();
  const [playerId,setPlayerId] = useState(''); const [opponent,setOpponent] = useState('');
  const [matchDate,setMatchDate] = useState(new Date().toISOString().slice(0,10)); const [tournament,setTournament] = useState('');
  const [sets,setSets] = useState<3|5>(3); const [third,setThird] = useState<'normal'|'super-tiebreak'>('normal');
  const [firstServer,setFirstServer] = useState<'player'|'opponent'>('player'); const [deuce,setDeuce] = useState(true); const [tb363,setTb363] = useState(true);
  useEffect(() => { if (!playerId && players.length) setPlayerId(players.find(p => p.firstName === 'Alessandro')?.id || players[0].id); }, [players,playerId]);
  const selected = players.find(p => p.id === playerId);
  async function create() {
    if (!selected || !opponent.trim()) return;
    const t=stamp(); const match: Match={id:crypto.randomUUID(),matchDate,playerId:selected.id,playerFirstNameSnapshot:selected.firstName,playerLastNameSnapshot:selected.lastName,playerRankingSnapshot:selected.ranking,playerCategorySnapshot:selected.category,opponent:opponent.trim(),tournament:tournament.trim(),numberOfSets:sets,thirdSetType:third,superTiebreakTarget:10,tiebreakTarget:10,tiebreakStartsAt363:tb363,deuceSinglePoint:deuce,firstServer,status:'in-progress',createdAt:t,updatedAt:t,version:1};
    await db.matches.put(match); await db.syncQueue.put({id:crypto.randomUUID(),entityType:'matches',entityId:match.id,operation:'upsert',payload:match,createdAt:t,attempts:0}); onClose(); navigate(`/match/${match.id}`);
  }
  return <div className="modal-backdrop"><div className="modal-sheet"><div className="modal-heading"><h2>Nuova partita</h2><button className="icon-button" onClick={onClose}>×</button></div>
    <label>Data partita<input type="date" value={matchDate} onChange={e=>setMatchDate(e.target.value)} /></label>
    <label>Giocatore<select value={playerId} onChange={e=>setPlayerId(e.target.value)}>{players.map(p=><option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}</select></label>
    {selected && <div className="snapshot-preview"><span>{selected.ranking}</span><span>{selected.category}</span><small>Dati congelati alla creazione</small></div>}
    <label>Avversario<input value={opponent} onChange={e=>setOpponent(e.target.value)} placeholder="Nome avversario" /></label><label>Torneo<input value={tournament} onChange={e=>setTournament(e.target.value)} /></label>
    <div className="form-grid"><label>Set<select value={sets} onChange={e=>setSets(Number(e.target.value) as 3|5)}><option value={3}>Al meglio dei 3</option><option value={5}>Al meglio dei 5</option></select></label><label>Terzo set<select value={third} onChange={e=>setThird(e.target.value as 'normal'|'super-tiebreak')}><option value="normal">Normale</option><option value="super-tiebreak">Super tie-break</option></select></label></div>
    <label className="toggle-row"><span>Chi serve per primo</span><select value={firstServer} onChange={e=>setFirstServer(e.target.value as 'player'|'opponent')}><option value="player">Tu</option><option value="opponent">Avversario</option></select></label>
    <label className="toggle-row"><span>Punto secco al 40-40</span><input type="checkbox" checked={deuce} onChange={e=>setDeuce(e.target.checked)} /></label><label className="toggle-row"><span>Tie-break da 3-3</span><input type="checkbox" checked={tb363} onChange={e=>setTb363(e.target.checked)} /></label>
    <button className="primary wide" disabled={!selected||!opponent.trim()} onClick={create}>Avvia partita</button>
  </div></div>;
}

function Players() {
  const players=useLiveQuery(async()=> (await db.players.toArray()).filter(player=>!player.deleted),[])??[]; const [editing,setEditing]=useState<Player|null>(null);
  async function save(p:Player){ const t=stamp(); const u={...p,updatedAt:t,version:p.version+1}; await db.players.put(u); await db.syncQueue.put({id:crypto.randomUUID(),entityType:'players',entityId:u.id,operation:'upsert',payload:u,createdAt:t,attempts:0}); setEditing(null); }
  function add(){const t=stamp();setEditing({id:crypto.randomUUID(),firstName:'',lastName:'',birthDate:'',category:'',ranking:'',createdAt:t,updatedAt:t,version:1});}
  async function remove(p:Player){await db.players.put({...p,deleted:true,updatedAt:stamp(),version:p.version+1});setEditing(null);}
  return <div className="page"><div className="page-heading"><div><p className="eyebrow">Anagrafica</p><h1>Giocatori</h1></div><button className="primary" onClick={add}>+ Aggiungi</button></div><div className="player-list">{players.map(p=><button className="player-row" key={p.id} onClick={()=>setEditing(p)}><div className="avatar">{p.firstName[0]}{p.lastName[0]}</div><div><strong>{p.firstName} {p.lastName}</strong><span>{p.category||'Nessuna categoria'} · {p.ranking||'Nessuna classifica'}</span></div><span className="chevron">›</span></button>)}</div>{editing&&<PlayerModal player={editing} onClose={()=>setEditing(null)} onSave={save} onDelete={players.some(p=>p.id===editing.id)?()=>remove(editing):undefined}/>}</div>;
}

function PlayerModal({player,onClose,onSave,onDelete}:{player:Player;onClose:()=>void;onSave:(p:Player)=>void;onDelete?:()=>void}){const[draft,setDraft]=useState(player);return <div className="modal-backdrop"><div className="modal-sheet"><div className="modal-heading"><h2>{draft.firstName?'Modifica giocatore':'Nuovo giocatore'}</h2><button className="icon-button" onClick={onClose}>×</button></div><div className="form-grid"><label>Nome<input value={draft.firstName} onChange={e=>setDraft({...draft,firstName:e.target.value})}/></label><label>Cognome<input value={draft.lastName} onChange={e=>setDraft({...draft,lastName:e.target.value})}/></label></div><label>Data di nascita<input type="date" value={draft.birthDate||''} onChange={e=>setDraft({...draft,birthDate:e.target.value})}/></label><div className="form-grid"><label>Categoria<input value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value})}/></label><label>Classifica FITP<input value={draft.ranking} onChange={e=>setDraft({...draft,ranking:e.target.value})}/></label></div>{onDelete&&<button className="danger" onClick={onDelete}>Elimina giocatore</button>}<button className="primary wide" disabled={!draft.firstName.trim()} onClick={()=>onSave(draft)}>Salva</button></div></div>}

function Tracker(){const{id}=useParams();const match=useLiveQuery(()=>db.matches.get(id!),[id]);const points=useLiveQuery(()=>db.points.where('matchId').equals(id!).filter(p=>!p.deleted).sortBy('pointNumber'),[id])??[];const[setNumber,setSetNumber]=useState(1);const[gameNumber]=useState(1);const[winner,setWinner]=useState<'player'|'opponent'>('player');const[shotCount,setShotCount]=useState(1);const[doubleFault,setDoubleFault]=useState(false);const[secondServe,setSecondServe]=useState(false);const[freeError,setFreeError]=useState(false);const[errorPlayer,setErrorPlayer]=useState<'player'|'opponent'>('opponent');const[attack,setAttack]=useState(false);const[pressure,setPressure]=useState(false);if(!match)return <div className="page"><div className="empty-state">Partita non trovata</div></div>;
  useEffect(()=>{if(doubleFault)setWinner('opponent')},[doubleFault]);useEffect(()=>{if(freeError)setWinner(errorPlayer==='player'?'opponent':'player')},[freeError,errorPlayer]);
  const activeMatch=match;
  const game=sortedPoints(points,setNumber,gameNumber);const score=deriveGameScore(game,activeMatch.deuceSinglePoint);const setScore=deriveSetScore(points,setNumber,activeMatch);
  async function save(){const t=stamp();const p:Point={id:crypto.randomUUID(),matchId:activeMatch.id,setNumber,gameNumber,pointNumber:game.length+1,winner,server:getServer(activeMatch,setNumber,gameNumber),secondServe,doubleFault,shotCount,freeError,errorPlayer:freeError?errorPlayer:undefined,errorCategory:freeError?'other':undefined,attackError:attack,pressureSituation:pressure,pressureErrorPlayer:pressure?errorPlayer:undefined,createdAt:t,updatedAt:t,version:1};await db.points.put(p);await db.syncQueue.put({id:crypto.randomUUID(),entityType:'points',entityId:p.id,operation:'upsert',payload:p,createdAt:t,attempts:0});setDoubleFault(false);setSecondServe(false);setFreeError(false);setAttack(false);setPressure(false);setShotCount(1);}
  async function remove(p:Point){await db.points.put({...p,deleted:true,updatedAt:stamp(),version:p.version+1});}
  return <div className="tracking-page"><div className="tracking-header"><button className="icon-button" onClick={()=>history.back()} aria-label="Indietro">‹</button><div><span>SET {setNumber}</span><strong>{match.playerFirstNameSnapshot} vs {match.opponent}</strong></div><button className="icon-button" onClick={()=>db.matches.put({...match,status:'completed',updatedAt:stamp(),version:match.version+1})} aria-label="Termina">✓</button></div><div className="scoreboard"><div><span>Tu</span><strong>{score.player}</strong></div><div className="game-count"><strong>{setScore.player}-{setScore.opponent}</strong><span>Game {gameNumber}</span></div><div><span>{match.opponent}</span><strong>{score.opponent}</strong></div></div><div className="set-tabs">{[1,2,3].slice(0,match.numberOfSets).map(n=><button key={n} className={n===setNumber?'active':''} onClick={()=>setSetNumber(n)}>Set {n}</button>)}</div><div className="tracking-controls"><div className="winner-grid"><button className={`winner player ${winner==='player'?'active':''}`} onClick={()=>setWinner('player')}>Punto tuo</button><button className={`winner opponent ${winner==='opponent'?'active':''}`} onClick={()=>setWinner('opponent')}>Punto avversario</button></div><div className="quick-options"><button className={secondServe?'active':''} onClick={()=>setSecondServe(v=>!v)}>Seconda palla</button><button className={doubleFault?'active danger':''} onClick={()=>setDoubleFault(v=>!v)}>Doppio fallo</button><button className={freeError?'active':''} onClick={()=>setFreeError(v=>!v)}>Errore gratuito</button></div>{freeError&&<div className="quick-options"><button className={errorPlayer==='player'?'active':''} onClick={()=>setErrorPlayer('player')}>Errore mio</button><button className={errorPlayer==='opponent'?'active':''} onClick={()=>setErrorPlayer('opponent')}>Errore avversario</button></div>}<label className="shot-control"><span>Colpi complessivi</span><div><button onClick={()=>setShotCount(v=>Math.max(1,v-1))}>−</button><strong>{shotCount}</strong><button onClick={()=>setShotCount(v=>v+1)}>+</button></div></label><div className="quick-options"><button className={attack?'active':''} onClick={()=>setAttack(v=>!v)}>Errore in attacco</button><button className={pressure?'active':''} onClick={()=>setPressure(v=>!v)}>Pressione</button></div><button className="primary save-point" onClick={save}>Salva punto</button></div>{game.length>0&&<div className="point-history"><h3>Punti del game</h3>{game.map(p=><div className="point-row" key={p.id}><span>{p.pointNumber}</span><strong>{p.winner==='player'?'Tu':match.opponent}</strong><span>{p.shotCount} colpi</span><button onClick={()=>remove(p)}>Elimina</button></div>)}</div>}</div>;
}

function Dashboard(){const matches=useLiveQuery(async()=> (await db.matches.toArray()).filter(match=>!match.deleted),[])??[];const[matchId,setMatchId]=useState('all');const points=useLiveQuery(async()=>matchId==='all'?db.points.filter(p=>!p.deleted).toArray():db.points.where('matchId').equals(matchId).filter(p=>!p.deleted).toArray(),[matchId])??[];const player=serveKpi(points,'player');const opponent=serveKpi(points,'opponent');const pe=freeErrorStats(points,'player');const oe=freeErrorStats(points,'opponent');const pp=servicePlusOne(points,'player');const op=servicePlusOne(points,'opponent');const data=[{name:'Tu',Punti:player.pointsWon,Errori:pe.total},{name:'Avversario',Punti:opponent.pointsWon,Errori:oe.total}];return <div className="page"><div className="page-heading"><div><p className="eyebrow">Analisi</p><h1>Dashboard KPI</h1></div></div><label className="filter"><span>Partita</span><select value={matchId} onChange={e=>setMatchId(e.target.value)}><option value="all">Tutte le partite</option>{matches.map(m=><option key={m.id} value={m.id}>{new Date(m.matchDate).toLocaleDateString('it-IT')} · {m.opponent}</option>)}</select></label><section className="dashboard-section"><h2>Servizio</h2><div className="kpi-grid"><Kpi label="Prime palle" value={`${player.firstServePercentage.toFixed(0)}%`}/><Kpi label="Doppi falli" value={player.doubleFaults}/><Kpi label="Punti al servizio" value={player.pointsWon}/><Kpi label="Seconda palla" value={player.secondServes}/></div></section><section className="dashboard-section"><h2>Errori gratuiti</h2><div className="kpi-grid"><Kpi label="Totali tu" value={pe.total}/><Kpi label="Entro 4" value={pe.under4}/><Kpi label="Rally" value={pe.rally}/><Kpi label="Pressione" value={pe.pressure}/></div></section><section className="dashboard-section"><h2>Servizio +1</h2><div className="kpi-grid"><Kpi label="Tu" value={`${pp.percentage.toFixed(0)}%`} detail={`${pp.won}/${pp.total}`}/><Kpi label="Avversario" value={`${op.percentage.toFixed(0)}%`} detail={`${op.won}/${op.total}`}/></div></section><section className="dashboard-section"><h2>Confronto</h2><div className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name"/><YAxis/><Tooltip/><Bar dataKey="Punti" fill="#16856b" radius={[4,4,0,0]}/><Bar dataKey="Errori" fill="#d85e38" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div></section></div>}

function Kpi({label,value,detail}:{label:string;value:string|number;detail?:string}){return <div className="kpi"><span>{label}</span><strong>{value}</strong>{detail&&<small>{detail}</small>}</div>}

function Settings(){const[message,setMessage]=useState('');async function jsonExport(){const backup={version:1,exportedAt:stamp(),players:await db.players.toArray(),matches:await db.matches.toArray(),points:await db.points.toArray()};download(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),`tennis-kpi-backup-${new Date().toISOString().slice(0,10)}.json`);setMessage('Backup JSON esportato')}
 async function csvExport(){const points=await db.points.toArray();const csv=['id,set,game,point,winner,server,shotCount,freeError',...points.filter(p=>!p.deleted).map(p=>[p.id,p.setNumber,p.gameNumber,p.pointNumber,p.winner,p.server,p.shotCount,p.freeError].join(','))].join('\n');download(new Blob([csv],{type:'text/csv'}),'tennis-kpi.csv');setMessage('CSV esportato')}
 async function pdfExport(){const doc=new jsPDF();doc.setFontSize(18);doc.text('Tennis KPI Report',14,20);doc.setFontSize(11);doc.text(`Generato il ${new Date().toLocaleString('it-IT')}`,14,30);doc.save('tennis-kpi-report.pdf');setMessage('PDF esportato')}
 async function restore(e:React.ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(!file)return;try{const b=JSON.parse(await file.text());if(b.players)await db.players.bulkPut(b.players);if(b.matches)await db.matches.bulkPut(b.matches);if(b.points)await db.points.bulkPut(b.points);setMessage('Backup ripristinato')}catch{setMessage('File backup non valido')}}
 function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
 return <div className="page"><div className="page-heading"><div><p className="eyebrow">Dati e account</p><h1>Impostazioni</h1></div></div><section className="settings-section"><h2>Cloud</h2><div className="cloud-state"><span>Solo locale</span><small>Supabase non configurato</small></div><button className="secondary wide" disabled>Collega Supabase</button></section><section className="settings-section"><h2>Backup</h2><button className="setting-row" onClick={jsonExport}><span>Esporta JSON completo</span><b>›</b></button><button className="setting-row" onClick={csvExport}><span>Esporta KPI CSV</span><b>›</b></button><button className="setting-row" onClick={pdfExport}><span>Esporta report PDF</span><b>›</b></button><label className="setting-row"><span>Ripristina da JSON</span><b>›</b><input type="file" accept="application/json" onChange={restore}/></label></section><section className="settings-section"><h2>Google Drive</h2><div className="cloud-state"><span>Non collegato</span><small>Integrazione opzionale</small></div><button className="secondary wide" disabled>Collega Google Drive</button></section>{message&&<div className="toast">{message}</div>}</div>;
}
