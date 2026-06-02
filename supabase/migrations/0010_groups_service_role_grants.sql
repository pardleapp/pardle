-- Fix-up for 0009: grant the service_role role table-level access to
-- the three new groups tables.
--
-- Why this is needed: the Supabase project has "auto-expose new
-- tables" disabled, so the service_role does NOT automatically pick
-- up grants on tables created after the project was set up. The
-- migration 0009 granted to `authenticated` (for the user-session
-- client path) but missed `service_role` (for the admin client
-- path, which is what the create/join routes actually use to dodge
-- the Next.js 15 SSR cookie quirk). The symptom was:
--   "permission denied for table groups"
-- when POST /api/groups/create tried to insert via the admin
-- client. service_role bypasses RLS but still needs the table-
-- level GRANT before it can touch the row at all.
--
-- This migration is additive and idempotent — safe to re-run.

grant all on public.groups to service_role;
grant all on public.group_members to service_role;
grant all on public.group_messages to service_role;

-- Also grant execute on the helper functions for completeness.
-- SECURITY DEFINER functions run as the definer regardless, but
-- the EXECUTE grant is what controls whether the calling role can
-- INVOKE them at all.
grant execute on function public.generate_invite_code()
  to anon, authenticated, service_role;
grant execute on function public.is_group_member(uuid)
  to anon, authenticated, service_role;
grant execute on function public.add_group_creator_as_admin()
  to anon, authenticated, service_role;
