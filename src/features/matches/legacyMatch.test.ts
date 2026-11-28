import { describe, expect, it } from 'vitest';
import { migrateLegacyMatch, migrateLegacyMatchColumns } from './legacyMatch';

describe('legacy match columns', () => {
  it('renames third_set_type and turns tiebreak_starts_at_363 into games_to_win_set when missing', () => {
    expect(migrateLegacyMatchColumns({ id: 'm1', third_set_type: 'normal', tiebreak_starts_at_363: true }))
      .toEqual({ id: 'm1', last_set_type: 'normal', games_to_win_set: 4 });
    expect(migrateLegacyMatchColumns({ id: 'm2', tiebreak_starts_at_363: false }))
      .toEqual({ id: 'm2', games_to_win_set: 6 });
  });

  it('keeps the current columns when both the legacy and the current ones are present', () => {
    expect(migrateLegacyMatchColumns({ third_set_type: 'normal', last_set_type: 'super-tiebreak', games_to_win_set: 6, tiebreak_starts_at_363: true }))
      .toEqual({ last_set_type: 'super-tiebreak', games_to_win_set: 6 });
  });

  it('returns current records and non-objects unchanged', () => {
    const current = { id: 'm1', last_set_type: 'normal', games_to_win_set: 4 };
    expect(migrateLegacyMatchColumns(current)).toBe(current);
    expect(migrateLegacyMatchColumns(null)).toBeNull();
  });

  it('converts the legacy text status together with the legacy columns', () => {
    expect(migrateLegacyMatch({ id: 'm1', status: 'completed', third_set_type: 'normal' }))
      .toEqual({ id: 'm1', status_id: 3, last_set_type: 'normal' });
  });
});
