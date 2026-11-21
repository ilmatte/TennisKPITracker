import { describe, expect, it } from 'vitest';

import schema from '../../supabase/001_initial_schema.sql?raw';
import migration from '../../supabase/002_single_workspace_per_owner.sql?raw';
import syncProtocol from '../../supabase/003_sync_protocol.sql?raw';

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
      /create unique index families_one_workspace_per_owner_idx\s+on public\.families\s*\(created_by\)/i,
    );
    expect(migration).toMatch(
      /create unique index if not exists families_one_workspace_per_owner_idx\s+on public\.families\s*\(created_by\)/i,
    );
    expect(migration).toMatch(/group by created_by\s+having count\(\*\) > 1/i);
  });

  it('makes create_family idempotent and safe against concurrent calls', () => {
    const body = functionBody(migration, 'create_family');
    expect(body).toMatch(/pg_advisory_xact_lock/i);
    expect(body).toMatch(/where f\.created_by = auth\.uid\(\)/i);
    expect(body).toMatch(/on conflict \(created_by\) do nothing/i);
    expect(body).toMatch(/a family member cannot create an owner workspace/i);
    expect(body).toMatch(/values\s*\(existing_family_id,\s*auth\.uid\(\),\s*owner_email,\s*'owner'\)/i);
  });

  it('serializes invitation acceptance with owner-workspace creation and keeps invitees members', () => {
    const body = functionBody(migration, 'accept_family_invitation');
    expect(body).toMatch(/pg_advisory_xact_lock/i);
    expect(body).toMatch(/values\s*\(invitation\.family_id,\s*auth\.uid\(\),\s*current_email,\s*'member'\)/i);
    expect(body).not.toMatch(/insert\s+into public\.families/i);
    expect(migration).not.toMatch(/delete\s+from public\.families/i);
  });

  it('uses only version-checked RPC writes and a serialized, paginated change cursor', () => {
    expect(syncProtocol).toMatch(/add column if not exists sync_revision bigint/i);
    expect(syncProtocol).toMatch(/create table if not exists public\.sync_changes/i);
    expect(syncProtocol).toMatch(/update public\.families\s+set sync_revision = sync_revision \+ 1/i);
    expect(syncProtocol).toMatch(/insert into public\.sync_changes/i);
    expect(syncProtocol).toMatch(/create or replace function public\.apply_sync_record/i);
    expect(syncProtocol).toMatch(/current_version <> _base_version/i);
    expect(syncProtocol).toMatch(/where id = \$1 for update/i);
    expect(syncProtocol).toMatch(/'status', 'conflict'/i);
    expect(syncProtocol).toMatch(/when unique_violation then/i);
    expect(syncProtocol).toMatch(/'reason', 'constraint'/i);
    expect(syncProtocol).toMatch(/create or replace function public\.pull_sync_changes/i);
    expect(syncProtocol).toMatch(/order by change\.revision/i);
    expect(syncProtocol).toMatch(/set search_path = ''/i);
    expect(syncProtocol).toMatch(/private\.is_family_member\(_family_id\)/i);
    expect(syncProtocol).toMatch(/revoke insert, update, delete on table[\s\S]*from public, anon, authenticated/i);
    expect(syncProtocol).not.toMatch(/\b(drop|truncate)\s+table\b/i);
  });
});
