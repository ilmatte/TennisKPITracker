begin;

do $$
begin
  if exists (
    select 1
    from public.families
    group by created_by
    having count(*) > 1
  ) then
    raise exception
      'Duplicate owner workspaces exist. Resolve them without deleting data before applying this migration.';
  end if;
end;
$$;

create unique index if not exists families_one_workspace_per_owner_idx
  on public.families(created_by);

create or replace function public.create_family(_id uuid, _name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_family_id uuid := _id;
  existing_family_id uuid;
  owner_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text, 0)
  );

  select f.id into existing_family_id
  from public.families f
  where f.created_by = auth.uid();
  if found then
    return existing_family_id;
  end if;

  if new_family_id is null or _name is null or length(btrim(_name)) = 0 then
    raise exception 'Family name is required';
  end if;

  if exists (
    select 1
    from public.family_members fm
    where fm.user_id = auth.uid()
      and fm.role = 'member'
  ) then
    raise exception 'A family member cannot create an owner workspace';
  end if;

  select lower(u.email) into owner_email
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
  if owner_email is null then
    raise exception 'A confirmed email address is required';
  end if;

  insert into public.families (id, name, created_by)
  values (new_family_id, btrim(_name), auth.uid())
  on conflict (created_by) do nothing
  returning id into existing_family_id;

  if existing_family_id is null then
    select f.id into existing_family_id
    from public.families f
    where f.created_by = auth.uid();
    return existing_family_id;
  end if;

  insert into public.family_members (family_id, user_id, member_email, role)
  values (existing_family_id, auth.uid(), owner_email, 'owner');
  return existing_family_id;
end;
$$;

create or replace function public.accept_family_invitation(_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_email text;
  pgcrypto_schema name;
  computed_token_hash text;
  invitation public.family_invitations%rowtype;
begin
  if auth.uid() is null or _token is null or _token !~ '^[0-9a-f]{64}$' then
    raise exception 'Authentication and a valid invitation are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(auth.uid()::text, 0)
  );

  select lower(u.email) into current_email
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;
  if current_email is null then
    raise exception 'A confirmed email address is required';
  end if;

  select n.nspname into pgcrypto_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';
  if pgcrypto_schema is null then
    raise exception 'pgcrypto is not installed';
  end if;
  execute format(
    'select encode(%I.digest(convert_to(%L, %L), %L), %L)',
    pgcrypto_schema, _token, 'UTF8', 'sha256', 'hex'
  ) into computed_token_hash;

  select fi.* into invitation
  from public.family_invitations fi
  where fi.token_hash = computed_token_hash
  for update;
  if not found or invitation.accepted_at is not null or invitation.expires_at <= now() then
    raise exception 'Invitation is invalid, expired, or already used';
  end if;
  if invitation.invited_email <> current_email then
    raise exception 'Invitation email does not match the authenticated account';
  end if;
  if exists (
    select 1 from public.family_members fm
    where fm.family_id = invitation.family_id and fm.user_id = auth.uid()
  ) then
    raise exception 'This account is already a family member';
  end if;

  insert into public.family_members (family_id, user_id, member_email, role)
  values (invitation.family_id, auth.uid(), current_email, 'member');
  update public.family_invitations
  set accepted_at = now()
  where id = invitation.id and accepted_at is null;
  return invitation.family_id;
end;
$$;

commit;
