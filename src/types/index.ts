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

export interface Player {
  id: PlayerId;
  family_id: UUID;
  first_name: string;
  last_name: string;
  birth_date?: string | null;
  category: string;
  ranking: string;
  created_at: string;
  updated_at: string;
  version: number;
  deleted: boolean;
}

export interface Match {
  id: UUID;
  family_id: UUID;
  match_date: string;
  player_id: PlayerId;
  player_first_name_snapshot: string;
  player_last_name_snapshot: string;
  player_ranking_snapshot: string;
  player_category_snapshot: string;
  opponent: string;
  opponent_ranking?: string | null;
  opponent_category?: string | null;
  tournament?: string | null;
  tournament_match_number?: number | null;
  number_of_sets: 3 | 5;
  third_set_type: 'normal' | 'super-tiebreak';
  super_tiebreak_target: number;
  tiebreak_target: number;
  /** Games required to win a standard set; optional for legacy local records. */
  games_to_win_set?: 4 | 6;
  /** In four-game sets, start the tie-break at 3-3 or 4-4. */
  short_set_tiebreak_at?: 3 | 4;
  tiebreak_starts_at_363: boolean;
  deuce_single_point: boolean;
  first_server: 'player' | 'opponent';
  status: 'in-progress' | 'completed';
  result?: string | null;
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

export type ErrorCategory = 'forehand' | 'backhand' | 'serve' | 'volley' | 'net' | 'other';

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
  double_fault: boolean;
  shot_count: number;
  free_error: boolean;
  error_player?: 'player' | 'opponent';
  error_category?: ErrorCategory;
  attack_error: boolean;
  pressure_situation: boolean;
  pressure_error_player?: 'player' | 'opponent';
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
  entity_type: 'players' | 'matches' | 'sets' | 'games' | 'points';
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
