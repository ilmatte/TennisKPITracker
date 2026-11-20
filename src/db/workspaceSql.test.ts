import { describe, expect, it } from 'vitest';

import schema from '../../supabase/001_initial_schema.sql?raw';
import migration from '../../supabase/002_single_workspace_per_owner.sql?raw';

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
});
