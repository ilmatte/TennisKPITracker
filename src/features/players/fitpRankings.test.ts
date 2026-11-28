import { describe, expect, it } from 'vitest';
import {
  FITP_RANKINGS,
  fitpRankingCode,
  fitpRankingOptionLabel,
  groupFitpRankings,
  legacyFitpRankingId,
  migrateLegacyPlayerRanking,
} from './fitpRankings';

describe('FITP rankings registry', () => {
  it('lists the official sequence from 4.NC to 2.1, ordered from the lowest ranking to the highest', () => {
    expect(FITP_RANKINGS.map(item => item.code)).toEqual([
      '4.NC', '4.6', '4.5', '4.4', '4.3', '4.2', '4.1',
      '3.5', '3.4', '3.3', '3.2', '3.1',
      '2.8', '2.7', '2.6', '2.5', '2.4', '2.3', '2.2', '2.1',
    ]);
    expect(FITP_RANKINGS.map(item => item.sort_order)).toEqual(FITP_RANKINGS.map((_, index) => index + 1));
    expect(new Set(FITP_RANKINGS.map(item => item.id)).size).toBe(FITP_RANKINGS.length);
    expect(FITP_RANKINGS.every(item => item.is_active && item.season === 2026)).toBe(true);
  });

  it('assigns each ranking to its category, NC included in the fourth', () => {
    const counts = Object.fromEntries(['fourth', 'third', 'second'].map(group =>
      [group, FITP_RANKINGS.filter(item => item.category_group === group).length]));
    expect(counts).toEqual({ fourth: 7, third: 5, second: 8 });
    expect(FITP_RANKINGS[0]).toMatchObject({ code: '4.NC', category_group: 'fourth', name: 'IV categoria NC (non classificato)' });
    expect(FITP_RANKINGS.find(item => item.code === '2.8')?.name).toBe('II categoria 8° gruppo');
  });

  it('groups the drop-down by category in ascending order, hiding inactive rankings except the stored one', () => {
    const rankings = FITP_RANKINGS.map(item => item.code === '4.6' ? { ...item, is_active: false } : item).reverse();
    const groups = groupFitpRankings(rankings);
    expect(groups.map(group => group.label)).toEqual(['Quarta categoria', 'Terza categoria', 'Seconda categoria']);
    expect(groups[0].rankings.map(item => item.code)).toEqual(['4.NC', '4.5', '4.4', '4.3', '4.2', '4.1']);
    expect(groupFitpRankings(rankings, 2)[0].rankings.map(item => item.code)).toContain('4.6');
    expect(fitpRankingOptionLabel(FITP_RANKINGS[8])).toBe('3.4 · III categoria 4° gruppo');
  });

  it('reads the code of a ranking id', () => {
    expect(fitpRankingCode(7)).toBe('4.1');
    expect(fitpRankingCode(null)).toBe('');
    expect(fitpRankingCode(999)).toBe('');
  });
});

describe('legacy free-text rankings', () => {
  it('maps the texts typed before the registry to its rows', () => {
    expect(legacyFitpRankingId('3.4')).toBe(9);
    expect(legacyFitpRankingId(' 4,1 ')).toBe(7);
    expect(legacyFitpRankingId('nc')).toBe(1);
    expect(legacyFitpRankingId('N.C.')).toBe(1);
    expect(legacyFitpRankingId('4.nc')).toBe(1);
    expect(legacyFitpRankingId('')).toBeNull();
    expect(legacyFitpRankingId('1.5')).toBeNull();
    expect(legacyFitpRankingId(undefined)).toBeNull();
  });

  it('converts player payloads to ranking_id, leaving converted ones unchanged', () => {
    expect(migrateLegacyPlayerRanking({ id: 'p', ranking: '2.8' })).toEqual({ id: 'p', ranking_id: 13 });
    expect(migrateLegacyPlayerRanking({ id: 'p', ranking: 'boh' })).toEqual({ id: 'p', ranking_id: null });
    expect(migrateLegacyPlayerRanking({ id: 'p', ranking_id: 5, ranking: '2.1' })).toEqual({ id: 'p', ranking_id: 5 });
    const converted = { id: 'p', ranking_id: null };
    expect(migrateLegacyPlayerRanking(converted)).toBe(converted);
    expect(migrateLegacyPlayerRanking(null)).toBeNull();
  });
});
