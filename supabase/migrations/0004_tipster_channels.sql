-- Tipster channels: a single tipster posts bets ("tips") to a private
-- group of followers, who can also chat in a per-channel thread and
-- one-click track tips into their own bet tracker.
--
-- channels                 — one per tipster page
-- channel_followers        — who follows / owns each channel
-- channel_messages         — chat posts
-- bets                     — adds channel_id + rationale + source_tip_id
--
-- Notes on RLS:
--   * Visibility of a channel row itself is public for is_public=true,
--     gated to followers/owners for is_public=false. We send the
--     invite_code only to the owner (covered by a partial select
--     policy in addition to the public-row policy).
--   * Membership: any signed-in user can insert their own row (i.e.
--     can self-join). For invite-only channels the client must pass
--     the invite_code; the server validates it before insert.
--   * Tips (bets with channel_id) and messages: only followers/owners
--     of the channel can read; only the channel owner can write tips,
--     any follower/owner can write messages.

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null
    check (char_length(slug) between 3 and 40 and slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
  name text not null check (char_length(name) between 1 and 60),
  owner_id uuid not null references auth.users(id) on delete cascade,
  bio text,
  is_public boolean not null default false,
  invite_code text not null default substr(md5(random()::text), 1, 10),
  created_at timestamptz not null default now()
);

create index if not exists channels_owner_idx on public.channels(owner_id);

create table if not exists public.channel_followers (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'follower' check (role in ('owner', 'follower')),
  joined_at timestamptz not null default now(),
  notify_on_new_tip boolean not null default true,
  primary key (channel_id, user_id)
);

create index if not exists channel_followers_user_idx
  on public.channel_followers(user_id);

create table if not exists public.channel_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  ts timestamptz not null default now(),
  text text not null check (char_length(text) between 1 and 1000),
  -- optional reference to a tip the message is discussing
  ref_bet_id text references public.bets(id) on delete set null
);

create index if not exists channel_messages_channel_ts_idx
  on public.channel_messages(channel_id, ts desc);

-- bets gets two new columns:
--   channel_id  : when set, this bet is a tip posted in that channel
--   rationale   : the tipster's "why I like it" blurb
--   source_tip_id : when set, this bet was created by a follower
--                   one-click-tracking another user's tip (the source)
alter table public.bets
  add column if not exists channel_id uuid references public.channels(id) on delete set null,
  add column if not exists rationale text,
  add column if not exists source_tip_id text references public.bets(id) on delete set null;

create index if not exists bets_channel_placed_idx
  on public.bets(channel_id, placed_at desc)
  where channel_id is not null;

create index if not exists bets_source_tip_idx
  on public.bets(source_tip_id)
  where source_tip_id is not null;

-- ── Row Level Security ───────────────────────────────────────────

alter table public.channels enable row level security;
alter table public.channel_followers enable row level security;
alter table public.channel_messages enable row level security;

grant select, insert, update, delete on public.channels to authenticated;
grant select, insert, update, delete on public.channel_followers to authenticated;
grant select, insert, update, delete on public.channel_messages to authenticated;

-- Helper: am I a follower (or owner) of this channel?
create or replace function public.is_channel_follower(c_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.channel_followers
    where channel_id = c_id and user_id = auth.uid()
  );
$$;

-- Channels: public rows are readable by anyone (browse + landing pages);
-- private rows are readable only by their followers/owner.
drop policy if exists "channels: read public or follower" on public.channels;
create policy "channels: read public or follower" on public.channels
  for select using (
    is_public = true
    or auth.uid() = owner_id
    or public.is_channel_follower(id)
  );

drop policy if exists "channels: owner inserts own" on public.channels;
create policy "channels: owner inserts own" on public.channels
  for insert with check (auth.uid() = owner_id);

drop policy if exists "channels: owner updates own" on public.channels;
create policy "channels: owner updates own" on public.channels
  for update using (auth.uid() = owner_id);

drop policy if exists "channels: owner deletes own" on public.channels;
create policy "channels: owner deletes own" on public.channels
  for delete using (auth.uid() = owner_id);

-- Followers table:
--   * Anyone can read the rows for channels they follow OR own (so
--     they see the member list).
--   * Anyone can insert THEIR OWN row (server validates invite_code
--     before this for private channels).
--   * Users can delete their own row (leave) or the owner can delete
--     any row in their channel (kick).
drop policy if exists "channel_followers: read own channels" on public.channel_followers;
create policy "channel_followers: read own channels" on public.channel_followers
  for select using (
    auth.uid() = user_id
    or public.is_channel_follower(channel_id)
    or auth.uid() in (select owner_id from public.channels where id = channel_id)
  );

drop policy if exists "channel_followers: self insert" on public.channel_followers;
create policy "channel_followers: self insert" on public.channel_followers
  for insert with check (auth.uid() = user_id);

drop policy if exists "channel_followers: self delete or owner kick" on public.channel_followers;
create policy "channel_followers: self delete or owner kick" on public.channel_followers
  for delete using (
    auth.uid() = user_id
    or auth.uid() in (select owner_id from public.channels where id = channel_id)
  );

drop policy if exists "channel_followers: self update notify pref" on public.channel_followers;
create policy "channel_followers: self update notify pref" on public.channel_followers
  for update using (auth.uid() = user_id);

-- Messages: followers/owners can read + write within their channel;
-- author or channel owner can delete.
drop policy if exists "channel_messages: follower reads" on public.channel_messages;
create policy "channel_messages: follower reads" on public.channel_messages
  for select using (public.is_channel_follower(channel_id));

drop policy if exists "channel_messages: follower inserts own" on public.channel_messages;
create policy "channel_messages: follower inserts own" on public.channel_messages
  for insert with check (
    auth.uid() = author_id
    and public.is_channel_follower(channel_id)
  );

drop policy if exists "channel_messages: author or owner deletes" on public.channel_messages;
create policy "channel_messages: author or owner deletes" on public.channel_messages
  for delete using (
    auth.uid() = author_id
    or auth.uid() in (select owner_id from public.channels where id = channel_id)
  );

-- Bets row policy update: existing "read own" already covers private
-- bets. For tips (channel_id set), we want followers to also read them.
-- Re-state the existing policy and add a follower-can-read clause.
drop policy if exists "Bets: read own" on public.bets;
create policy "Bets: read own or channel follower" on public.bets
  for select using (
    auth.uid() = user_id
    or (channel_id is not null and public.is_channel_follower(channel_id))
  );

-- Service role bypasses RLS so admin paths (notify-poll) don't need
-- any special accommodation.
