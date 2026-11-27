import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { persistSnapshotStorage } from './db/database';
import './features/sports/sports.css';
import AuthStatus from './features/auth/AuthStatus';
import { useFamily } from './features/families/FamilyContextDefinition';
import matchesNavIcon from './assets/icone/trasparente/512/partite.png';
import matchesActiveIcon from './assets/icone/chiaro/256/partite.png';
import tournamentsActiveIcon from './assets/icone/chiaro/256/tornei.png';
// Same trophy with a light blue pedestal (the gradient of the statistics icon's third bar): the standard one has a
// dark blue pedestal that disappears on the dark nav bar.
import matchesDarkNavIcon from './assets/icone/trasparente/512/partite-sfondo-scuro.png';
import statisticsIcon from './assets/icone/trasparente/512/statistiche.png';
import homeActiveIcon from './assets/icone/scuro/512/home.png';
import homeIcon from './assets/icone/trasparente/512/home.png';
import settingsIcon from './assets/icone/trasparente/512/impostazioni.png';
import settingsActiveIcon from './assets/icone/chiaro/256/impostazioni.png';
import playersActiveIcon from './assets/icone/scuro/256/players.png';
import clubsActiveIcon from './assets/icone/scuro/256/campo.png';
import './design.css';
import { HomeRoute } from './screens/HomeScreen';
import { Matches } from './screens/MatchesScreen';
import { Tournaments } from './screens/TournamentsScreen';
import { Players } from './screens/PlayersScreen';
import { Clubs } from './screens/ClubsScreen';
import { Tracker } from './screens/TrackerScreen';
import { Dashboard } from './screens/StatisticsScreen';
import { Settings } from './screens/SettingsScreen';

export default function TennisApp() {
  const [online, setOnline] = useState(navigator.onLine);
  const location = useLocation();
  const { activeFamily, loading: workspaceLoading, error: workspaceError } = useFamily();

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

  const tracking = location.pathname.startsWith('/match/');
  const onHome = location.pathname === '/';
  // Tornei is a section of Partite: same theme; its own item replaces Partite in the bottom bar.
  const onTournaments = location.pathname === '/tournaments';
  const onMatches = location.pathname === '/matches' || onTournaments;
  const onSettings = location.pathname === '/settings';
  const onPlayers = location.pathname === '/players';
  const onClubs = location.pathname === '/clubs';
  const darkNav = onMatches || onSettings;

  // Screens that paint their own background down to the bottom edge, and the colour of the side bands.
  const fullBleed = tracking || onMatches || onSettings || onPlayers || onClubs;
  const shellTheme = tracking || onMatches || onSettings ? ' shell-dark' : onHome ? ' shell-light' : onPlayers || onClubs ? ' shell-soft' : '';

  return <div className={`app-shell${fullBleed ? ' full-bleed' : ''}${shellTheme}`}>
    <header className="topbar">
      <img className="brand-logo" src="/tennis-kpi-logo.svg" alt="Tennis KPI Tracker" />
      <div className="topbar-actions">
        <span className={`status ${online ? 'online' : 'offline'}`}>{online ? 'Online' : 'Offline'}</span>
        <AuthStatus />
      </div>
    </header>
    <aside className="desktop-sidebar">
      <NavLink to="/" end>Dashboard</NavLink>
      <NavLink to="/matches">Le mie partite</NavLink>
      <NavLink to="/players">Giocatori</NavLink>
      <NavLink to="/dashboard">Statistiche</NavLink>
      <NavLink to="/settings">Impostazioni</NavLink>
    </aside>
    {!workspaceLoading && !activeFamily && (
      <p className="family-feedback error" role="alert">
        {workspaceError ?? 'Impossibile inizializzare lo spazio locale.'}
      </p>
    )}
    <main><Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/matches" element={<Matches />} />
      <Route path="/tournaments" element={<Tournaments />} />
      <Route path="/players" element={<Players />} />
      <Route path="/clubs" element={<Clubs />} />
      <Route path="/match/:id" element={<Tracker />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></main>
    <nav className={`bottom-nav${tracking ? ' tracker-hidden' : ''}${darkNav ? ' nav-dark' : ''}`}>
      <NavLink to="/" end><img src={onHome ? homeActiveIcon : homeIcon} alt="" />Home</NavLink>
      <NavLink to="/dashboard"><img src={statisticsIcon} alt="" />Statistiche</NavLink>
      {/* Tornei, a section of Partite, replaces its item with its own, in the same icon style. */}
      {onTournaments
        ? <NavLink to="/tournaments"><img src={tournamentsActiveIcon} alt="" />Tornei</NavLink>
        : <NavLink to="/matches"><img src={onMatches ? matchesActiveIcon : darkNav ? matchesDarkNavIcon : matchesNavIcon} alt="" />Partite</NavLink>}
      {/* Sections of Impostazioni (Giocatori, Club) replace its item with their own, in the same icon style. */}
      {onPlayers
        ? <NavLink to="/players"><img src={playersActiveIcon} alt="" />Giocatori</NavLink>
        : onClubs
          ? <NavLink to="/clubs"><img src={clubsActiveIcon} alt="" />Club</NavLink>
          : <NavLink to="/settings"><img src={onSettings ? settingsActiveIcon : settingsIcon} alt="" />Impostazioni</NavLink>}
    </nav>
  </div>;
}
