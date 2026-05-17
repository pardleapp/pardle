-- Browser push notifications.
--
-- push_subscriptions: one row per (user, browser/device). Generated
-- when the user grants notification permission and the service
-- worker subscribes to push. The endpoint URL is unique per device
-- and is what the server POSTs to via the web-push library.
--
-- bets gets a handful of "last notified" columns so the cron can
-- diff current model state against what we last pinged the user
-- about, and one-shot threshold-crossed flags so we don't re-fire
-- "now favoured" every time prob bounces above 50%.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push: read own" on public.push_subscriptions;
create policy "push: read own" on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "push: insert own" on public.push_subscriptions;
create policy "push: insert own" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "push: delete own" on public.push_subscriptions;
create policy "push: delete own" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete
  on public.push_subscriptions to authenticated;

-- Notification state on bets
alter table public.bets
  add column if not exists last_notified_prob double precision,
  add column if not exists last_notified_value double precision,
  add column if not exists last_notified_at timestamptz,
  add column if not exists settled_at timestamptz,
  add column if not exists settled_won boolean,
  add column if not exists notif_mode text not null default 'all',
  add column if not exists notif_crossed_50_up boolean not null default false,
  add column if not exists notif_crossed_50_down boolean not null default false,
  add column if not exists notif_crossed_80 boolean not null default false,
  add column if not exists notif_crossed_20 boolean not null default false;

-- Constrain notif_mode to known values. Using a check constraint
-- rather than an enum so future modes (e.g. 'mute-1h') are a column
-- update, not a migration.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bets_notif_mode_check'
  ) then
    alter table public.bets
      add constraint bets_notif_mode_check
      check (notif_mode in ('all', 'settle-only', 'off'));
  end if;
end$$;

create index if not exists bets_notify_scan_idx
  on public.bets(user_id, settled_at, last_notified_at)
  where removed_at is null and notif_mode <> 'off';
