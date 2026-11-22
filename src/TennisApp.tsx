import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { persistSnapshotStorage } from './db/database';
import './features/sports/sports.css';
import AuthStatus from './features/auth/AuthStatus';
import { useFamily } from './features/families/FamilyContextDefinition';
import matchesNavIcon from './assets/icone/trasparente/512/partite.png';
import statisticsIcon from './assets/icone/trasparente/512/statistiche.png';
import homeIcon from './assets/icone/scuro/512/home.png';
import settingsIcon from './assets/icone/trasparente/512/impostazioni.png';
import './design.css';
import { HomeRoute } from './screens/HomeScreen';
import { Matches } from './screens/MatchesScreen';
import { Players } from './screens/PlayersScreen';
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

  return <div className={`app-shell${tracking ? ' tracker-active' : ''}`}>
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
      <Route path="/players" element={<Players />} />
      <Route path="/match/:id" element={<Tracker />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></main>
    <nav className={`bottom-nav${tracking ? ' tracker-hidden' : ''}`}>
      <NavLink to="/" end><img src={homeIcon} alt="" />Home</NavLink>
      <NavLink to="/dashboard"><img src={statisticsIcon} alt="" />Statistiche</NavLink>
      <NavLink to="/matches"><img src={matchesNavIcon} alt="" />Partite</NavLink>
      <NavLink to="/settings"><img src={settingsIcon} alt="" />Impostazioni</NavLink>
    </nav>
  </div>;
}
