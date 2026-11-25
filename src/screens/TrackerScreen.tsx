import './Tracker.css';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMatchPoints } from '../db/database';
import { nextPointNumber } from '../db/pointNumbers';
import { configuredSetNavigation, deriveGameScore, deriveSetScore, getGameServer, getServer, isActionAvailable, serverOverrideKey, tiebreakServer, type ServerOverrides, type Side, isSetComplete, unavailableReason, isSuperTiebreakSet, nextGameNumber, pointsToGame, tiebreakTarget, resolvePointAction, sortedPoints, type PointAction } from '../features/scoring/scoring';
import { countGameDescendants, countMatchDescendants, countSetDescendants, softDeleteGame, softDeleteMatch, softDeletePoint, softDeleteSet, updateGame, updateMatch, updatePoint, updateSet, type PointChanges } from '../db/sportsMutations';
import { useFamily } from '../features/families/FamilyContextDefinition';
import { isWinningPointType, POINT_TYPES } from '../features/scoring/pointTypes';
import currentGameBackground from '../assets/background-currentgame/background-currentgame-3x.png';
import currentGameFooter from '../assets/footer-currentgame/footer-currentgame-3x.png';
import freeErrorIcon from '../assets/icone/currentgame/errore-gratuito-chiaro.svg';
import doubleFaultIcon from '../assets/icone/currentgame/doppio-fallo-chiaro.svg';
import pointLostIcon from '../assets/icone/currentgame/perso-chiaro.svg';
import greatShotIcon from '../assets/icone/currentgame/bel-colpo-chiaro.svg';
import pointWonIcon from '../assets/icone/currentgame/vinto-chiaro.svg';
import aceIcon from '../assets/icone/currentgame/ace-chiaro.svg';
import servingIcon from '../assets/icone/trasparente/512/tennista-servizio-trasparente-512.png';
import { MatchEditor } from './MatchesScreen';
import { stamp, mutationError, queueOperation } from './shared';
import type { Game, Point, ScoredPoint, TennisSet } from '../types';
export function Tracker() {
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
  const [trackerError, setTrackerError] = useState<string | null>(null);
  const [editingSet, setEditingSet] = useState<TennisSet | null>(null);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [editingPoint, setEditingPoint] = useState<ScoredPoint | null>(null);
  const [matchMenuOpen, setMatchMenuOpen] = useState(false);
  const [editingMatch, setEditingMatch] = useState(false);
  // Shot counter for the rally being played: +1 per shot, saved with the next point, then reset.
  const [shotCount, setShotCount] = useState(0);
  // Server corrections for games with no points yet (once a point is saved, its stored `serving` is the reference).
  const [serverOverrides, setServerOverrides] = useState<ServerOverrides>({});
  const [shotSheetOpen, setShotSheetOpen] = useState(false);
  const [shotDraft, setShotDraft] = useState(0);
  // "Servizio" selector: whether the server also played the second ball. Saved in second_serve, then reset.
  const [secondServe, setSecondServe] = useState(false);
  // Change-of-ends popup: the key of the last changeover the user dismissed (so each changeover shows once).
  const [dismissedChangeover, setDismissedChangeover] = useState<string | null>(null);
  const swipeStartX = useRef<number | null>(null);
  const swipeHandled = useRef(false);

  const setTabs = match ? configuredSetNavigation(match.number_of_sets, hierarchy.sets) : [];
  const selectedSetNumber = match && setNumber > match.number_of_sets ? 1 : setNumber;
  const currentGameNumber = match ? nextGameNumber(points, selectedSetNumber, match) : 1;
  // A finished set has no game in progress: nextGameNumber then points at its last game.
  const selectedSetFinished = match ? isSetComplete(deriveSetScore(points, selectedSetNumber, match), match, selectedSetNumber) : false;
  const gameNumber = selectedGame ?? currentGameNumber;
  const currentSet = hierarchy.sets.find(set => set.set_number === selectedSetNumber);
  const currentGame = hierarchy.games.find(game => game.set_id === currentSet?.id && game.game_number === gameNumber);
  const gamePoints = sortedPoints(points, selectedSetNumber, gameNumber);
  const currentTiebreak = match ? tiebreakTarget(points, match, selectedSetNumber, gameNumber) : null;
  const gameComplete = match ? Boolean(pointsToGame(gamePoints, 'player', match.deuce_single_point, currentTiebreak)) : false;
  const currentServer = match ? getServer(match, points, selectedSetNumber, gameNumber, serverOverrides) : 'player';
  const gameServer = match ? getGameServer(match, points, selectedSetNumber, gameNumber, serverOverrides) : 'player';
  const setScore = match ? deriveSetScore(points, selectedSetNumber, match) : { player: 0, opponent: 0 };
  const recordedGameNumbers = hierarchy.games.filter(game => game.set_id === currentSet?.id).map(game => game.game_number);
  recordedGameNumbers.push(...points.filter(point => point.set_number === selectedSetNumber).map(point => point.game_number));
  const lastGameNumber = Math.max(currentGameNumber, ...recordedGameNumbers);

  const completedSets = match
    ? hierarchy.sets.filter(set => isSetComplete(deriveSetScore(points, set.set_number, match), match, set.set_number))
    : [];
  const setsToWin = match ? Math.floor(match.number_of_sets / 2) + 1 : Infinity;
  const matchHasWinner = match ? (['player', 'opponent'] as const).some(side =>
    completedSets.filter(set => {
      const score = deriveSetScore(points, set.set_number, match);
      return side === 'player' ? score.player > score.opponent : score.opponent > score.player;
    }).length >= setsToWin) : false;
  useEffect(() => {
    if (!match) return;
    const latestCompleted = Math.max(0, ...completedSets.map(set => set.set_number));
    if (latestCompleted > 0 && (setNumber === 1 || completedSets.some(set => set.set_number === setNumber))) {
      setSetNumber(Math.min(match.number_of_sets, latestCompleted + 1));
      setSelectedGame(null);
    }
  }, [completedSets.map(set => set.set_number).join(','), match?.id, match?.number_of_sets]);

  if (!match || !activeFamily) return <div className="page"><div className="empty-state">Partita non trovata</div></div>;
  const activeMatch = match;

  function selectGame(number: number) {
    setSelectedGame(number === currentGameNumber ? null : number);
  }

  async function savePoint(action: PointAction) {
    if (matchHasWinner || activeMatch.status === 'completed' || gameComplete || !isActionAvailable(action, currentServer, shotCount)) return;
    const created_at = stamp();
    try {
      await db.transaction('rw', [db.matches, db.sets, db.games, db.points, db.syncQueue], async () => {
        const currentMatch = await db.matches.get(activeMatch.id);
        if (!currentMatch || currentMatch.family_id !== activeMatch.family_id || currentMatch.deleted) {
          throw new Error('La partita non è più attiva nello spazio corrente.');
        }
        const existingSet = await db.sets.where('[match_id+set_number]').equals([currentMatch.id, selectedSetNumber]).first();
        const tennisSet: TennisSet = existingSet ? {
          ...existingSet,
          player_games: existingSet.deleted ? 0 : existingSet.player_games,
          opponent_games: existingSet.deleted ? 0 : existingSet.opponent_games,
          deleted: false,
        } : {
          id: crypto.randomUUID(), family_id: currentMatch.family_id, match_id: currentMatch.id, set_number: selectedSetNumber,
          player_games: 0, opponent_games: 0, created_at, updated_at: created_at, version: 1, deleted: false,
        };
        if (tennisSet.family_id !== currentMatch.family_id) {
          throw new Error('Il set selezionato non appartiene alla famiglia attiva.');
        }
        const existingGame = await db.games.where('[set_id+game_number]').equals([tennisSet.id, gameNumber]).first();
        const tennisGame: Game = existingGame ? {
          ...existingGame,
          player_points: existingGame.deleted ? 0 : existingGame.player_points,
          opponent_points: existingGame.deleted ? 0 : existingGame.opponent_points,
          deleted: false,
        } : {
          id: crypto.randomUUID(), family_id: currentMatch.family_id, set_id: tennisSet.id, game_number: gameNumber,
          player_points: 0, opponent_points: 0, created_at, updated_at: created_at, version: 1, deleted: false,
        };
        if (tennisGame.family_id !== currentMatch.family_id) {
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
          return set && game && !stored.deleted && stored.family_id === currentMatch.family_id
            ? [{ ...stored, set_number: set.set_number, game_number: game.game_number }]
            : [];
        });
        const server = getServer(currentMatch, scoredPoints, selectedSetNumber, gameNumber, serverOverrides);
        const reason = unavailableReason(action, server, shotCount);
        if (reason) throw new Error(`${action === 'ace' ? 'Ace' : 'Doppio fallo'}: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`);
        const result = resolvePointAction(action, server);
        const historicalGamePoints = await db.points.where('game_id').equals(tennisGame.id).toArray();
        const point: Point = {
          id: crypto.randomUUID(), family_id: activeMatch.family_id, game_id: tennisGame.id,
          point_number: nextPointNumber(historicalGamePoints),
          won: result.won, serving: server === 'player',
          second_serve: result.secondServe || secondServe, point_type_id: result.pointTypeId,
          shot_count: shotCount > 0 ? shotCount : result.shotCount,
          created_at, updated_at: created_at, version: 1, deleted: false,
        };
        const updatedPoints: ScoredPoint[] = [...scoredPoints, { ...point, set_number: selectedSetNumber, game_number: gameNumber }];
        const updatedGamePoints = sortedPoints(updatedPoints, selectedSetNumber, gameNumber);
        const updatedSetScore = deriveSetScore(updatedPoints, selectedSetNumber, currentMatch);
        const updatedGame: Game = {
          ...tennisGame,
          player_points: updatedGamePoints.filter(existing => existing.won).length,
          opponent_points: updatedGamePoints.filter(existing => !existing.won).length,
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
    setShotCount(0);
    setSecondServe(false);
    setTrackerError(null);
  }

  // "+1 Colpo": a tap adds one shot; so does a horizontal swipe across the button.
  function shotPointerDown(event: PointerEvent<HTMLButtonElement>) {
    swipeStartX.current = event.clientX;
    swipeHandled.current = false;
  }
  function shotPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (swipeStartX.current !== null && Math.abs(event.clientX - swipeStartX.current) > 24) {
      swipeHandled.current = true;
      setShotCount(count => Math.min(99, count + 1));
    }
    swipeStartX.current = null;
  }
  function shotClick() {
    if (swipeHandled.current) {
      swipeHandled.current = false;
      return;
    }
    setShotCount(count => Math.min(99, count + 1));
  }
  function openShotSheet() {
    setShotDraft(shotCount);
    setShotSheetOpen(true);
  }

  /** Corrects who serves the selected game; the following games keep alternating from this one. */
  async function swapGameServer() {
    const newServer: Side = gameServer === 'player' ? 'opponent' : 'player';
    if (!gamePoints.length) {
      setServerOverrides(current => ({ ...current, [serverOverrideKey(selectedSetNumber, gameNumber)]: newServer }));
      return;
    }
    try {
      for (const [index, point] of gamePoints.entries()) {
        const server = currentTiebreak ? tiebreakServer(newServer, index) : newServer;
        if (point.serving === (server === 'player')) continue;
        await updatePoint(activeMatch.family_id, point.id, {
          won: point.won, serving: server === 'player', second_serve: point.second_serve, point_type_id: point.point_type_id,
          shot_count: point.shot_count,
        });
      }
      setTrackerError(null);
    } catch (cause) {
      setTrackerError(cause instanceof Error ? cause.message : 'Impossibile cambiare chi serve.');
    }
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

  async function undoLatestPoint() {
    const latestPoint = gamePoints.at(-1);
    if (!latestPoint) return;
    try {
      await softDeletePoint(activeMatch.family_id, latestPoint.id);
      setTrackerError(null);
    } catch (cause) {
      setTrackerError(cause instanceof Error ? cause.message : 'Impossibile annullare il punto.');
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

  async function removeCurrentMatch() {
    const count = await countMatchDescendants(activeMatch.family_id, activeMatch.id);
    const detail = `${count.sets} set, ${count.games} game e ${count.points} punti`;
    if (!window.confirm(`Eliminare questa partita e i relativi ${detail}?`)) return;
    await softDeleteMatch(activeMatch.family_id, activeMatch.id);
    window.history.back();
  }

  const concludedSets = completedSets
    .filter(set => set.set_number !== selectedSetNumber)
    .sort((a, b) => b.set_number - a.set_number)
    .map(set => ({ id: set.id, number: set.set_number, score: deriveSetScore(points, set.set_number, match) }));
  const hasConcludedSets = concludedSets.length > 0;
  const gameScore = deriveGameScore(gamePoints, match.deuce_single_point, currentTiebreak);
  // Change of ends: before every even game of a set (after the odd ones), every 6 points of a tie-break, and at the
  // start of a set when the previous set ended with an odd number of games (a tie-break counts as one game).
  const previousSetScore = selectedSetNumber > 1 ? deriveSetScore(points, selectedSetNumber - 1, match) : null;
  const startOfSetChange = gameNumber === 1 && gamePoints.length === 0 && previousSetScore !== null
    && (previousSetScore.player + previousSetScore.opponent) % 2 === 1;
  const tiebreakChange = currentTiebreak !== null && gamePoints.length > 0 && gamePoints.length % 6 === 0;
  const oddGameChange = currentTiebreak === null && gameNumber > 1 && gameNumber % 2 === 0 && gamePoints.length === 0;
  const courtChangeDue = selectedGame === null && !gameComplete && (startOfSetChange || tiebreakChange || oddGameChange);
  const changeoverKey = courtChangeDue ? `${match.id}:${selectedSetNumber}:${gameNumber}:${gamePoints.length}` : null;
  const changeoverReason = startOfSetChange ? 'inizio set' : tiebreakChange ? `tie-break · ${gamePoints.length} punti` : 'game dispari';
  const playerName = `${match.player_first_name_snapshot} ${match.player_last_name_snapshot}`.trim() || 'Giocatore';
  const opponentName = match.opponent || 'Avversario';
  const tiebreakLabel = isSuperTiebreakSet(match, selectedSetNumber) ||
    (match.number_of_sets === 5 && match.third_set_type === 'super-tiebreak' && selectedSetNumber === 5 && currentTiebreak === match.super_tiebreak_target)
    ? 'Super tie-break' : 'Tie-break';
  const lostActions: { action: PointAction; label: string; icon: string }[] = [
    { action: 'free_error', label: 'Errore gratuito', icon: freeErrorIcon },
    { action: 'double_fault', label: 'Doppio fallo', icon: doubleFaultIcon },
    { action: 'lost', label: 'Perso', icon: pointLostIcon },
  ];
  const wonActions: { action: PointAction; label: string; icon: string }[] = [
    { action: 'great_shot', label: 'Bel colpo', icon: greatShotIcon },
    { action: 'ace', label: 'Ace', icon: aceIcon },
    { action: 'won', label: 'Vinto', icon: pointWonIcon },
  ];

  return <div className={`cg-page${hasConcludedSets ? ' has-sets' : ''}`} style={{ '--cg-wave': `url(${currentGameBackground})` } as CSSProperties}>
    <header className="cg-hero">
      <button className="cg-round-button cg-back" onClick={() => window.history.back()} aria-label="Indietro">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <h1>{currentTiebreak ? tiebreakLabel : 'Partita in corso'}</h1>
      <button className="cg-round-button cg-menu" onClick={() => setMatchMenuOpen(true)} aria-label="Menu partita">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><circle cx="12" cy="5" r="2.2" /><circle cx="12" cy="12" r="2.2" /><circle cx="12" cy="19" r="2.2" /></svg>
      </button>
      <div className="cg-scores">
        <div className="cg-score-card">
          <span>{playerName}</span>
          <div className="cg-score-value">
            {currentServer === 'player' && <img className="cg-serving left" src={servingIcon} alt="Al servizio" title="Al servizio" />}
            <strong>{gameScore.player}</strong>
            <strong className="cg-score-sizer" aria-hidden="true">AD</strong>
          </div>
        </div>
        <div className="cg-score-card">
          <span>{match.opponent || 'Avversario'}</span>
          <div className="cg-score-value">
            {currentServer === 'opponent' && <img className="cg-serving right" src={servingIcon} alt="Al servizio" title="Al servizio" />}
            <strong>{gameScore.opponent}</strong>
            <strong className="cg-score-sizer" aria-hidden="true">AD</strong>
          </div>
        </div>
      </div>
      <div className="cg-ball" aria-hidden="true">
        <svg width="28.9" height="28.9" viewBox="0 0 48 48"><defs><radialGradient id="cg-pb" cx=".35" cy=".3" r=".85"><stop offset="0" stopColor="#E9FB78" /><stop offset=".55" stopColor="#C8F03A" /><stop offset="1" stopColor="#9CCB1B" /></radialGradient><clipPath id="cg-pc"><circle cx="24" cy="24" r="22" /></clipPath></defs><circle cx="24" cy="24" r="22" fill="url(#cg-pb)" /><g clipPath="url(#cg-pc)" fill="none" stroke="#fff" strokeWidth="3.2"><path d="M10 0C24 14 24 34 10 48" /><path d="M38 0C24 14 24 34 38 48" /></g></svg>
      </div>
      {hasConcludedSets
        ? <div className="cg-set-list">
          <div className="cg-set-row current"><span>{setScore.player}</span><b>SET {selectedSetNumber}</b><span>{setScore.opponent}</span></div>
          {concludedSets.map(set => <div key={set.id} className="cg-set-row">
            <span className={set.score.player > set.score.opponent ? 'won' : ''}>{set.score.player}</span>
            <b>SET {set.number}</b>
            <span className={set.score.opponent > set.score.player ? 'won' : ''}>{set.score.opponent}</span>
          </div>)}
        </div>
        : <div className="cg-set-pills">
          <div className="cg-set-pill"><span className="cg-dot" />Set {selectedSetNumber}&nbsp;&nbsp;•&nbsp;&nbsp;{setScore.player}-{setScore.opponent}</div>
        </div>}
    </header>
    <img className="cg-wave" src={currentGameBackground} alt="" />
    <div className="cg-body">
      <section className="cg-panel">
        <div className="cg-shots">
          <button className="cg-shots-count" onClick={openShotSheet} aria-label={`Modifica numero di colpi: ${shotCount}`}>
            <span>Colpi</span>
            <strong>{shotCount}</strong>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z" /></svg>
          </button>
          <button className="cg-shots-add" aria-label="Aggiungi un colpo" onClick={shotClick} onPointerDown={shotPointerDown} onPointerUp={shotPointerUp} onPointerCancel={() => { swipeStartX.current = null; }}>
            <span className="cg-shots-plus">+1</span>
            <span className="cg-shots-label"><strong>Colpo</strong><small>tocca o scorri</small></span>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l6 6-6 6M12 6l6 6-6 6" /></svg>
          </button>
        </div>
        <div className="cg-serve-balls" role="group" aria-label="Servizio">
          <span>Servizio</span>
          <button className={secondServe ? '' : 'selected'} aria-pressed={!secondServe} onClick={() => setSecondServe(false)}>Solo 1ª palla</button>
          <button className={secondServe ? 'selected' : ''} aria-pressed={secondServe} onClick={() => setSecondServe(true)}>Anche 2ª palla</button>
        </div>
        <div className="cg-actions" role="group" aria-label="Punto perso">
          {lostActions.map(item => <button key={item.action} className="cg-action lost" onClick={() => { if (item.action === 'double_fault') setSecondServe(true); void savePoint(item.action); }} disabled={matchHasWinner || activeMatch.status === 'completed' || gameComplete || !isActionAvailable(item.action, currentServer, shotCount)}
            title={unavailableReason(item.action, currentServer, shotCount) ?? undefined}>
            <img src={item.icon} alt="" /><span>{item.label}</span>
          </button>)}
        </div>
        <div className="cg-spacer" />
        <div className="cg-actions" role="group" aria-label="Punto vinto">
          {wonActions.map(item => <button key={item.action} className="cg-action won" onClick={() => void savePoint(item.action)} disabled={matchHasWinner || activeMatch.status === 'completed' || gameComplete || !isActionAvailable(item.action, currentServer, shotCount)}
            title={unavailableReason(item.action, currentServer, shotCount) ?? undefined}>
            <img src={item.icon} alt="" /><span>{item.label}</span>
          </button>)}
        </div>
        <button className="cg-undo" onClick={() => void undoLatestPoint()} disabled={!gamePoints.length}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12" /></svg>
          Annulla ultimo punto
        </button>
        {gameComplete && <p className="cg-note">Game concluso.</p>}
        {trackerError && <p className="family-feedback error" role="alert">{trackerError}</p>}

        <div className="cg-details">
          {match.number_of_sets > 1 && <div className="cg-chip-row" aria-label="Seleziona set">{setTabs.map(({ set_number, exists }) =>
            <button key={set_number} className={`cg-chip${set_number === selectedSetNumber ? ' active' : ''}`} onClick={() => { setSetNumber(set_number); setSelectedGame(null); }}>
              Set {set_number}<span>{exists ? 'Registrato' : 'Da registrare'}</span>
            </button>
          )}</div>}
          <div className="cg-chip-row" aria-label="Seleziona game">
            {Array.from({ length: lastGameNumber }, (_, index) => index + 1).map(number => {
              const selectedPoints = sortedPoints(points, selectedSetNumber, number);
              const target = tiebreakTarget(points, match, selectedSetNumber, number);
              const result = pointsToGame(selectedPoints, 'player', match.deuce_single_point, target);
              const label = result ? `${result.player}-${result.opponent}` : 'in corso';
              const isCurrent = number === currentGameNumber && !selectedSetFinished;
              return <button key={number} className={`cg-chip${number === gameNumber ? ' active' : ''}${isCurrent ? ' current' : ''}`} onClick={() => selectGame(number)}>
                {target ? tiebreakLabel : `Game ${number}`}<span>{isCurrent ? 'Corrente' : label}</span>
              </button>;
            })}
          </div>
          {gamePoints.length > 0 && <div className="cg-history">
            <h3>Punti del game {gameNumber}</h3>
            {gamePoints.map(point => <div className="cg-history-row" key={point.id}>
              <span>{point.point_number}</span><strong>{point.won ? playerName : opponentName}</strong>
              <span>{point.shot_count} colpi</span>
              <span className="cg-history-actions">
                <button onClick={() => setEditingPoint(point)}>Modifica</button>
                <button onClick={() => void removePoint(point)}>Elimina</button>
              </span>
            </div>)}
          </div>}
        </div>
      </section>
    </div>
    <img className="cg-footer" src={currentGameFooter} alt="" aria-hidden="true" />
    {changeoverKey && changeoverKey !== dismissedChangeover && <CourtChangeOverlay key={changeoverKey}
      subtitle={`Set ${selectedSetNumber}  •  ${setScore.player}-${setScore.opponent}  ·  ${changeoverReason}`}
      playerName={playerName} opponentName={opponentName} onClose={() => setDismissedChangeover(changeoverKey)} />}
    {shotSheetOpen && <div className="cg-sheet-backdrop" onClick={() => setShotSheetOpen(false)}>
      <section className="cg-sheet" role="dialog" aria-modal="true" aria-labelledby="cg-sheet-title" onClick={event => event.stopPropagation()}>
        <div className="cg-sheet-handle" aria-hidden="true" />
        <div className="cg-sheet-head">
          <h3 id="cg-sheet-title">Colpi dello scambio</h3>
          <button className="cg-sheet-close" aria-label="Chiudi" onClick={() => setShotSheetOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <p className="cg-sheet-note">Conteggio automatico: <b>{shotCount}</b>. Correggilo scegliendo un numero.</p>
        <div className="cg-sheet-label">Numeri comuni</div>
        <div className="cg-sheet-presets">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30].map(value =>
            <button key={value} className={value === shotDraft ? 'selected' : ''} aria-pressed={value === shotDraft} onClick={() => setShotDraft(value)}>{value}</button>)}
        </div>
        <div className="cg-sheet-label custom">Numero personalizzato</div>
        <div className="cg-sheet-stepper">
          <button aria-label="Meno uno" onClick={() => setShotDraft(value => Math.max(0, value - 1))}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
          </button>
          <output aria-live="polite">{shotDraft}</output>
          <button aria-label="Più uno" onClick={() => setShotDraft(value => Math.min(99, value + 1))}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </div>
        <button className="cg-sheet-confirm" onClick={() => { setShotCount(shotDraft); setShotSheetOpen(false); }}>Conferma {shotDraft} {shotDraft === 1 ? 'colpo' : 'colpi'}</button>
      </section>
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
    {editingPoint && <PointEditor point={editingPoint} playerName={playerName} opponentName={opponentName} onClose={() => setEditingPoint(null)} onSave={savePointChanges} />}
    {editingMatch && <MatchEditor match={activeMatch} error={trackerError} onClose={() => setEditingMatch(false)} onSave={async changes => {
      try { await updateMatch(activeMatch.family_id, activeMatch.id, changes); setEditingMatch(false); setTrackerError(null); }
      catch (cause) { setTrackerError(cause instanceof Error ? cause.message : 'Impossibile modificare la partita.'); }
    }} />}
    {matchMenuOpen && <div className="tracker-menu-backdrop" onClick={() => setMatchMenuOpen(false)}>
      <div className="tracker-action-menu" role="dialog" aria-label="Menu partita" onClick={event => event.stopPropagation()}>
        <span className="menu-section-label">GAME</span>
        <button onClick={() => { setMatchMenuOpen(false); void swapGameServer(); }}>⇄ <span>Fai servire {gameServer === 'player' ? opponentName : playerName}</span></button>
        <button onClick={() => { setMatchMenuOpen(false); if (currentGame) setEditingGame(currentGame); }}>✎ <span>Modifica game</span></button>
        <button className="menu-delete" onClick={() => { setMatchMenuOpen(false); if (currentGame) void removeGame(currentGame); }}>⌫ <span>Elimina game</span></button>
        <hr /><span className="menu-section-label">SET</span>
        <button onClick={() => { setMatchMenuOpen(false); if (currentSet) setEditingSet(currentSet); }}>✎ <span>Modifica set</span></button>
        <button className="menu-delete" onClick={() => { setMatchMenuOpen(false); if (currentSet) void removeSet(currentSet); }}>⌫ <span>Elimina set</span></button>
        <hr /><span className="menu-section-label">PARTITA</span>
        <button onClick={() => { setMatchMenuOpen(false); setEditingMatch(true); }}>✎ <span>Modifica partita</span></button>
        <button className="menu-delete" onClick={() => { setMatchMenuOpen(false); void removeCurrentMatch(); }}>⌫ <span>Elimina partita</span></button>
        {match.status === 'in-progress' && <button onClick={() => { setMatchMenuOpen(false); void completeMatch(); }}>✓ <span>Termina partita</span></button>}
      </div>
    </div>}
  </div>;
}

const CHANGEOVER_SECONDS = 90;

/** "Cambio campo" popup: animated in, closed by the button or automatically after 90 seconds. */
function CourtChangeOverlay({ subtitle, playerName, opponentName, onClose }: {
  subtitle: string;
  playerName: string;
  opponentName: string;
  onClose: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(CHANGEOVER_SECONDS);
  const [closing, setClosing] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => { confirmRef.current?.focus(); }, []);
  useEffect(() => {
    if (closing) return;
    if (secondsLeft <= 0) { setClosing(true); return; }
    const timer = window.setTimeout(() => setSecondsLeft(seconds => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft, closing]);
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => onCloseRef.current(), 200); // matches the fade-out duration in Tracker.css
    return () => window.clearTimeout(timer);
  }, [closing]);

  const swapArrows = (size: number, color: string, top: number) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={`M4 ${top}h14M14 ${top - 4}l4 4-4 4`} /><path d={`M20 ${top + 8}H6M10 ${top + 4}l-4 4 4 4`} />
  </svg>;

  return <div className={`cg-changeover${closing ? ' closing' : ''}`} onKeyDown={event => { if (event.key === 'Escape') setClosing(true); }}>
    <section className="cg-changeover-card" role="alertdialog" aria-modal="true" aria-labelledby="cg-changeover-title" aria-describedby="cg-changeover-subtitle">
      <div className="cg-changeover-badge">{swapArrows(36, '#0B2A5B', 8)}</div>
      <h2 id="cg-changeover-title">Cambio campo</h2>
      <p id="cg-changeover-subtitle" className="cg-changeover-subtitle">{subtitle}</p>
      <div className="cg-changeover-sides">
        <span>{playerName}</span>
        <span className="cg-changeover-swap">{swapArrows(34, '#C8F03A', 9)}</span>
        <span>{opponentName}</span>
      </div>
      <button ref={confirmRef} className="cg-changeover-ok" onClick={() => setClosing(true)}>Ok, ho cambiato campo</button>
      <p className="cg-changeover-timer">Si chiude da solo tra {secondsLeft} {secondsLeft === 1 ? 'secondo' : 'secondi'}</p>
    </section>
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

function PointEditor({ point, playerName, opponentName, onClose, onSave }: {
  point: ScoredPoint;
  playerName: string;
  opponentName: string;
  onClose: () => void;
  onSave: (changes: PointChanges) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PointChanges>({
    won: point.won,
    serving: point.serving,
    second_serve: point.second_serve,
    point_type_id: point.point_type_id,
    shot_count: point.shot_count,
  });
  const field = <K extends keyof PointChanges>(key: K, value: PointChanges[K]) =>
    setDraft(current => ({ ...current, [key]: value }));
  const [error, setError] = useState<string | null>(null);

  return <div className="modal-backdrop"><div className="modal-sheet">
    <div className="modal-heading"><h2>Modifica punto {point.point_number}</h2><button className="icon-button" onClick={onClose}>×</button></div>
    <div className="form-grid">
      <label>Vincitore<select value={draft.won ? 'player' : 'opponent'} onChange={event => field('won', event.target.value === 'player')}><option value="player">{playerName}</option><option value="opponent">{opponentName}</option></select></label>
      <label>Battitore<select value={draft.serving ? 'player' : 'opponent'} onChange={event => field('serving', event.target.value === 'player')}><option value="player">{playerName}</option><option value="opponent">{opponentName}</option></select></label>
    </div>
    <label>Numero colpi<input type="number" min="1" value={draft.shot_count} onChange={event => field('shot_count', Number(event.target.value))} /></label>
    <label>Tipo di punto<select value={draft.point_type_id} onChange={event => {
      // The type refers to my player, so it also decides who won the point.
      const pointTypeId = Number(event.target.value);
      setDraft(current => ({ ...current, point_type_id: pointTypeId, won: isWinningPointType(pointTypeId) }));
    }}>
      {POINT_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
    </select></label>
    <label className="toggle-row"><span>Seconda di servizio</span><input type="checkbox" checked={draft.second_serve} onChange={event => field('second_serve', event.target.checked)} /></label>
    <p className="family-feedback">Il punteggio del game, quello del set e i KPI saranno ricalcolati al salvataggio.</p>
    {error && <p className="family-feedback error" role="alert">{error}</p>}
    <button className="primary wide" disabled={!Number.isInteger(draft.shot_count) || draft.shot_count < 1}
      onClick={() => void onSave(draft).catch(cause => setError(mutationError(cause, 'Impossibile modificare il punto.', 'Modifica non consentita dal vincolo locale.')))}>Salva modifiche</button>
  </div></div>;
}
