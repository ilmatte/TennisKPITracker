-- Incremental migration for databases created before tournaments had a status.
-- New databases get the column directly from supabase/initial_schema.sql.
--
-- tournaments.status: 'upcoming' (In programma, the default for new tournaments), 'in-progress' (In corso) or
-- 'completed' (Concluso). It is changed only by hand from the app. Existing tournaments become 'upcoming', like the
-- app does for the tournaments already stored on each device.
--
-- Idempotent: it can be run again, also on a database where the earlier nullable status column was already added.

begin;

alter table public.tournaments add column if not exists status text;

update public.tournaments
set status = 'upcoming'
where status is null or status not in ('upcoming', 'in-progress', 'completed');

alter table public.tournaments
  alter column status set default 'upcoming',
  alter column status set not null;

-- Replaces the unnamed check of the earlier nullable column, if any, with the named one.
do $$
declare
  existing record;
begin
  for existing in
    select constraint_name.conname
    from pg_catalog.pg_constraint constraint_name
    where constraint_name.conrelid = 'public.tournaments'::regclass
      and constraint_name.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_name.oid) like '%status%'
  loop
    execute pg_catalog.format('alter table public.tournaments drop constraint %I', existing.conname);
  end loop;
end
$$;

alter table public.tournaments
  add constraint tournaments_status_check check (status in ('upcoming', 'in-progress', 'completed'));

commit;
