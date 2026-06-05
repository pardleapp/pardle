/**
 * Pardle Global chat — the site-wide channel that lives in the
 * desktop right rail. Every authenticated user is auto-joined via
 * the trigger in migration 0012, so this channel piggybacks on the
 * regular groups infrastructure (group_messages table, RLS, the
 * /api/groups/[id]/messages endpoint, Realtime). The only thing
 * special is the fixed UUID below, which both client and server
 * use as the group_id.
 */
export const PARDLE_GLOBAL_GROUP_ID =
  "00000000-0000-0000-0000-000000000010";
