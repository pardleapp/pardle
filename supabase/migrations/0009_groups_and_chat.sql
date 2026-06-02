-- Pardle private groups + group chat backbone.
--
-- Three tables:
--   groups            — one row per private group (name, invite code, creator).
--   group_members     — (group_id, user_id) pairs — source of truth for "is
--                       user X allowed to see / write to group Y?". Includes
--                       a role column (admin = creator, member = joined via
--                       invite code).
--   group_messages    — chat messages. RLS allows read/write only when the
--                       requesting user has a group_members row for that
--                       group.
--
-- Security model in plain English:
--   - Every table has Row Level Security ON. Postgres blocks every read/
--     write that doesn't pass a policy.
--   - The policy on chat messages is: "you can read/write this row only if
--     auth.uid() has a row in group_members for this group_id". Membership
--     is the gate.
--   - Joining requires a valid invite code, validated by the /api/groups/
--     join route handler running with the service-role key (which bypasses
--     RLS). The client cannot insert into group_members directly — RLS
--     denies that.
--   - The creator of a group is added as an admin automatically by a
--     trigger; they don't need an invite code to access their own group.
--   - Realtime on group_messages is enabled in a follow-up step (Database
--     → Replication in the Supabase dashboard) so the user can see the
--     toggle as part of step 4.

-- ─────────────────────────────────────────────────────────────────────────
-- Helper: invite code generator. 8 chars, uppercase letters + digits, no
-- ambiguous chars (no 0/O/1/I/L). 31 chars × 8 positions ≈ 8.5 × 10^11
-- possibilities. Used as the default for groups.invite_code.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.generate_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
  i int;
begin
  for i in 1..8 loop
    code := code || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
  end loop;
  return code;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- groups
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique default public.generate_invite_code(),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists groups_created_by_idx on public.groups(created_by);
create index if not exists groups_invite_code_idx on public.groups(invite_code);

-- ─────────────────────────────────────────────────────────────────────────
-- group_members
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on public.group_members(user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- group_messages
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists group_messages_group_created_idx
  on public.group_messages(group_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- Membership-check helper. SECURITY DEFINER so it runs as the function
-- owner (admin), bypassing RLS — this avoids an infinite recursion when
-- the group_members read policy itself queries group_members.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id
      and user_id = auth.uid()
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Trigger: when a group is created, auto-insert the creator as an admin
-- in group_members. SECURITY DEFINER so the trigger can write to
-- group_members regardless of RLS (which blocks direct client inserts).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.add_group_creator_as_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.created_by, 'admin')
  on conflict (group_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists groups_add_creator_trigger on public.groups;
create trigger groups_add_creator_trigger
  after insert on public.groups
  for each row execute function public.add_group_creator_as_admin();

-- ─────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_messages enable row level security;

-- Grants — Pardle has "auto-expose new tables" disabled at project setup,
-- so the authenticated role needs explicit access before RLS even applies.
grant select, insert on public.groups to authenticated;
grant select, delete on public.group_members to authenticated;
grant select, insert on public.group_messages to authenticated;

-- ─── groups policies ───────────────────────────────────────────────────
-- Read: only members can read the row (name, member count, etc.). The
-- invite-code lookup on the join flow goes through /api/groups/join,
-- which uses the service-role key (bypasses RLS) — so non-members never
-- see the row directly.
drop policy if exists "Groups: read if member" on public.groups;
create policy "Groups: read if member" on public.groups
  for select using (public.is_group_member(id));

-- Insert: any authenticated user can create a group; they must set
-- created_by to themselves (RLS prevents impersonation). The
-- groups_add_creator_trigger fires after insert and adds them as admin.
drop policy if exists "Groups: insert own" on public.groups;
create policy "Groups: insert own" on public.groups
  for insert with check (auth.uid() = created_by);

-- ─── group_members policies ───────────────────────────────────────────
-- Read: a member can see every member of groups they belong to.
drop policy if exists "Members: read own groups" on public.group_members;
create policy "Members: read own groups" on public.group_members
  for select using (public.is_group_member(group_id));

-- Insert: BLOCKED on the client. All joins go through /api/groups/join
-- with the service-role key, which bypasses RLS. The trigger that adds
-- the creator on group creation also runs as definer and bypasses RLS.
-- No insert policy → all client inserts fail.

-- Delete: a user can delete their own membership row (= leave the group).
-- They cannot delete other people. Admins removing members is out of v1
-- scope; if needed later, add an admin-can-delete policy.
drop policy if exists "Members: leave own" on public.group_members;
create policy "Members: leave own" on public.group_members
  for delete using (user_id = auth.uid());

-- ─── group_messages policies ───────────────────────────────────────────
-- Read: only members can see a group's messages.
drop policy if exists "Messages: read if member" on public.group_messages;
create policy "Messages: read if member" on public.group_messages
  for select using (public.is_group_member(group_id));

-- Insert: a member can post a message in their group; user_id must be
-- themselves (so the row is correctly attributed).
drop policy if exists "Messages: insert if member" on public.group_messages;
create policy "Messages: insert if member" on public.group_messages
  for insert with check (
    auth.uid() = user_id
    and public.is_group_member(group_id)
  );

-- ─────────────────────────────────────────────────────────────────────────
-- Done. To enable realtime on group_messages, run in Supabase dashboard:
--   Database → Replication → toggle group_messages ON.
-- (Walked through in step 4 of the rollout.)
-- ─────────────────────────────────────────────────────────────────────────
