-- Upcoming matches: a match can be saved "In programma" and started later, choosing who serves first only then.
-- Aligns an existing database with supabase/initial_schema.sql. Existing rows already have status_id 2 or 3 and a
-- first_server, so no data changes.

begin;

update public.statuses set applies_to_matches = true where id = 1;

alter table public.matches add column if not exists match_time time;

alter table public.matches alter column first_server drop not null;

alter table public.matches drop constraint if exists matches_status_id_check;
alter table public.matches add constraint matches_status_id_check check (status_id in (1, 2, 3));

alter table public.matches drop constraint if exists matches_first_server_check;
alter table public.matches add constraint matches_first_server_check check (status_id = 1 or first_server is not null);

commit;
