import { describe, expect, it } from 'vitest';

import schema from '../../supabase/initial_schema.sql?raw';
import { FITP_RANKINGS } from '../features/players/fitpRankings';

function functionBody(sql: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = sql.match(new RegExp(
    `create (?:or replace )?function public\\.${escapedName}\\b[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`,
    'i',
  ));
  expect(match, `Expected definition for public.${name}`).toBeTruthy();
  return match?.[1] ?? '';
}

describe('workspace ownership SQL guarantees', () => {
  it('enforces one remote family per owner with a database unique index', () => {
    expect(schema).toMatch(
      /create unique index\s+families_one_workspace_per_owner_idx\s+on public\.families\s*\(created_by\)/i,
    );
    expect(schema).toMatch(/create unique index\s+families_one_workspace_per_owner_idx/i);
  });

  it('makes create_family idempotent and safe against concurrent calls', () => {
    const body = functionBody(schema, 'create_family');
    expect(body).toMatch(/pg_advisory_xact_lock/i);
    expect(body).toMatch(/where f\.created_by = auth\.uid\(\)/i);
    expect(body).toMatch(/on conflict \(created_by\) do nothing/i);
    expect(body).toMatch(/a family member cannot create an owner workspace/i);
    expect(body).toMatch(/values\s*\(existing_family_id,\s*auth\.uid\(\),\s*owner_email,\s*'owner'\)/i);
  });

  it('serializes invitation acceptance with owner-workspace creation and keeps invitees members', () => {
    const body = functionBody(schema, 'accept_family_invitation');
    expect(body).toMatch(/pg_advisory_xact_lock/i);
    expect(body).toMatch(/values\s*\(invitation\.family_id,\s*auth\.uid\(\),\s*current_email,\s*'member'\)/i);
    expect(body).not.toMatch(/insert\s+into public\.families/i);
    expect(body).not.toMatch(/delete\s+from public\.families/i);
  });

  it('uses only version-checked RPC writes and a serialized, paginated change cursor', () => {
    expect(schema).toMatch(/add column if not exists sync_revision bigint/i);
    expect(schema).toMatch(/create table if not exists public\.sync_changes/i);
    expect(schema).toMatch(/update public\.families\s+set sync_revision = sync_revision \+ 1/i);
    expect(schema).toMatch(/insert into public\.sync_changes/i);
    expect(schema).toMatch(/create or replace function public\.apply_sync_record/i);
    expect(schema).toMatch(/current_version <> _base_version/i);
    expect(schema).toMatch(/where id = \$1 and family_id = \$2 for update/i);
    expect(schema).toMatch(/'status', 'conflict'/i);
    expect(schema).toMatch(/when unique_violation then/i);
    expect(schema).toMatch(/'reason', 'constraint'/i);
    expect(schema).toMatch(/create or replace function public\.pull_sync_changes/i);
    expect(schema).toMatch(/order by change\.revision/i);
    expect(schema).toMatch(/set search_path = ''/i);
    expect(schema).toMatch(/private\.is_family_member\(_family_id\)/i);
    expect(schema).toMatch(/revoke insert, update, delete on table\s+public\.players, public\.clubs, public\.tournaments, public\.matches, public\.sets, public\.games, public\.points\s+from public, anon, authenticated/i);
    expect(schema).not.toMatch(/\b(drop|truncate)\s+table\b/i);
  });
});

