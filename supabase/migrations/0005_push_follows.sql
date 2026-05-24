-- Push subscriptions track which players each device is following so
-- the notify-poll cron can address followed-player events (birdie,
-- eagle, ace, blow-up, putt-poll opens) to the right users without
-- needing follows in a separate table.
--
-- Storing follows directly on push_subscriptions (rather than a new
-- table) reflects how follows are scoped today — per-device in
-- localStorage — and avoids a join in the cron path.
--
-- last_notified_event_ts is the most recent feed-event timestamp we
-- already pushed to this subscription. The cron filters to events
-- newer than this so we never double-push.

alter table public.push_subscriptions
  add column if not exists follows text[] not null default '{}',
  add column if not exists last_notified_event_ts bigint;

-- GIN index lets the cron find "subs following this playerId" in O(log n)
-- across thousands of subscriptions.
create index if not exists push_subscriptions_follows_gin_idx
  on public.push_subscriptions using gin (follows);

-- Subscriptions with at least one follow are the addressable set for
-- followed-player pushes. Index narrows the cron's scan.
create index if not exists push_subscriptions_has_follows_idx
  on public.push_subscriptions(last_notified_event_ts)
  where array_length(follows, 1) > 0;
