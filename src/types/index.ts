export type UUID = string;
export type PlayerId = UUID;

export interface Family {
  id: UUID;
  name: string;
  created_at: string;
  updated_at: string;
  created_by: UUID | null;
  local_only: boolean;
}

export interface FamilyMember {
  family_id: UUID;
  user_id: UUID;
  member_email: string;
  role: 'owner' | 'member';
  created_at: string;
}

export interface FamilyInvitation {
  id: UUID;
  family_id: UUID;
  invited_email: string;
  invited_by: UUID;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

/** Row of the player_age_categories reference table (FITP age sectors, see features/players/ageCategories.ts).
 *  Independent from the FITP technical ranking (Player.ranking_id). */
export interface PlayerAgeCategory {
  id: number;
  code: string;
  name: string;
  sector: 'youth' | 'open' | 'veterans';
  sort_order: number;
  is_active: boolean;
  /** Inclusive lower age threshold. */
  min_age: number;
  /** Exclusive upper age threshold; null means no upper limit. */
  max_age: number | null;
  /** january_1: years completed on 1 January; calendar_year: age reached during the sporting year. */
  age_basis: 'january_1' | 'calendar_year';
}

export type FitpRankingCategoryGroup = 'fourth' | 'third' | 'second';

/** Row of the fitp_rankings reference table (FITP individual rankings, see features/players/fitpRankings.ts). */
export interface FitpRanking {
  id: number;
  /** Official code: 4.NC, 4.6 ... 4.1, 3.5 ... 3.1, 2.8 ... 2.1. */
  code: string;
  name: string;
  category_group: FitpRankingCategoryGroup;
  /** Position from the lowest ranking (4.NC) to the highest. */
  sort_order: number;
  is_active: boolean;
  /** FITP season the classification refers to. */
  season: number;
}

export interface Player {
  id: PlayerId;
  family_id: UUID;
  first_name: string;
  last_name: string;
  birth_date?: string | null;
  /** Current FITP technical ranking: FK to fitp_rankings.id, null when not specified. The ranking a match was played
   *  with is frozen in Match.player_ranking_snapshot. The age category is not stored: it is computed from birth_date
   *  (see ageCategories.ts). */
  ranking_id: number | null;
  created_at: string;
  updated_at: string;
  version: number;
  deleted: boolean;
}

/** Club where the family plays (family data, synchronized like players). */
export interface Club {
  id: UUID;
  family_id: UUID;
  name: string;
  city: string;
  /** Court surface code (see CLUB_SURFACES in features/clubs/surfaces.ts); null when not specified. */
  surface: 'clay' | 'hard' | 'grass' | 'synthetic' | 'indoor' | null;
  created_at: string;
  updated_at: string;
  version: number;
  deleted: boolean;
}

/** Tournament the family takes part in (family data, synchronized like clubs). Every new match belongs to one. */
export interface Tournament {
  id: UUID;
  family_id: UUID;
  /** Club hosting the tournament (FK to clubs). */
  club_id: UUID;
  name: string;
  /** FK to player_age_categories.id; the UI offers only U12 to Open (see features/tournaments/tournaments.ts). */
  age_category_id: number;
  /** ISO calendar date (YYYY-MM-DD). */
  start_date: string;
  /** FK to statuses.id: In programma (1) when created, then In corso (2) or Concluso (3), changed only by hand from the
   *  Tornei list. */
  status_id: TournamentStatusId;
  created_at: string;
  updated_at: string;
  version: number;
  deleted: boolean;
}

/** Row of the statuses reference table, shared by tournaments and matches (see features/statuses/statuses.ts). The
 *  label has a masculine and a feminine form, so that it agrees with the entity: "torneo concluso", "partita
 *  conclusa". */
export interface Status {
  id: number;
  code: 'upcoming' | 'in_progress' | 'completed';
  label_masculine: string;
  label_feminine: string;
  applies_to_tournaments: boolean;
  applies_to_matches: boolean;
  sort_order: number;
}

/** statuses.id: 1 upcoming (In programma), 2 in_progress (In corso), 3 completed (Concluso / Conclusa). */
export type StatusId = 1 | 2 | 3;
export type TournamentStatusId = StatusId;
/** A match is never "In programma": it exists from the moment it starts. */
export type MatchStatusId = 2 | 3;

export interface Match {
  id: UUID;
  family_id: UUID;
  match_date: string;
  /** The player's name is read from the players table through player_id. */
  player_id: PlayerId;
  /** FK to fitp_rankings.id: the player's FITP ranking when the match was created. A historical snapshot, not changed
   *  by later updates of the player's ranking; null when the player had no ranking. */
  player_ranking_snapshot: number | null;
  opponent: string;
  /** FK to fitp_rankings.id: the opponent's FITP ranking, chosen when the match is created; null when not specified. */
  opponent_ranking_snapshot?: number | null;
  /** FK to tournaments.id. Null only for matches created before tournaments existed. */
  tournament_id?: UUID | null;
  tournament_match_number?: number | null;
  number_of_sets: 3 | 5;
  last_set_type: 'normal' | 'super-tiebreak';
  super_tiebreak_target: number;
  tiebreak_target: number;
  /** Games required to win a standard set. */
  games_to_win_set: 4 | 6;
  /** In four-game sets, start the tie-break at 3-3 or 4-4. */
  short_set_tiebreak_at?: 3 | 4;
  deuce_single_point: boolean;
  first_server: 'player' | 'opponent';
  /** FK to statuses.id: In corso (2) or Conclusa (3). */
  status_id: MatchStatusId;
  result?: string | null;
  /** When the first point was scored: the match clock runs from here. Null/missing before the first point. */
  started_at?: string | null;
  /** Total duration in seconds, frozen when the match is completed (now − started_at); null while it is played. */
  duration_seconds?: number | null;
  created_at: string;
  updated_at: string;
  version: number;
  deleted: boolean;
}

export interface TennisSet {
  id: UUID;
  family_id: UUID;
  match_id: UUID;
  set_number: number;
  player_games: number;
  opponent_games: number;
  created_at: string;
  updated_at: string;
  version: number;
  deleted: boolean;
}

export interface Game {
  id: UUID;
  family_id: UUID;
  set_id: UUID;
  game_number: number;
  player_points: number;
  opponent_points: number;
  created_at: string;
  updated_at: string;
  version: number;
  deleted: boolean;
}


/** Row of the point_types lookup table (double_fault, free_error, lose, win, ace, great_shot). */
export interface PointType {
  id: number;
  code: string;
  label: string;
}

export interface Point {
  id: UUID;
  family_id: UUID;
  game_id: UUID;
  point_number: number;
  /** true when my player won the point, false when the opponent won it. */
  won: boolean;
  /** true when my player served the point, false when the opponent served it. */
  serving: boolean;
  second_serve: boolean;
  /** FK to point_types.id (see POINT_TYPE in features/scoring/pointTypes.ts). Like `won`, it refers to my player:
   *  free_error is my player's free error, ace my player's ace, and so on. */
  point_type_id: number;
  shot_count: number;
  created_at: string;
  updated_at: string;
  version: number;
  deleted: boolean;
}

export interface ScoredPoint extends Point {
  set_number: number;
  game_number: number;
}

export interface SyncOperation {
  id: UUID;
  operation_id?: UUID;
  family_id: UUID;
  entity_type: 'players' | 'clubs' | 'tournaments' | 'matches' | 'sets' | 'games' | 'points';
  entity_id: UUID;
  operation: 'upsert' | 'delete';
  payload: unknown;
  created_at: string;
  attempts: number;
  last_error?: string;
}

export type SyncEntityType = SyncOperation['entity_type'];
export type SyncRole = FamilyMember['role'];
export type SyncStatus =
  | 'local-only'
  | 'signed-in-disabled'
  | 'syncing'
  | 'synced'
  | 'offline-pending'
  | 'retryable-error'
  | 'needs-attention'
  | 'permanent-error';

export interface SyncMapping {
  kind: 'mapping';
  local_family_id: UUID;
  remote_family_id: UUID | null;
  user_id: UUID | null;
  role: SyncRole | null;
  enabled: boolean;
  status: SyncStatus;
  initial_download_started: boolean;
  initial_download_complete: boolean;
  initial_download_revision: number | null;
  initial_download_cursors: Partial<Record<SyncEntityType, string>>;
  download_revision: number;
  last_download_completed_at: string | null;
  last_upload_completed_at: string | null;
  retry_count: number;
  next_retry_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface SyncRecordBaseline {
  kind: 'record-baseline';
  entity_type: SyncEntityType;
  entity_id: UUID;
  remote_version: number;
}

export interface SyncLease {
  kind: 'sync-lease';
  owner_id: UUID;
  expires_at: number;
}

export interface SyncMetadata {
  key: string;
  value: SyncMapping | SyncRecordBaseline | SyncLease;
  updated_at: string;
}

export interface SyncConflict {
  id: UUID;
  family_id: UUID;
  entity_type: SyncEntityType;
  entity_id: UUID;
  base_version: number;
  reason: 'version' | 'constraint';
  local_payload: unknown;
  remote_payload: unknown | null;
  remote_version: number;
  status: 'unresolved' | 'resolved';
  created_at: string;
  resolved_at: string | null;
}