describe('tournaments SQL', () => {
  it('links tournaments to clubs and age categories, and matches to tournaments, within the family', () => {
    expect(schema).toMatch(/constraint tournaments_family_id_club_id_fkey foreign key \(family_id, club_id\)\s+references public\.clubs\(family_id, id\)/i);
    expect(schema).toMatch(/add constraint tournaments_age_category_id_fkey\s+foreign key \(age_category_id\) references public\.player_age_categories\(id\)/i);
    expect(schema).toMatch(/constraint matches_family_id_tournament_id_fkey foreign key \(family_id, tournament_id\)\s+references public\.tournaments\(family_id, id\)/i);
    expect(schema).toMatch(/create policy "family members can read tournaments"/i);
    expect(schema).not.toMatch(/^\s*tournament text,/m);
  });

  it('accepts the tournaments entity type in the sync tables and functions', () => {
    expect(schema.match(/'players', 'clubs', 'tournaments', 'matches', 'sets', 'games', 'points'/g)).toHaveLength(4);
    expect(functionBody(schema, 'apply_sync_record')).toMatch(/when 'tournaments' then 'tournaments'/);
    expect(functionBody(schema, 'list_initial_snapshot')).toMatch(/'tournaments'/);
  });

});

describe('statuses SQL', () => {
  it('defines one statuses reference table, with masculine and feminine labels, used by tournaments and matches', () => {
    for (const row of [
      "(1, 'upcoming', 'In programma', 'In programma', true, true, 1)",
      "(2, 'in_progress', 'In corso', 'In corso', true, true, 2)",
      "(3, 'completed', 'Concluso', 'Conclusa', true, true, 3)",
    ]) expect(schema).toContain(row);
    expect(schema).toMatch(/label_masculine text not null,\s+label_feminine text not null/i);
    expect(schema).toMatch(/grant select on table public\.statuses to authenticated/i);
    expect(schema).toMatch(/create policy "authenticated users can read statuses"/i);
    expect(schema).toMatch(/status_id smallint not null default 1\s+constraint tournaments_status_id_fkey references public\.statuses\(id\)/i);
    expect(schema).toMatch(/status_id smallint not null\s+constraint matches_status_id_fkey references public\.statuses\(id\)\s+constraint matches_status_id_check check \(status_id in \(1, 2, 3\)\)/i);
    // A match leaves In programma only with a first server, nullable until then; the planned time is optional.
    expect(schema).toMatch(/^\s*first_server text check \(first_server in \('player', 'opponent'\)\),/m);
    expect(schema).toMatch(/constraint matches_first_server_check check \(status_id = 1 or first_server is not null\)/i);
    expect(schema).toMatch(/^\s*match_time time,/m);
    // No text status column is left.
    expect(schema).not.toMatch(/^\s*status text/m);
  });
});

describe('FITP rankings SQL', () => {
  const sqlRows = (sql: string) => [...sql.matchAll(
    /\((\d+), '([^']+)', '([^']+)', '(fourth|third|second)', (\d+), (true|false), (\d+)\)/g,
  )].map(([, id, code, name, category_group, sort_order, is_active, season]) => ({
    id: Number(id), code, name, category_group, sort_order: Number(sort_order), is_active: is_active === 'true', season: Number(season),
  }));

  it('seeds the same registry as the app', () => {
    expect(sqlRows(schema)).toEqual([...FITP_RANKINGS]);
  });

  it('links players to the registry and keeps it read-only for signed-in users', () => {
    expect(schema).toMatch(/ranking_id smallint\s+constraint players_ranking_id_fkey references public\.fitp_rankings\(id\)/i);
    expect(schema).toMatch(/unique \(season, code\),\s+unique \(season, sort_order\)/i);
    expect(schema).toMatch(/grant select on table public\.fitp_rankings to authenticated/i);
    expect(schema).toMatch(/create policy "authenticated users can read fitp rankings"/i);
    // The free-text ranking column is gone.
    expect(schema).not.toMatch(/^\s*ranking text/m);
  });

  it('stores the player and opponent ranking snapshots of matches as foreign keys to the registry', () => {
    expect(schema).toMatch(/player_ranking_snapshot smallint\s+constraint matches_player_ranking_snapshot_fkey references public\.fitp_rankings\(id\)/i);
    expect(schema).toMatch(/opponent_ranking_snapshot smallint\s+constraint matches_opponent_ranking_snapshot_fkey references public\.fitp_rankings\(id\)/i);
    expect(schema).not.toMatch(/^\s*(player_ranking_snapshot|opponent_ranking) text/m);
  });
});
