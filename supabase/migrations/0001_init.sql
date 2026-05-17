-- Pardle initial schema. Two tables:
--   profiles — links auth.users to a display name and the legacy
--              localStorage author_key for cross-attribution of
--              comments/reactions made pre-signup.
--   bets    — every tracked bet, owned by a user. The variant-
--              specific payload lives in JSONB so adding new bet
--              kinds doesn't require schema migrations.
-- Row Level Security is on for both: users can only read/write their
-- own rows. Service role bypasses RLS for migration jobs.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  author_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_author_key_idx
  on public.profiles(author_key)
  where author_key is not null;

create table if not exists public.bets (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (
    kind in ('outright', 'round-score', 'winning-score', 'top-finish')
  ),
  data jsonb not null,
  placed_at timestamptz not null default now(),
  removed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists bets_user_active_idx
  on public.bets(user_id, removed_at);

create index if not exists bets_user_placed_idx
  on public.bets(user_id, placed_at desc);

alter table public.profiles enable row level security;
alter table public.bets enable row level security;

-- Base table grants. We disabled "Automatically expose new tables"
-- at project setup so the authenticated role doesn't inherit
-- permissions — without these grants, RLS doesn't matter because
-- the role can't access the table at all.
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.bets to authenticated;

drop policy if exists "Profiles: read own" on public.profiles;
create policy "Profiles: read own" on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists "Profiles: insert own" on public.profiles;
create policy "Profiles: insert own" on public.profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists "Profiles: update own" on public.profiles;
create policy "Profiles: update own" on public.profiles
  for update using (auth.uid() = user_id);

drop policy if exists "Bets: read own" on public.bets;
create policy "Bets: read own" on public.bets
  for select using (auth.uid() = user_id);

drop policy if exists "Bets: insert own" on public.bets;
create policy "Bets: insert own" on public.bets
  for insert with check (auth.uid() = user_id);

drop policy if exists "Bets: update own" on public.bets;
create policy "Bets: update own" on public.bets
  for update using (auth.uid() = user_id);

drop policy if exists "Bets: delete own" on public.bets;
create policy "Bets: delete own" on public.bets
  for delete using (auth.uid() = user_id);

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();
