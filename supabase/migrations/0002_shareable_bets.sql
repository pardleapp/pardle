-- Shareable bets: opt-in public read. Bets stay private by default
-- (is_public = false). When the owner clicks Share, we flip
-- is_public to true, after which the row is readable by anyone —
-- authenticated or anonymous. The owner can still view/edit it via
-- their own RLS policies regardless.

alter table public.bets
  add column if not exists is_public boolean not null default false;

create index if not exists bets_public_idx
  on public.bets(is_public)
  where is_public = true;

drop policy if exists "Bets: read own" on public.bets;
create policy "Bets: read own or public" on public.bets
  for select using (
    auth.uid() = user_id
    or is_public = true
  );

-- Anon role also needs base SELECT to be able to read public bets
-- (the row-level policy then filters to is_public = true only).
grant select on public.bets to anon;

-- Profiles are needed by the share view to show 'Tom's bet on
-- Scheffler' attribution. Display name only — nothing else exposed.
drop policy if exists "Profiles: read own" on public.profiles;
create policy "Profiles: read own or owner-of-public-bet" on public.profiles
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.bets
      where bets.user_id = profiles.user_id
        and bets.is_public = true
    )
  );

grant select on public.profiles to anon;
