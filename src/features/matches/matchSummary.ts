import { deriveSetScore } from '../scoring/scoring';
import type { Match, ScoredPoint } from '../../types';

export type MatchOutcome = 'won' | 'lost' | 'in-progress';
export type MatchSummary = { match: Match; scoreText: string; outcome: MatchOutcome; duration: string | null };

export const MATCH_OUTCOME_LABELS: Record<MatchOutcome, string> = { won: 'Vinta', lost: 'Persa', 'in-progress': 'In corso' };

/** Score text ("6-4 6-3"), outcome and duration (from the first to the last recorded point) of a match. */
export function summarizeMatch(match: Match, points: ScoredPoint[]): MatchSummary {
  let playerSets = 0;
  let opponentSets = 0;
  const labels: string[] = [];
  for (let setNumber = 1; setNumber <= match.number_of_sets; setNumber += 1) {
    const score = deriveSetScore(points, setNumber, match);
    if (score.player > score.opponent) playerSets += 1;
    if (score.opponent > score.player) opponentSets += 1;
    if (score.player || score.opponent) labels.push(`${score.player}-${score.opponent}`);
  }
  const outcome = match.status !== 'completed' ? 'in-progress' : playerSets > opponentSets ? 'won' : 'lost';
  const times = points.map(point => Date.parse(point.created_at)).filter(Number.isFinite);
  const minutes = times.length > 1 ? Math.round((Math.max(...times) - Math.min(...times)) / 60000) : 0;
  const duration = minutes > 0 ? (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`) : null;
  return { match, scoreText: labels.join(' '), outcome, duration };
}

/** "20 apr 2025" */
export function formatMatchDate(matchDate: string): string {
  return new Date(matchDate).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}
