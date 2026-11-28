import { deriveSetScore } from '../scoring/scoring';
import { STATUS, statusLabel } from '../statuses/statuses';
import { formatDuration, matchDurationSeconds } from './matchTime';
import type { Match, ScoredPoint } from '../../types';

export type MatchOutcome = 'won' | 'lost' | 'in-progress';
export type MatchSummary = { match: Match; scoreText: string; outcome: MatchOutcome; duration: string | null };

export const MATCH_OUTCOME_LABELS: Record<MatchOutcome, string> = { won: 'Vinta', lost: 'Persa', 'in-progress': statusLabel(STATUS.in_progress, 'match') };

/** Score text ("6-4 6-3"), outcome and total duration (saved when the match is completed) of a match. */
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
  const outcome = match.status_id !== STATUS.completed ? 'in-progress' : playerSets > opponentSets ? 'won' : 'lost';
  const seconds = matchDurationSeconds(match, points);
  const duration = seconds !== null && seconds >= 60 ? formatDuration(seconds) : null;
  return { match, scoreText: labels.join(' '), outcome, duration };
}

/** "20 apr 2025" */
export function formatMatchDate(matchDate: string): string {
  return new Date(matchDate).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}
