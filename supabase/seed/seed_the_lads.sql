-- Optional seed: create "The Lads" group with your test account as admin.
--
-- Run this AFTER migration 0009 has been applied.
--
-- How to use:
--   1. Open Supabase dashboard → Authentication → Users.
--   2. Find your test account (the email you sign in to Pardle with) and
--      copy its UUID (the long string under the "UID" column).
--   3. Replace the placeholder 'YOUR-UUID-HERE' below with that UUID.
--   4. Paste this whole file into Supabase → SQL Editor → New query → Run.
--
-- A brand-new user with no groups still gets the proper empty state on
-- /groups — this seed only populates your own account.

insert into public.groups (id, name, created_by, invite_code)
values (
  gen_random_uuid(),
  'The Lads',
  'YOUR-UUID-HERE'::uuid,
  'LADSDEMO'
)
on conflict (invite_code) do nothing;

-- The groups_add_creator_trigger fires automatically and adds you to
-- group_members as admin. Nothing else needed here — no other seeded
-- members yet, since they'd need real auth.users rows. Once a friend
-- joins via pardle.app/c/LADSDEMO they'll show up in the members list.
