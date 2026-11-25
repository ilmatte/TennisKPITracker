import initialSchemaSql from '../../../supabase/initial_schema.sql?raw';
import ageCategoriesMigrationSql from '../../../supabase/002_player_age_categories.sql?raw';
import { describe, expect, it } from 'vitest';
import {
  ageCategoryFor, ageOnJanuaryFirst, ageReachedInYear, parseBirthDate, playerAgeCategory, PLAYER_AGE_CATEGORIES,
} from './ageCategories';

const YEAR = 2026;
// The veterans categories are currently inactive in the registry: the attribution rules are tested with every
// category active, so they stay verified for when they are activated.
const ALL_ACTIVE = PLAYER_AGE_CATEGORIES.map(category => ({ ...category, is_active: true }));
const code = (birthDate: string | null, year = YEAR) => ageCategoryFor(birthDate, year, ALL_ACTIVE)?.code ?? null;

describe('player age categories registry', () => {
  it('contains the 16 FITP categories from U12 to O80, in order, without U8 and U10', () => {
    expect(PLAYER_AGE_CATEGORIES.map(category => category.code)).toEqual([
      'U12', 'U14', 'U16', 'U18', 'OPEN', 'O30', 'O35', 'O40', 'O45', 'O50', 'O55', 'O60', 'O65', 'O70', 'O75', 'O80',
    ]);
    expect(PLAYER_AGE_CATEGORIES.map(category => category.id)).toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
    expect(PLAYER_AGE_CATEGORIES.map(category => category.sort_order)).toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
    expect(PLAYER_AGE_CATEGORIES.filter(category => category.is_active).map(category => category.code)).toEqual(['U12', 'U14', 'U16', 'U18', 'OPEN']);
  });

  it('has no duplicate ids, codes or sort orders', () => {
    for (const field of ['id', 'code', 'sort_order'] as const) {
      const values = PLAYER_AGE_CATEGORIES.map(category => category[field]);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('uses the expected names and sectors', () => {
    expect(PLAYER_AGE_CATEGORIES.slice(0, 5).map(category => [category.name, category.sector])).toEqual([
      ['Under 12', 'youth'], ['Under 14', 'youth'], ['Under 16', 'youth'], ['Under 18', 'youth'], ['Open', 'open'],
    ]);
    expect(PLAYER_AGE_CATEGORIES.slice(5).every(category => category.sector === 'veterans' && category.name === `Over ${category.min_age}`)).toBe(true);
  });

  it('has contiguous thresholds inside each sector', () => {
    for (const sector of ['youth', 'veterans'] as const) {
      const rows = PLAYER_AGE_CATEGORIES.filter(category => category.sector === sector);
      rows.slice(1).forEach((category, index) => expect(category.min_age).toBe(rows[index].max_age));
      expect(rows.at(-1)!.max_age).toBe(sector === 'youth' ? 18 : null);
    }
  });

  it('matches the rows seeded in Supabase by initial_schema.sql and 002_player_age_categories.sql', () => {
    for (const sql of [initialSchemaSql, ageCategoriesMigrationSql]) {
      const rows = [...sql.matchAll(/\((\d+), '(\w+)', '([^']+)', '(\w+)', (\d+), (true|false), (\d+), (\d+|null), '(\w+)'\)/g)]
        .map(([, id, code, name, sector, sortOrder, active, minAge, maxAge, basis]) => ({
          id: Number(id), code, name, sector, sort_order: Number(sortOrder), is_active: active === 'true',
          min_age: Number(minAge), max_age: maxAge === 'null' ? null : Number(maxAge), age_basis: basis,
        }));
      expect(rows).toEqual([...PLAYER_AGE_CATEGORIES]);
    }
  });
});

describe('age on 1 January and age reached in the year', () => {
  it('counts the years completed on 1 January, a birthday on 1 January included', () => {
    expect(ageOnJanuaryFirst('2014-06-15', YEAR)).toBe(11);
    expect(ageOnJanuaryFirst('2014-01-02', YEAR)).toBe(11);
    expect(ageOnJanuaryFirst('2014-01-01', YEAR)).toBe(12);
    expect(ageOnJanuaryFirst('2013-12-31', YEAR)).toBe(12);
  });

  it('counts the age reached during the sporting year', () => {
    expect(ageReachedInYear('1996-12-31', YEAR)).toBe(30);
    expect(ageReachedInYear('1996-01-01', YEAR)).toBe(30);
    expect(ageReachedInYear('1997-01-01', YEAR)).toBe(29);
  });

  it('rejects missing and impossible dates', () => {
    expect(parseBirthDate('2026-02-30')).toBeNull();
    expect(parseBirthDate('2023-02-29')).toBeNull();
    expect(parseBirthDate('15/06/2014')).toBeNull();
    expect(parseBirthDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });
});

describe('age category attribution', () => {
  it('attributes all 16 categories', () => {
    const examples: Record<string, string> = {
      U12: '2015-06-15', U14: '2013-06-15', U16: '2011-06-15', U18: '2009-06-15', OPEN: '2000-06-15',
      O30: '1996-06-15', O35: '1991-06-15', O40: '1986-06-15', O45: '1981-06-15', O50: '1976-06-15',
      O55: '1971-06-15', O60: '1966-06-15', O65: '1961-06-15', O70: '1956-06-15', O75: '1951-06-15', O80: '1946-06-15',
    };
    for (const [expected, birthDate] of Object.entries(examples)) expect(code(birthDate)).toBe(expected);
    expect(new Set(Object.values(examples).map(birthDate => code(birthDate))).size).toBe(16);
  });

  it('does not attribute a category below the U12 threshold (U8 and U10 are not in the registry)', () => {
    expect(code('2016-01-02')).toBeNull(); // 9 on 1 January 2026
    expect(code('2016-01-01')).toBe('U12'); // 10 on 1 January 2026
    expect(code('2020-05-01')).toBeNull();
  });

  it('handles the youth thresholds on 1 January', () => {
    expect(code('2014-01-02')).toBe('U12'); // 11 on 1 January
    expect(code('2014-01-01')).toBe('U14'); // 12 on 1 January
    expect(code('2012-01-02')).toBe('U14');
    expect(code('2012-01-01')).toBe('U16');
    expect(code('2010-01-02')).toBe('U16');
    expect(code('2010-01-01')).toBe('U18');
    expect(code('2008-01-02')).toBe('U18');
    expect(code('2008-01-01')).toBe('OPEN');
  });

  it('uses the age on 1 January, not the birthday later in the year, for youth categories', () => {
    // Turns 12 on 15 June 2026, but is 11 on 1 January 2026: still Under 12 for the whole sporting year.
    expect(code('2014-06-15')).toBe('U12');
    expect(code('2014-12-31')).toBe('U12');
  });

  it('enters the veterans sectors in the year the threshold age is reached', () => {
    expect(code('1997-01-01')).toBe('OPEN'); // turns 29 in 2026
    expect(code('1996-12-31')).toBe('O30'); // turns 30 on 31 December 2026
    expect(code('1996-01-01')).toBe('O30');
    expect(code('1992-01-01')).toBe('O30'); // turns 34
    expect(code('1991-12-31')).toBe('O35'); // turns 35
  });

  it('moves through every veterans category at its threshold year', () => {
    for (const threshold of [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80]) {
      expect(code(`${YEAR - threshold}-12-31`)).toBe(`O${threshold}`);
      expect(code(`${YEAR - threshold + 1}-01-01`)).toBe(threshold === 30 ? 'OPEN' : `O${threshold - 5}`);
    }
    expect(code('1930-03-01')).toBe('O80');
  });

  it('assigns a single main category, the most specific veterans one', () => {
    const veteran = ageCategoryFor('1960-05-05', YEAR, ALL_ACTIVE); // 66 in 2026: also Open-aged and above every lower threshold
    expect(veteran?.code).toBe('O65');
    expect(PLAYER_AGE_CATEGORIES.filter(category => category.code === veteran?.code)).toHaveLength(1);
  });

  it('changes category automatically when the sporting year changes', () => {
    expect(code('2014-06-15', 2026)).toBe('U12');
    expect(code('2014-06-15', 2027)).toBe('U14');
    expect(code('2008-03-10', 2026)).toBe('U18');
    expect(code('2008-03-10', 2027)).toBe('OPEN');
    expect(code('1997-03-10', 2026)).toBe('OPEN');
    expect(code('1997-03-10', 2027)).toBe('O30');
    expect(code('1992-03-10', 2026)).toBe('O30');
    expect(code('1992-03-10', 2027)).toBe('O35');
  });

  it('returns no category without a valid birth date', () => {
    expect(code(null)).toBeNull();
    expect(code('')).toBeNull();
    expect(code('2026-02-30')).toBeNull();
    expect(playerAgeCategory({ birth_date: undefined }, YEAR)).toBeNull();
  });

  it('handles 29 February birthdays', () => {
    expect(code('2012-02-29', 2026)).toBe('U14'); // 13 on 1 January 2026
    expect(code('2012-02-29', 2027)).toBe('U16');
  });

  it('reads thresholds from the registry, so inactive or updated rows change the result', () => {
    const withoutO30 = ALL_ACTIVE.map(category => category.code === 'O30' ? { ...category, is_active: false } : category);
    expect(ageCategoryFor('1995-06-15', YEAR, withoutO30)?.code).toBe('OPEN');
    expect(ageCategoryFor('1995-06-15', YEAR, ALL_ACTIVE)?.code).toBe('O30');
  });

  it('attributes adults to Open while the veterans categories are inactive in the registry', () => {
    for (const birthDate of ['1995-06-15', '1980-01-01', '1960-05-05', '1930-03-01']) {
      expect(playerAgeCategory({ birth_date: birthDate }, YEAR)?.code).toBe('OPEN');
    }
    expect(playerAgeCategory({ birth_date: '2014-06-15' }, YEAR)?.code).toBe('U12');
    expect(playerAgeCategory({ birth_date: '2008-01-02' }, YEAR)?.code).toBe('U18');
  });
});
