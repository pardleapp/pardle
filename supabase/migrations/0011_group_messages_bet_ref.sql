-- Step 4: realtime group chat.
--
-- Adds an optional bet reference to group_messages so a chat
-- message can attach to a specific bet ("if Scheffler bogeys 17
-- my parlay's dead"). Betting-adjacent talk is first-class — same
-- pattern as channel_messages.ref_bet_id in 0004.
--
-- Realtime is enabled separately via the Supabase dashboard
-- (Database → Replication → toggle group_messages ON). The
-- replication target is the supabase_realtime publication; we
-- could add it via SQL here but the user wanted to see the
-- toggle screen-by-screen, so the migration leaves that step
-- manual.

alter table public.group_messages
  add column if not exists bet_id text
    references public.bets(id) on delete set null;

-- Index for "all chat messages discussing this bet" lookups —
-- powers the "On this bet" thread on /live/bet/[id].
create index if not exists group_messages_bet_idx
  on public.group_messages(bet_id)
  where bet_id is not null;

-- Existing grants from 0010 cover the table-level access; column
-- additions inherit the table grant. Nothing else needed.
