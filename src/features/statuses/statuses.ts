import type { MatchStatusId, SetStatusId, Status, StatusId, TournamentStatusId } from '../../types';

/** Status ids. They mirror the rows of the `statuses` table (supabase/initial_schema.sql and the Dexie `statuses`
 *  store): never renumber them. */
export const STATUS = {
  upcoming: 1,
  in_progress: 2,
  completed: 3,
} as const satisfies Record<Status['code'], StatusId>;

/** Rows of the `statuses` reference table, shared by tournaments and matches. Each label has a masculine and a feminine
 *  form (equal when the Italian word does not change), chosen by the grammatical gender of the entity. */
export const STATUSES: readonly Status[] = [
  { id: STATUS.upcoming, code: 'upcoming', label_masculine: 'In programma', label_feminine: 'In programma', applies_to_tournaments: true, applies_to_matches: false, sort_order: 1 },
  { id: STATUS.in_progress, code: 'in_progress', label_masculine: 'In corso', label_feminine: 'In corso', applies_to_tournaments: true, applies_to_matches: true, sort_order: 2 },
  { id: STATUS.completed, code: 'completed', label_masculine: 'Concluso', label_feminine: 'Conclusa', applies_to_tournaments: true, applies_to_matches: true, sort_order: 3 },
];

/** Grammatical gender of the entities that have a status: "il torneo è concluso", "la partita è conclusa". */
export const STATUS_ENTITY_GENDER = { tournament: 'masculine', match: 'feminine', set: 'masculine' } as const;
export type StatusEntity = keyof typeof STATUS_ENTITY_GENDER;

/** App-only wording of a status for one entity, leaving the statuses table unchanged: a set "In programma" is shown
 *  as "Prossimo" (the next set to play). */
const STATUS_LABEL_OVERRIDES: Partial<Record<StatusEntity, Partial<Record<StatusId, string>>>> = {
  set: { [STATUS.upcoming]: 'Prossimo' },
};

/** Label of a status for an entity, agreeing with its gender: statusLabel(3, 'tournament') is "Concluso",
 *  statusLabel(3, 'match') is "Conclusa", statusLabel(1, 'set') is "Prossimo". */
export function statusLabel(statusId: number, entity: StatusEntity): string {
  const status = STATUSES.find(item => item.id === statusId);
  if (!status) return '';
  const override = STATUS_LABEL_OVERRIDES[entity]?.[status.id as StatusId];
  if (override) return override;
  return STATUS_ENTITY_GENDER[entity] === 'feminine' ? status.label_feminine : status.label_masculine;
}

/** CSS-friendly code of a status ("in-progress"), used for badge colours. */
export function statusClassName(statusId: number): string {
  return STATUSES.find(item => item.id === statusId)?.code.replace('_', '-') ?? '';
}

export const TOURNAMENT_STATUS_IDS = STATUSES.filter(status => status.applies_to_tournaments)
  .map(status => status.id) as TournamentStatusId[];
export const MATCH_STATUS_IDS = STATUSES.filter(status => status.applies_to_matches)
  .map(status => status.id) as MatchStatusId[];

/** A set goes through all the statuses: In programma, In corso, Concluso. */
export const SET_STATUS_IDS: readonly SetStatusId[] = [STATUS.upcoming, STATUS.in_progress, STATUS.completed];

export const isTournamentStatusId = (value: unknown): value is TournamentStatusId =>
  (TOURNAMENT_STATUS_IDS as unknown[]).includes(value);
export const isMatchStatusId = (value: unknown): value is MatchStatusId => (MATCH_STATUS_IDS as unknown[]).includes(value);

/** Text statuses stored before the statuses table existed ('upcoming', 'in-progress', 'completed'). */
const LEGACY_STATUS: Record<string, StatusId> = { upcoming: STATUS.upcoming, 'in-progress': STATUS.in_progress, completed: STATUS.completed };

/** Converts a match or tournament payload written before the statuses table (text `status`) to `status_id`. Used when
 *  upgrading the local database, restoring JSON backups and applying downloaded records; other payloads, and those
 *  already converted, are returned unchanged. A missing or unknown status becomes the entity's initial status
 *  (In programma for tournaments, In corso for matches). */
export function migrateLegacyStatus<T>(entity: StatusEntity, payload: T): T {
  if (!payload || typeof payload !== 'object') return payload;
  const record = payload as Record<string, unknown>;
  const valid = entity === 'match' ? isMatchStatusId(record.status_id) : isTournamentStatusId(record.status_id);
  if (valid && !('status' in record)) return payload;
  const { status, ...rest } = record;
  const legacy = typeof status === 'string' ? LEGACY_STATUS[status] : undefined;
  const fallback = entity === 'match' ? STATUS.in_progress : STATUS.upcoming;
  const converted = valid ? record.status_id
    : entity === 'match' ? (isMatchStatusId(legacy) ? legacy : fallback)
      : legacy ?? fallback;
  return { ...rest, status_id: converted } as T;
}
