-- Bets: capture the visitor's anonymous authorKey at placement time
-- so the notify-poll cron can attribute the settled outcome to the
-- right Sharp Score ledger.
--
-- Sharp Score is keyed by authorKey (cookie identity, shared with
-- comments + reactions + putt-poll votes); the bets table is keyed
-- by user_id (Supabase auth uid). When a bet settles, the cron needs
-- the authorKey to credit / debit the user's accuracy track-record.
--
-- Nullable + no foreign key: legacy bets placed before this column
-- existed simply won't contribute to Sharp Score. New bets capture
-- it on the POST /api/bets path.

alter table public.bets
  add column if not exists author_key text;

create index if not exists bets_author_key_idx
  on public.bets(author_key)
  where author_key is not null;
