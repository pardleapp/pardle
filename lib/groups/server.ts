/**
 * Server-side helpers for the groups stack. Two clients in play:
 *
 *   getSupabaseServer() — runs as the signed-in user; every query
 *                         passes through Row Level Security.
 *                         Used for reads/inserts the user is
 *                         authorised for (e.g. listing their own
 *                         groups, posting a chat message).
 *
 *   getSupabaseAdmin()  — service-role; bypasses RLS. Used only
 *                         where the user is intentionally allowed
 *                         to do something RLS would otherwise
 *                         block — specifically: looking up a
 *                         group by invite code (non-members can't
 *                         read the row via RLS) and inserting the
 *                         membership row on join (group_members
 *                         insert is blocked for all clients).
 *
 * Never import this file into a client component. The "server-only"
 * upstream in lib/supabase/server.ts will throw if you try.
 */

import "server-only";
import { getSupabaseServer, getSupabaseAdmin } from "@/lib/supabase/server";

const INVITE_CODE_RE = /^[A-HJKMNPQRSTUVWXYZ23456789]{8}$/;

export function isInviteCode(s: string): boolean {
  return INVITE_CODE_RE.test(s);
}

export interface GroupRow {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  invite_code: string;
  member_count: number;
  role: "admin" | "member";
}

export interface GroupMemberRow {
  user_id: string;
  display_name: string;
  initials: string;
  role: "admin" | "member";
  joined_at: string;
  is_me: boolean;
}

