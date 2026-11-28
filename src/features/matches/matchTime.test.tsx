import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STATUS } from '../statuses/statuses';
import { MatchClock } from './MatchClock';
import { formatDuration, formatElapsed, matchDurationSeconds, matchStartedAt, spokenDuration, withStatusTiming } from './matchTime';
import type { Match, ScoredPoint } from '../../types';

const match = (changes: Partial<Match> = {}) => ({ id: 'm', status_id: STATUS.in_progress, ...changes }) as Match;
const point = (created_at: string) => ({ created_at }) as ScoredPoint;

describe('match time', () => {
  it('formats the running time as h:mm:ss, or mm:ss under one hour', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(65)).toBe('01:05');
    expect(formatElapsed(3600 + 12 * 60 + 8)).toBe('1:12:08');
  });

  it('formats the total duration as hours and minutes, or minutes under one hour', () => {
    expect(formatDuration(47 * 60 + 59)).toBe('47m');
    expect(formatDuration(3600 + 47 * 60)).toBe('1h 47m');
    expect(spokenDuration(3600 + 47 * 60)).toBe('1 ora e 47 minuti');
  });

  it('starts from the saved started_at, or from the first point of older matches', () => {
    const points = [point('2026-01-01T10:05:00.000Z'), point('2026-01-01T10:01:00.000Z')];
    expect(matchStartedAt(match({ started_at: '2026-01-01T09:00:00.000Z' }), points)).toBe('2026-01-01T09:00:00.000Z');
    expect(matchStartedAt(match(), points)).toBe('2026-01-01T10:01:00.000Z');
    expect(matchStartedAt(match(), [])).toBeNull();
  });

  it('reads the saved duration of completed matches only', () => {
    const points = [point('2026-01-01T10:00:00.000Z'), point('2026-01-01T10:30:00.000Z')];
    expect(matchDurationSeconds(match({ duration_seconds: 99 }), points)).toBeNull();
    expect(matchDurationSeconds(match({ status_id: STATUS.completed, duration_seconds: 99 }), points)).toBe(99);
    expect(matchDurationSeconds(match({ status_id: STATUS.completed }), points)).toBe(1800);
  });

  it('freezes the duration when the match is completed and clears it when it is reopened', () => {
    const running = match({ started_at: '2026-01-01T10:00:00.000Z' });
    const completed = withStatusTiming(running, { ...running, status_id: STATUS.completed }, '2026-01-01T11:47:30.000Z');
    expect(completed.duration_seconds).toBe(3600 + 47 * 60 + 30);
    expect(withStatusTiming(completed, { ...completed, result: 'x' }, '2026-01-02T00:00:00.000Z').duration_seconds).toBe(completed.duration_seconds);
    expect(withStatusTiming(completed, { ...completed, status_id: STATUS.in_progress }, '2026-01-02T00:00:00.000Z').duration_seconds).toBeNull();
  });
});

describe('MatchClock', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the live elapsed time, refreshed every second', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T11:12:08.000Z'));
    render(<MatchClock startedAt="2026-01-01T10:00:00.000Z" />);
    expect(screen.getByRole('button', { name: "Tempo trascorso dall'inizio della partita" }).textContent).toBe('PARTITA IN CORSO1:12:08');
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText('1:12:10')).toBeTruthy();
  });

  it('shows the frozen total duration once the match has ended', () => {
    render(<MatchClock startedAt="2026-01-01T10:00:00.000Z" endedAt="2026-01-01T11:47:00.000Z" />);
    const clock = screen.getByRole('button', { name: 'Durata della partita: 1 ora e 47 minuti' });
    expect(clock.textContent).toBe('PARTITA CONCLUSA1h 47m');
    expect(clock.textContent).not.toContain('Durata');
  });
});
