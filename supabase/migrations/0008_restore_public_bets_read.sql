-- Restore public-read visibility on bets that the owner has flagged
-- shareable. Migration 0005b consolidated the SELECT policies and
-- dropped the original `is_public = true` clause from 0002, which
-- silently broke the /share/bet/[id] viral surface — every shared
-- link returned 404 for the anon visitor because RLS denied the
-- read.
--
-- Multiple SELECT policies are OR-ed by Postgres, so this slots in
-- next to "Bets: read own" + "Bets: read channel tips" without
-- touching either.

create policy "Bets: read public" on public.bets
  for select using (is_public = true);
