import { STATUS } from '../statuses/statuses';
import type { Match, ScoredPoint } from '../../types';

/** Elapsed time of a match being played: "1:12:08", or "12:08" under one hour. */
export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${String(minutes).padStart(2, '0')}:${rest}`;
}

/** Total duration of a finished match: "1h 47m", or "47m" under one hour. */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.max(0, Math.floor(totalSeconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/** Spoken form of formatDuration, for screen readers: "1 ora e 47 minuti". */
export function spokenDuration(totalSeconds: number): string {
  const minutes = Math.max(0, Math.floor(totalSeconds / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const minutePart = `${rest} ${rest === 1 ? 'minuto' : 'minuti'}`;
  if (!hours) return minutePart;
  const hourPart = `${hours} ${hours === 1 ? 'ora' : 'ore'}`;
  return rest ? `${hourPart} e ${minutePart}` : hourPart;
}

/** Seconds between two ISO timestamps (never negative). */
export function secondsBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
}

function pointTimes(points: ScoredPoint[]): number[] {
  return points.map(point => Date.parse(point.created_at)).filter(Number.isFinite);
}

/** When the match started: the saved started_at (set by its first point) or, for matches recorded before it existed,
 *  the first recorded point. Null while no point has been scored. */
export function matchStartedAt(match: Match, points: ScoredPoint[]): string | null {
  if (match.started_at) return match.started_at;
  const times = pointTimes(points);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

/** Total duration (seconds) of a finished match: the saved duration_seconds or, for matches finished before it
 *  existed, the time between the first and the last recorded point. Null for a match still being played. */
export function matchDurationSeconds(match: Match, points: ScoredPoint[]): number | null {
  if (match.status_id !== STATUS.completed) return null;
  if (typeof match.duration_seconds === 'number') return match.duration_seconds;
  const times = pointTimes(points);
  return times.length > 1 ? Math.round((Math.max(...times) - Math.min(...times)) / 1000) : null;
}

/** Timing fields of a match whose status becomes `next.status_id`: completing it freezes its total duration
 *  (now − started_at), reopening it clears that duration so the clock runs again from started_at. */
export function withStatusTiming<T extends Match>(previous: Match, next: T, now: string): T {
  if (next.status_id === previous.status_id) return next;
  if (next.status_id === STATUS.completed) {
    return { ...next, duration_seconds: next.started_at ? secondsBetween(next.started_at, now) : null };
  }
  return { ...next, duration_seconds: null };
}
