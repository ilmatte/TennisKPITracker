-- DISTRUTTIVO: elimina gli oggetti applicativi Tennis KPI in public e i due helper RLS in private.
-- Non usa CASCADE: se un oggetto esterno dipende da queste tabelle, lo script si arresta.
-- Non tocca auth.users, schemi Supabase, provider OAuth, credenziali o il progetto.

begin;

alter table if exists public.families
  drop constraint if exists families_creator_is_owner_fkey;

drop function if exists public.revoke_family_member(uuid, uuid);
drop function if exists public.accept_family_invitation(text);
drop function if exists public.delete_family(uuid);
drop function if exists public.create_family_invitation(uuid, uuid, text);
drop function if exists public.create_family(uuid, text);
drop function if exists private.is_family_owner(uuid);
drop function if exists private.is_family_member(uuid);

drop table if exists public.family_invitations;
drop table if exists public.points;
drop table if exists public.games;
drop table if exists public.sets;
drop table if exists public.matches;
drop table if exists public.players;
drop table if exists public.family_members;
drop table if exists public.families;

commit;
