-- Splits the bets read policy into two independent SELECT policies
-- so users can always read their own bets even if the channel-tip
-- visibility clause has any issue.
--
-- Multiple SELECT policies are OR-ed together by Postgres, so the
-- net visibility is identical to the single combined policy in
-- migration 0004 — but if `is_channel_follower(...)` ever has a
-- runtime issue it can't take down the "read your own bets" path.

drop policy if exists "Bets: read own or channel follower" on public.bets;
drop policy if exists "Bets: read own" on public.bets;
drop policy if exists "Bets: read channel tips" on public.bets;

create policy "Bets: read own" on public.bets
  for select using (auth.uid() = user_id);

create policy "Bets: read channel tips" on public.bets
  for select using (
    channel_id is not null
    and public.is_channel_follower(channel_id)
  );
