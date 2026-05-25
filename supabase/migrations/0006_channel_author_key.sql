-- Channels: link the owner's anonymous authorKey so the channel page
-- can display their Putt-IQ stats as a credibility chip alongside
-- bet PnL ("Putt IQ: 12/18 · 67% · #3 this week").
--
-- Putt-IQ records are stored in Redis keyed by authorKey (the cookie-
-- based identity used by every Pardle visitor — no auth required to
-- accumulate stats). Channels store owner_id (Supabase auth uid).
-- These two namespaces don't normally overlap; this column is the
-- explicit bridge, populated by the owner when they sync from their
-- own channel page.
--
-- Nullable because the link is opt-in — a tipster can decline to
-- claim their cookie if they want to keep PuttIQ off the page.

alter table public.channels
  add column if not exists owner_author_key text;

-- Cheap lookup by key when we need to find which channel an
-- authorKey owns (currently unused, but the index is < 1 KB on a
-- small table and saves a future migration if the reverse-lookup
-- pattern shows up).
create index if not exists channels_owner_author_key_idx
  on public.channels(owner_author_key)
  where owner_author_key is not null;
