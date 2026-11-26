import { describe, expect, it } from 'vitest';

import schema from '../../supabase/initial_schema.sql?raw';
import tournamentsMigration from '../../supabase/003_tournaments.sql?raw';

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
    expect(tournamentsMigration).not.toMatch(/\b(drop|truncate)\s+table\b/i);
    for (const sql of [schema, tournamentsMigration]) {
      expect(sql).toMatch(/constraint tournaments_family_id_club_id_fkey foreign key \(family_id, club_id\)\s+references public\.clubs\(family_id, id\)/i);
      expect(sql).toMatch(/add constraint tournaments_age_category_id_fkey\s+foreign key \(age_category_id\) references public\.player_age_categories\(id\)/i);
      expect(sql).toMatch(/constraint matches_family_id_tournament_id_fkey foreign key \(family_id, tournament_id\)\s+references public\.tournaments\(family_id, id\)/i);
      expect(sql).toMatch(/create policy "family members can read tournaments"/i);
      expect(sql.match(/'players', 'clubs', 'tournaments', 'matches', 'sets', 'games', 'points'/g)).toHaveLength(4);
    }
  });

  it('upgrades existing projects with the same sync functions as a new project', () => {
    for (const name of ['apply_sync_record', 'list_initial_snapshot']) {
      expect(functionBody(tournamentsMigration, name)).toBe(functionBody(schema, name));
    }
    expect(functionBody(schema, 'apply_sync_record')).toMatch(/when 'tournaments' then 'tournaments'/);
    expect(tournamentsMigration).toMatch(/create table if not exists public\.tournaments/i);
    expect(tournamentsMigration).toMatch(/alter table public\.matches add column if not exists tournament_id uuid/i);
    expect(tournamentsMigration).toMatch(/alter table public\.matches drop column if exists tournament;/i);
    expect(schema).not.toMatch(/^\s*tournament text,/m);
  });
});
