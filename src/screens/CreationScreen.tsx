import './CreationScreen.css';
import type { CSSProperties, ReactNode, Ref } from 'react';
import settingsBackground from '../assets/background-settings.png';
import tennisLogo from '../assets/logo.svg';

/** Full-screen creation form (header with logo, back button and title, then a rounded panel), opened over the
 *  current screen. Used by the "Nuova partita" wizard and by "Nuovo torneo". */
export function CreationScreen({ title, onBack, header, stacked = false, roomy = false, scrollRef, children }: {
  title: string;
  onBack: () => void;
  /** Extra header content under the title (the wizard's step indicator). */
  header?: ReactNode;
  /** Opened over another creation screen. */
  stacked?: boolean;
  /** Larger bottom padding ("Nuovo torneo"). */
  roomy?: boolean;
  scrollRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return <div className={`cw-backdrop${stacked ? ' cw-stacked' : ''}`} ref={scrollRef}>
    <section className="cw-screen" role="dialog" aria-modal="true" aria-label={title}
      style={{ '--cw-bg': `url(${settingsBackground})` } as CSSProperties}>
      <header className="cw-header">
        <div className="brand-bar-logo shadow"><img src={tennisLogo} alt="" /><div>Tennis<br />KPI Tracker</div></div>
        <button className="cw-back" onClick={onBack} aria-label="Indietro">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <h1>{title}</h1>
        {header}
      </header>
      <div className={`cw-panel${roomy ? ' cw-panel-roomy' : ''}`}>{children}</div>
    </section>
  </div>;
}

export const PlusIcon = ({ size = 20, color = '#17488F' }: { size?: number; color?: string }) =>
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;

/** Native select with the design's chevron. */
export function SelectBox({ id, value, onChange, children }: {
  id?: string;
  value: string | number;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return <div className="cw-select-wrap">
    <select id={id} className="cw-select" value={value} onChange={event => onChange(event.target.value)}>{children}</select>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
  </div>;
}

/** Native date input with the design's calendar icon. */
export function DateBox({ id, value, onChange }: { id?: string; value: string; onChange: (value: string) => void }) {
  return <div className="cw-date-wrap">
    <input id={id} className="cw-input" type="date" value={value} required onChange={event => onChange(event.target.value)} />
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0B2A5B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
  </div>;
}
