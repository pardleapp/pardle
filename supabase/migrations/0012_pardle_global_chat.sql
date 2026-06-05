-- Pardle Global — a single site-wide chat channel everyone can read
-- and post to.
--
-- Modelled as a regular `groups` row with a well-known fixed UUID
-- so the existing group_messages table, RLS policies, /api/groups/
-- [id]/messages endpoint, and GroupChat client component all
-- continue to work without modification.
--
-- The well-known id is:
--   00000000-0000-0000-0000-000000000010
--
-- Every authenticated user is auto-joined via a trigger on auth.users
-- insert + a one-time backfill of existing users. They cannot leave
-- the channel via the "Leave group" UI because the rail surface
-- doesn't expose that affordance — but if they do (via direct API),
-- the trigger doesn't re-add them. That's deliberate: it's their
-- right to mute the global channel.
--
-- Realtime: this channel piggybacks on the same group_messages
-- table that already has Realtime enabled per migration 0009. No
-- extra config needed.

-- ─────────────────────────────────────────────────────────────────────────
-- The Pardle Global group itself.
-- ─────────────────────────────────────────────────────────────────────────
-- The created_by column is NOT NULL and references auth.users(id).
-- We need a real user to anchor it; the cleanest option is to pick
-- the first existing user (e.g. the project owner). If no users
-- exist yet (fresh project), this insert is skipped and the next
-- migration run after the first user signs up will create it.
do $$
declare
  owner_id uuid;
  global_id constant uuid := '00000000-0000-0000-0000-000000000010';
begin
  select id into owner_id from auth.users order by created_at asc limit 1;
  if owner_id is null then
    raise notice 'No users yet; Pardle Global group will be created on next migration run after first signup.';
    return;
  end if;
  insert into public.groups (id, name, invite_code, created_by)
  values (
    global_id,
    'Pardle Global',
    'GLOBAL00',  -- placeholder invite code; the channel is auto-join, not invite-driven
    owner_id
  )
  on conflict (id) do nothing;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Backfill: every existing user becomes a member of Pardle Global.
-- ─────────────────────────────────────────────────────────────────────────
insert into public.group_members (group_id, user_id, role)
select
  '00000000-0000-0000-0000-000000000010'::uuid,
  u.id,
  'member'
from auth.users u
where exists (select 1 from public.groups where id = '00000000-0000-0000-0000-000000000010')
on conflict (group_id, user_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- Auto-add new users to Pardle Global on signup.
-- SECURITY DEFINER so the trigger can write to group_members regardless
-- of RLS (which blocks direct client inserts into group_members).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.add_user_to_pardle_global()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (
    '00000000-0000-0000-0000-000000000010'::uuid,
    new.id,
    'member'
  )
  on conflict (group_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists pardle_global_auto_join on auth.users;
create trigger pardle_global_auto_join
  after insert on auth.users
  for each row execute function public.add_user_to_pardle_global();

-- ─────────────────────────────────────────────────────────────────────────
-- Done. UI surface: app/_components/DesktopChatRail.tsx pulls
-- /api/groups/00000000-0000-0000-0000-000000000010/messages.
-- ─────────────────────────────────────────────────────────────────────────
