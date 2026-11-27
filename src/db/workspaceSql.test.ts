import { describe, expect, it } from 'vitest';

import schema from '../../supabase/initial_schema.sql?raw';
import tournamentStatusMigration from '../../supabase/migrations/20261127_tournament_status.sql?raw';

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

  it('gives tournaments a required status, "upcoming" by default, in the schema and in the incremental migration', () => {
    const check = /constraint tournaments_status_check check \(status in \('upcoming', 'in-progress', 'completed'\)\)/i;
    expect(schema).toMatch(/status text not null default 'upcoming'/i);
    expect(schema).toMatch(check);
    expect(tournamentStatusMigration).toMatch(/add column if not exists status text/i);
    expect(tournamentStatusMigration).toMatch(/set status = 'upcoming'\s+where status is null/i);
    expect(tournamentStatusMigration).toMatch(/alter column status set default 'upcoming'/i);
    expect(tournamentStatusMigration).toMatch(/alter column status set not null/i);
    expect(tournamentStatusMigration).toMatch(check);
  });
});
