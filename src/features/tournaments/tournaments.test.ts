import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOURNAMENT_CATEGORY_ID,
  TOURNAMENT_CATEGORIES,
  formatTournamentDate,
  localIsoDate,
  tournamentCategoryLabel,
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
