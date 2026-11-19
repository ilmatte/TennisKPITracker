import { describe, expect, it } from 'vitest';
import type { Point } from '../types';
import { nextPointNumber, normalizeDuplicatePointNumbers } from './pointNumbers';

const point = (id: string, point_number: number, deleted = false, game_id = 'game-1'): Point => ({
  id,
  family_id: 'family-1',
  game_id,
  point_number,
  winner: 'player',
  server: 'player',
  second_serve: false,
  double_fault: false,
  shot_count: 1,
  free_error: false,
  attack_error: false,
  pressure_situation: false,
  created_at: `2026-01-0${id}`,
  updated_at: `2026-01-0${id}`,
  version: 1,
  deleted,
});

describe('point numbering', () => {
  it('chooses the next number after all records, including tombstones', () => {
    expect(nextPointNumber([point('1', 1), point('2', 4, true), point('3', 2)])).toBe(5);
  });

  it('repairs duplicates without discarding tombstones or changing unique numbers', () => {
    const records = [
      point('1', 1),
      point('2', 1, true),
      point('3', 2),
      point('4', 2, true),
      point('5', 1, true, 'other-game'),
    ];

    expect(normalizeDuplicatePointNumbers(records)).toEqual([
      { ...records[1], point_number: 3 },
      { ...records[3], point_number: 4 },
    ]);
    expect(records).toHaveLength(5);
  });
});