function deriveInitials(name: string, fallbackId: string): string {
  if (!name || name === "Member") {
    // Stable per-user fallback — first two hex chars of the user
    // UUID. Looks like "7C" / "8B" — reads as initials, doesn't
    // ever collide with another user.
    return fallbackId.replace(/-/g, "").slice(0, 2).toUpperCase();
  }
  if (name === "You") return "YO";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** Get the current authenticated user's id, or null. */
export async function getAuthUserId(): Promise<string | null> {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** List groups the current user is in, each with a member count and
 *  the user's role. Returns [] if signed-out. */
export async function listMyGroups(): Promise<GroupSummary[]> {
  const supabase = await getSupabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return [];

  // RLS lets the user read their own membership rows; joining to
  // groups returns only the groups they're in.
  const { data, error } = await supabase
    .from("group_members")
    .select("role, group_id, groups!inner(id, name, invite_code)")
    .eq("user_id", userId);
  if (error || !data) return [];

  // For member counts, ask the admin client — counting via RLS
  // would require a second round-trip with the user client and
  // the count is non-sensitive. The user is already authorised
  // (they're a member) so service-role is fine here.
  const admin = getSupabaseAdmin();
  const groupIds = data.map((r) => r.group_id);
  const counts = new Map<string, number>();
  if (groupIds.length > 0) {
    const { data: countRows } = await admin
      .from("group_members")
      .select("group_id")
      .in("group_id", groupIds);
    const rows = (countRows ?? []) as Array<{ group_id: string }>;
    for (const r of rows) {
      counts.set(r.group_id, (counts.get(r.group_id) ?? 0) + 1);
    }
  }

  return data.map((row) => {
    // The joined groups payload is a single object because of !inner,
    // but TS sees it as a possible array from the type definition —
    // narrow defensively.
    const g = Array.isArray(row.groups) ? row.groups[0] : row.groups;
    return {
      id: g.id as string,
      name: g.name as string,
      invite_code: g.invite_code as string,
      member_count: counts.get(row.group_id) ?? 1,
      role: row.role as "admin" | "member",
    };
  });
}

/** Create a new group with the current user as admin. Returns the
 *  new group's id + invite code. Throws on auth failure.
 *
 *  Server-side trust pattern: auth is verified via the user-session
 *  client (auth.getUser() cryptographically validates the JWT), then
 *  the INSERT runs via the admin client with the verified userId
 *  baked into created_by. This sidesteps a known @supabase/ssr
 *  quirk in Next.js 15 route handlers where the validated JWT
 *  doesn't always reach the PostgREST INSERT, causing auth.uid()
 *  to evaluate to NULL and the "Groups: insert own" RLS policy to
 *  reject the row. Spoofing is impossible because created_by is
 *  never read from client input — only from the validated user.
 *  The add_group_creator_as_admin trigger is SECURITY DEFINER and
 *  fires regardless, so membership is still auto-added. */
export async function createGroup(name: string): Promise<GroupRow> {
  const supabase = await getSupabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not signed in");

  const trimmed = name.trim().slice(0, 60);
  if (trimmed.length === 0) throw new Error("Group name is required");

  const admin = getSupabaseAdmin();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await admin
      .from("groups")
      .insert({ name: trimmed, created_by: userId } as never)
      .select()
      .single();
    if (!error && data) return data as GroupRow;
    if (error?.code !== "23505") {
      // Anything other than unique-violation: propagate up.
      throw new Error(error?.message ?? "Insert failed");
    }
  }
  throw new Error("Could not generate a unique invite code");
}

/** Look up a group by its invite code. Uses the admin client because
 *  RLS blocks non-members from reading the row directly. Returns
 *  enough metadata for the invite-landing page to show the group's
 *  name and member count before the user commits to joining. */
export async function getGroupByInviteCode(
  code: string,
): Promise<{ id: string; name: string; member_count: number } | null> {
  if (!isInviteCode(code)) return null;
  const admin = getSupabaseAdmin();
  const { data: groupRow } = await admin
    .from("groups")
    .select("id, name")
    .eq("invite_code", code)
    .maybeSingle();
  const group = groupRow as { id: string; name: string } | null;
  if (!group) return null;
  const { count } = await admin
    .from("group_members")
    .select("user_id", { count: "exact", head: true })
    .eq("group_id", group.id);
  return {
    id: group.id,
    name: group.name,
    member_count: count ?? 1,
  };
}

/** List the real members of a group from the DB, joined with their
 *  profile display names. New users without a profile row are shown
 *  as "You" (for the caller) or "Member" (for others), with initials
 *  derived from the UUID so the avatar still reads. */
export async function listGroupMembers(
  groupId: string,
): Promise<GroupMemberRow[]> {
  const supabase = await getSupabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  const currentUserId = userData.user?.id ?? null;

  const admin = getSupabaseAdmin();
  const { data: memberRows } = await admin
    .from("group_members")
    .select("user_id, role, joined_at")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });
  const members =
    (memberRows ?? []) as Array<{
      user_id: string;
      role: string;
      joined_at: string;
    }>;
  if (members.length === 0) return [];

  const userIds = members.map((m) => m.user_id);
  const { data: profileRows } = await admin
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", userIds);
  const profiles =
    (profileRows ?? []) as Array<{
      user_id: string;
      display_name: string | null;
    }>;
  const nameById = new Map(profiles.map((p) => [p.user_id, p.display_name]));

  return members.map((m) => {
    const profileName = nameById.get(m.user_id) ?? null;
    const isMe = m.user_id === currentUserId;
    const displayName = profileName || (isMe ? "You" : "Member");
    return {
      user_id: m.user_id,
      display_name: displayName,
      initials: deriveInitials(displayName, m.user_id),
      role: m.role as "admin" | "member",
      joined_at: m.joined_at,
      is_me: isMe,
    };
  });
}

/** Add the current user to a group via its invite code. Idempotent —
 *  if the user is already a member, returns the existing membership
 *  row. Returns the group's id on success; throws on bad code or
 *  auth failure. */
export async function joinGroupByCode(code: string): Promise<string> {
  if (!isInviteCode(code)) throw new Error("Invalid invite code");
  const supabase = await getSupabaseServer();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not signed in");

  const admin = getSupabaseAdmin();
  const { data: groupRow } = await admin
    .from("groups")
    .select("id")
    .eq("invite_code", code)
    .maybeSingle();
  const group = groupRow as { id: string } | null;
  if (!group) throw new Error("Invite code doesn't match any group");

  // Insert via the admin client because the group_members table
  // has NO insert policy for clients — joins must go through this
  // validated server route. on conflict do nothing keeps the call
  // idempotent if the user clicks the link twice.
  const { error } = await admin
    .from("group_members")
    .upsert(
      { group_id: group.id, user_id: userId, role: "member" } as never,
      { onConflict: "group_id,user_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
  return group.id;
}
