import { STATUS, isMatchStatusId } from '../statuses/statuses';
import type { Match, MatchStatusId } from '../../types';

/** A match is In programma (upcoming) until it is started. */
export const isUpcomingMatch = (match: Pick<Match, 'status_id'>): boolean => match.status_id === STATUS.upcoming;

/** Lifecycle rules of a match status change, shared by creation, update and start:
 *  - only known statuses;
 *  - a match leaves In programma (In corso or Conclusa) only with a first server;
 *  - a started match never goes back to In programma.
 *  Throws with a message shown to the user. `previous` is null for a new match. */
export function assertMatchStatusChange(
  previous: MatchStatusId | null,
  next: unknown,
  firstServer: Match['first_server'] | undefined,
): asserts next is MatchStatusId {
  if (!isMatchStatusId(next)) throw new Error('Stato della partita non valido.');
  if (next !== STATUS.upcoming && firstServer !== 'player' && firstServer !== 'opponent') {
    throw new Error('Scegli chi serve per primo prima di avviare la partita.');
  }
  if (previous !== null && previous !== STATUS.upcoming && next === STATUS.upcoming) {
    throw new Error('Una partita già avviata non può tornare in programma.');
  }
}
