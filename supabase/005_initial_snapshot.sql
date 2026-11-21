begin;

create table if not exists public.sync_entity_snapshots (
  family_id uuid not null references public.families(id) on delete cascade,
  snapshot_revision bigint not null check (snapshot_revision >= 0),
  entity_type text not null check (entity_type in ('players', 'matches', 'sets', 'games', 'points')),
  entity_id uuid not null,
  payload jsonb not null,
  primary key (family_id, snapshot_revision, entity_type, entity_id)
);

create index if not exists sync_entity_snapshots_lookup_idx
  on public.sync_entity_snapshots(family_id, entity_type, entity_id, snapshot_revision desc);

alter table public.sync_entity_snapshots enable row level security;
revoke all on table public.sync_entity_snapshots from public, anon, authenticated;

-- Backfill one snapshot of all currently persisted records at the current server revision.
do $$
declare
  target_family record;
  target_revision bigint;
begin
  for target_family in select id, sync_revision from public.families
  loop
    target_revision := target_family.sync_revision;

    insert into public.sync_entity_snapshots
      (family_id, snapshot_revision, entity_type, entity_id, payload)
    select target_family.id, target_revision, 'players', p.id, to_jsonb(p)
    from public.players p where p.family_id = target_family.id
    on conflict do nothing;

    insert into public.sync_entity_snapshots
      (family_id, snapshot_revision, entity_type, entity_id, payload)
    select target_family.id, target_revision, 'matches', m.id, to_jsonb(m)
    from public.matches m where m.family_id = target_family.id
    on conflict do nothing;

    insert into public.sync_entity_snapshots
      (family_id, snapshot_revision, entity_type, entity_id, payload)
    select target_family.id, target_revision, 'sets', s.id, to_jsonb(s)
    from public.sets s where s.family_id = target_family.id
    on conflict do nothing;

    insert into public.sync_entity_snapshots
      (family_id, snapshot_revision, entity_type, entity_id, payload)
    select target_family.id, target_revision, 'games', g.id, to_jsonb(g)
    from public.games g where g.family_id = target_family.id
    on conflict do nothing;

    insert into public.sync_entity_snapshots
      (family_id, snapshot_revision, entity_type, entity_id, payload)
    select target_family.id, target_revision, 'points', p.id, to_jsonb(p)
    from public.points p where p.family_id = target_family.id
    on conflict do nothing;
  end loop;
end;
$$;

create or replace function public.record_sync_entity_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sync_entity_snapshots (
    family_id, snapshot_revision, entity_type, entity_id, payload
  ) values (
    new.family_id, new.revision, new.entity_type, new.entity_id, new.payload
  )
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists sync_changes_record_snapshot on public.sync_changes;
create trigger sync_changes_record_snapshot
after insert on public.sync_changes
for each row execute function public.record_sync_entity_snapshot();

create or replace function public.begin_initial_snapshot(_family_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  revision bigint;
begin
  if auth.uid() is null or _family_id is null then
    raise exception 'Authentication required';
  end if;
  if not private.is_family_member(_family_id) then
    raise exception 'Family membership required';
  end if;

  select f.sync_revision into revision
  from public.families f
  where f.id = _family_id
  for share;
  if not found then
    raise exception 'Family not found';
  end if;
  return revision;
end;
$$;

create or replace function public.list_initial_snapshot(
  _family_id uuid,
  _snapshot_revision bigint,
  _entity_type text,
  _after_id uuid default '00000000-0000-0000-0000-000000000000',
  _limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  page jsonb;
begin
  if auth.uid() is null or _family_id is null or _snapshot_revision is null
    or _snapshot_revision < 0 or _entity_type is null
    or _limit is null or _limit < 1 or _limit > 500
    or _after_id is null then
    raise exception 'Invalid snapshot request';
  end if;
  if not private.is_family_member(_family_id) then
    raise exception 'Family membership required';
  end if;
  if _entity_type not in ('players', 'matches', 'sets', 'games', 'points') then
    raise exception 'Unsupported sync entity';
  end if;

  select coalesce(jsonb_agg(snapshot.payload order by snapshot.entity_id), '[]'::jsonb)
  into page
  from (
    select distinct on (snap.entity_id)
      snap.entity_id,
      snap.payload
    from public.sync_entity_snapshots snap
    where snap.family_id = _family_id
      and snap.entity_type = _entity_type
      and snap.snapshot_revision <= _snapshot_revision
      and snap.entity_id > _after_id
    order by snap.entity_id, snap.snapshot_revision desc
    limit least(_limit, 500)
  ) snapshot;

  return page;
end;
$$;

revoke all on function public.record_sync_entity_snapshot() from public, anon, authenticated;
revoke all on function public.begin_initial_snapshot(uuid) from public, anon;
revoke all on function public.list_initial_snapshot(uuid, bigint, text, uuid, integer) from public, anon;
grant execute on function public.begin_initial_snapshot(uuid) to authenticated;
grant execute on function public.list_initial_snapshot(uuid, bigint, text, uuid, integer) to authenticated;

commit;
