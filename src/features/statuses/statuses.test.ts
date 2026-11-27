import { describe, expect, it } from 'vitest';
import {
  MATCH_STATUS_IDS,
  STATUS,
  STATUSES,
  TOURNAMENT_STATUS_IDS,
  migrateLegacyStatus,
  statusClassName,
  statusLabel,
} from './statuses';

describe('statuses', () => {
  it('mirrors the reference rows with stable ids', () => {
    expect(STATUSES.map(status => [status.id, status.code])).toEqual([[1, 'upcoming'], [2, 'in_progress'], [3, 'completed']]);
    expect(TOURNAMENT_STATUS_IDS).toEqual([1, 2, 3]);
    // A match exists from the moment it starts: never "In programma".
    expect(MATCH_STATUS_IDS).toEqual([2, 3]);
  });

  it('agrees the label with the gender of the entity', () => {
    expect(statusLabel(STATUS.completed, 'tournament')).toBe('Concluso');
    expect(statusLabel(STATUS.completed, 'match')).toBe('Conclusa');
    expect(statusLabel(STATUS.in_progress, 'tournament')).toBe('In corso');
    expect(statusLabel(STATUS.in_progress, 'match')).toBe('In corso');
    expect(statusLabel(STATUS.upcoming, 'tournament')).toBe('In programma');
    expect(statusLabel(99, 'match')).toBe('');
  });

  it('gives badge class names', () => {
    expect(STATUSES.map(status => statusClassName(status.id))).toEqual(['upcoming', 'in-progress', 'completed']);
  });
});

describe('migrateLegacyStatus', () => {
  it('converts the text status of tournaments, defaulting to In programma', () => {
    expect(migrateLegacyStatus('tournament', { id: 't', status: 'completed' })).toEqual({ id: 't', status_id: 3 });
    expect(migrateLegacyStatus('tournament', { id: 't', status: 'in-progress' })).toEqual({ id: 't', status_id: 2 });
    expect(migrateLegacyStatus('tournament', { id: 't', status: null })).toEqual({ id: 't', status_id: 1 });
    expect(migrateLegacyStatus('tournament', { id: 't' })).toEqual({ id: 't', status_id: 1 });
  });

  it('converts the text status of matches, which are never In programma', () => {
    expect(migrateLegacyStatus('match', { id: 'm', status: 'completed' })).toEqual({ id: 'm', status_id: 3 });
    expect(migrateLegacyStatus('match', { id: 'm', status: 'in-progress' })).toEqual({ id: 'm', status_id: 2 });
    expect(migrateLegacyStatus('match', { id: 'm', status: 'upcoming' })).toEqual({ id: 'm', status_id: 2 });
  });

  it('leaves converted payloads unchanged and drops a stale text status next to a valid status_id', () => {
    const converted = { id: 'm', status_id: 3 };
    expect(migrateLegacyStatus('match', converted)).toBe(converted);
    expect(migrateLegacyStatus('match', { id: 'm', status_id: 3, status: 'in-progress' })).toEqual({ id: 'm', status_id: 3 });
  });
});
