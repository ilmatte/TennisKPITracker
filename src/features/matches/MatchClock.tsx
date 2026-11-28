import './MatchClock.css';
import { useEffect, useState } from 'react';
import { formatDuration, formatElapsed, secondsBetween, spokenDuration } from './matchTime';

/** Match time in the "Partita in corso" top bar, between the Back and Menu buttons.
 *  - Running (no endedAt): pulsing live dot + "PARTITA IN CORSO", and the time elapsed since startedAt ("1:12:08"),
 *    refreshed every second. Without startedAt (no point scored yet) it shows 00:00 and does not run.
 *  - Ended: check + "PARTITA CONCLUSA", and clock icon + total duration ("1h 47m"), which no longer changes.
 *  The time is always computed from the timestamps, so it is right after the app is closed and reopened. */
export function MatchClock({ startedAt, endedAt, className = '' }: {
  startedAt: string | null | undefined;
  endedAt?: string | null;
  className?: string;
}) {
  const running = Boolean(startedAt) && !endedAt;
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  if (endedAt) {
    const total = startedAt ? secondsBetween(startedAt, endedAt) : 0;
    return <button type="button" className={`match-clock ended ${className}`.trim()} aria-label={`Durata della partita: ${spokenDuration(total)}`}>
      <span className="match-clock-label">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#C8F03A" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        PARTITA CONCLUSA
      </span>
      <span className="match-clock-time">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#C8F03A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        {formatDuration(total)}
      </span>
    </button>;
  }

  const elapsed = startedAt ? secondsBetween(startedAt, now) : 0;
  return <button type="button" className={`match-clock ${className}`.trim()} aria-label="Tempo trascorso dall'inizio della partita">
    <span className="match-clock-label"><span className={`match-clock-dot${running ? ' live' : ''}`} />PARTITA IN CORSO</span>
    <span className="match-clock-time"><time dateTime={`PT${elapsed}S`}>{formatElapsed(elapsed)}</time></span>
  </button>;
}
