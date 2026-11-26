import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOURNAMENT_CATEGORY_ID,
  TOURNAMENT_ACTIVE_DAYS,
  TOURNAMENT_CATEGORIES,
  formatTournamentDate,
  localIsoDate,
  tournamentCategoryLabel,
  tournamentStatus,
} from './tournaments';

describe('tournament categories', () => {
  it('offers only U12 to Open, in order, with short labels', () => {
    expect(TOURNAMENT_CATEGORIES.map(category => category.code)).toEqual(['U12', 'U14', 'U16', 'U18', 'OPEN']);
    expect(TOURNAMENT_CATEGORIES.map(category => tournamentCategoryLabel(category.id))).toEqual(['U12', 'U14', 'U16', 'U18', 'Open']);
  });

  it('defaults to U16 and labels unknown ids as empty', () => {
    expect(tournamentCategoryLabel(DEFAULT_TOURNAMENT_CATEGORY_ID)).toBe('U16');
    expect(tournamentCategoryLabel(999)).toBe('');
  });
});

describe('tournament dates', () => {
  it('uses the local calendar date and formats it in Italian without time-zone shifts', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 0, 30))).toBe('2026-01-05');
    expect(formatTournamentDate('2025-04-12')).toBe('12 apr 2025');
  });
});

describe('tournament status', () => {
  it('is upcoming before the start date', () => {
    expect(tournamentStatus('2026-12-01', null, '2026-11-27')).toBe('upcoming');
  });

  it(`stays in progress for ${TOURNAMENT_ACTIVE_DAYS} days after the start or the last match`, () => {
    expect(tournamentStatus('2026-11-13', null, '2026-11-27')).toBe('in-progress');
    expect(tournamentStatus('2026-11-12', null, '2026-11-27')).toBe('completed');
    expect(tournamentStatus('2026-10-01', '2026-11-20', '2026-11-27')).toBe('in-progress');
    // A last match date earlier than the start does not matter.
    expect(tournamentStatus('2026-10-01', '2026-09-30', '2026-11-27')).toBe('completed');
  });
});
