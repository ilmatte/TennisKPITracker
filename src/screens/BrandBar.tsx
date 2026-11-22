import './BrandBar.css';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { supabase } from '../services/supabase/client';
import tennisLogo from '../assets/logo.svg';

/** Logo + "Tennis KPI Tracker" (top left) and profile button (top right).
 *  Positioned absolutely: the parent screen must be `position: relative`. */
export function BrandBar({ shadow = false }: { shadow?: boolean }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  async function handleProfileAction() {
    if (user) {
      navigate('/settings');
      return;
    }
    if (!supabase || pending) return;
    setPending(true);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    });
  }

  return <>
    <div className={`brand-bar-logo${shadow ? ' shadow' : ''}`}>
      <img src={tennisLogo} alt="" />
      <div>Tennis<br />KPI Tracker</div>
    </div>
    <button className="brand-bar-profile" type="button" onClick={() => void handleProfileAction()} disabled={pending || loading}
      aria-label={user ? 'Apri impostazioni profilo' : 'Accedi con Google'} title={user ? 'Profilo' : 'Accedi con Google'}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="9" r="3.6" /><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5" /></svg>
    </button>
  </>;
}
