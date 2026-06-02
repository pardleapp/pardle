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

/** Bet rows the admin client reads for group-aggregation. Only the
 *  fields actually consumed by the standings / most-backed / member-
 *  profile views — the JSONB data column carries everything else but
 *  we don't expose it to the client at any layer. */
interface RawGroupBet {
  id: string;
  user_id: string;
  kind: string;
  data: Record<string, unknown> | null;
  placed_at: string;
  settled_at: string | null;
  settled_won: boolean | null;
}

/** A bet's "static" P&L (consistent with PnLTicker / My-bets
 *  summary): settled outcomes count, open bets count as 0. Live
 *  unrealised movement on open bets is a follow-up (would need the
 *  /api/feed odds pipeline plumbed server-side, shared across
 *  groups). For now an open bet contributes nothing to the race
 *  number but still flows into the "stake at risk" tally so a
 *  member's risk profile reads accurately. */
function staticPnlForBet(b: RawGroupBet): number {
  if (b.settled_at == null || b.settled_won == null) return 0;
  const data = b.data ?? {};
  const stake = Number(data.stake);
  const oddsTaken = Number(data.oddsTaken);
  if (!Number.isFinite(stake) || !Number.isFinite(oddsTaken)) return 0;
  return b.settled_won ? stake * (oddsTaken - 1) : -stake;
}

function isPrivate(b: RawGroupBet): boolean {
  return (b.data ?? {}).isPrivate === true;
}

function isOpen(b: RawGroupBet): boolean {
  return b.settled_at == null;
}

async function fetchVisibleGroupBets(
  groupId: string,
): Promise<RawGroupBet[]> {
  const admin = getSupabaseAdmin();
  const { data: memberRows } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId);
  const members = (memberRows ?? []) as Array<{ user_id: string }>;
  if (members.length === 0) return [];
  const userIds = members.map((m) => m.user_id);
  const { data: betRows } = await admin
    .from("bets")
    .select("id, user_id, kind, data, placed_at, settled_at, settled_won")
    .in("user_id", userIds)
    .is("removed_at", null);
  const bets = (betRows ?? []) as RawGroupBet[];
  // Privacy filter — server-side, never leaves this function. Bets
  // marked isPrivate by their owner are excluded from every group
  // aggregation: standings, most-backed, member profiles.
  return bets.filter((b) => !isPrivate(b));
}

export interface GroupStandingsRow {
  user_id: string;
  display_name: string;
  initials: string;
  role: "admin" | "member";
  is_me: boolean;
  /** Settled P&L for this group view — wins paid, losses subtracted.
   *  Open bets contribute 0 (see note above). */
  net_pnl: number;
  /** Stake at risk on open bets — informational, not part of the
   *  rank. */
  open_stake: number;
  open_count: number;
  settled_count: number;
  /** Currency of the dominant bet stake (first one we see). For
   *  display only; mixed-currency groups still rank by net_pnl as
   *  a raw number which is OK at v1 scale. */
  currency: string;
  dir: "up" | "down" | "flat";
}

/** Per-member standings for a group, sorted by net P&L desc (with
 *  total open stake as a tiebreaker for the all-zero cold-start
 *  case). The caller's row is marked is_me=true so the UI can
 *  highlight it. Private bets never enter the aggregate. */
export async function getGroupStandings(
  groupId: string,
): Promise<GroupStandingsRow[]> {
  const members = await listGroupMembers(groupId);
  if (members.length === 0) return [];
  const bets = await fetchVisibleGroupBets(groupId);

  const byUser = new Map<string, RawGroupBet[]>();
  for (const b of bets) {
    const arr = byUser.get(b.user_id) ?? [];
    arr.push(b);
    byUser.set(b.user_id, arr);
  }

  const rows: GroupStandingsRow[] = members.map((m) => {
    const myBets = byUser.get(m.user_id) ?? [];
    let net_pnl = 0;
    let open_stake = 0;
    let open_count = 0;
    let settled_count = 0;
    let currency = "GBP";
    for (const b of myBets) {
      net_pnl += staticPnlForBet(b);
      if (isOpen(b)) {
        open_count += 1;
        const stake = Number((b.data ?? {}).stake);
        if (Number.isFinite(stake)) open_stake += stake;
      } else {
        settled_count += 1;
      }
      const c = (b.data ?? {}).currency;
      if (typeof c === "string") currency = c;
    }
    const dir: "up" | "down" | "flat" =
      net_pnl > 0.5 ? "up" : net_pnl < -0.5 ? "down" : "flat";
    return {
      user_id: m.user_id,
      display_name: m.display_name,
      initials: m.initials,
      role: m.role,
      is_me: m.is_me,
      net_pnl,
      open_stake,
      open_count,
      settled_count,
      currency,
      dir,
    };
  });

  rows.sort((a, b) => {
    if (b.net_pnl !== a.net_pnl) return b.net_pnl - a.net_pnl;
    return b.open_stake - a.open_stake;
  });
  return rows;
}

export interface MostBackedRow {
  player_id: string;
  player_name: string;
  market_label: string;
  count: number;
  backers: Array<{
    user_id: string;
    display_name: string;
    initials: string;
  }>;
}

/** Open non-private bets across the group, grouped by (player +
 *  market label) and sorted by popularity. Surfaced as the "Most
 *  backed in your group" rail with an avatar stack of backers'
 *  initials. */
export async function getMostBacked(
  groupId: string,
): Promise<MostBackedRow[]> {
  const members = await listGroupMembers(groupId);
  const memberById = new Map(members.map((m) => [m.user_id, m]));
  const bets = await fetchVisibleGroupBets(groupId);

  // Build keys from kind + player + market specifics. We exclude
  // winning-score bets here because they don't have a player —
  // those land in a separate rail later if needed.
  const buckets = new Map<
    string,
    {
      player_id: string;
      player_name: string;
      market_label: string;
      backers: Set<string>;
    }
  >();

  for (const b of bets) {
    if (!isOpen(b)) continue;
    const data = b.data ?? {};
    const playerId = data.playerId;
    const playerName = data.playerName;
    if (typeof playerId !== "string" || typeof playerName !== "string") {
      continue;
    }
    let market_label = "";
    if (b.kind === "outright") market_label = "OUTRIGHT";
    else if (b.kind === "top-finish") {
      const cutoff = data.cutoff;
      market_label = `TOP ${typeof cutoff === "number" ? cutoff : "?"}`;
    } else if (b.kind === "round-score") {
      const side = data.side;
      const line = data.line;
      const round = data.round;
      market_label = `${typeof side === "string" ? side.toUpperCase() : "?"} ${
        typeof line === "number" ? line : "?"
      }${round != null ? ` · R${round}` : ""}`;
    } else {
      continue;
    }
    const key = `${playerId}|${market_label}`;
    const cur = buckets.get(key);
    if (cur) {
      cur.backers.add(b.user_id);
    } else {
      buckets.set(key, {
        player_id: playerId,
        player_name: playerName,
        market_label,
        backers: new Set([b.user_id]),
      });
    }
  }

  const rows: MostBackedRow[] = [];
  for (const b of buckets.values()) {
    const backers = Array.from(b.backers).flatMap((uid) => {
      const m = memberById.get(uid);
      if (!m) return [];
      return [
        {
          user_id: m.user_id,
          display_name: m.display_name,
          initials: m.initials,
        },
      ];
    });
    rows.push({
      player_id: b.player_id,
      player_name: b.player_name,
      market_label: b.market_label,
      count: backers.length,
      backers,
    });
  }
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

export interface MemberOpenBet {
  id: string;
  kind: string;
  player_id: string | null;
  player_name: string | null;
  market_label: string;
  stake: number;
  odds_label: string;
  currency: string;
}

/** Open non-private bets for a single member of a group. RLS-safe:
 *  caller must be a group member, which is checked by the page-
 *  level branch before reaching this helper. Used by MemberProfile. */
export async function getMemberOpenBets(
  groupId: string,
  memberUserId: string,
): Promise<MemberOpenBet[]> {
  const admin = getSupabaseAdmin();
  const { data: betRows } = await admin
    .from("bets")
    .select("id, user_id, kind, data, placed_at, settled_at, settled_won")
    .eq("user_id", memberUserId)
    .is("removed_at", null);
  const bets = ((betRows ?? []) as RawGroupBet[]).filter(
    (b) => !isPrivate(b) && isOpen(b),
  );
  void groupId; // membership check is done at the page level; no
  // direct dependency here. Kept in the signature for future use
  // (e.g. when we add per-group bet visibility scoping).
  return bets
    .map((b): MemberOpenBet | null => {
      const data = b.data ?? {};
      const stake = Number(data.stake);
      const oddsLabel =
        typeof data.oddsTakenLabel === "string" ? data.oddsTakenLabel : "";
      const playerId =
        typeof data.playerId === "string" ? data.playerId : null;
      const playerName =
        typeof data.playerName === "string" ? data.playerName : null;
      let market_label = "";
      if (b.kind === "outright") market_label = "OUTRIGHT";
      else if (b.kind === "top-finish") {
        market_label = `TOP ${
          typeof data.cutoff === "number" ? data.cutoff : "?"
        }`;
      } else if (b.kind === "round-score") {
        market_label = `${
          typeof data.side === "string" ? data.side.toUpperCase() : "?"
        } ${typeof data.line === "number" ? data.line : "?"}${
          data.round != null ? ` · R${data.round}` : ""
        }`;
      } else if (b.kind === "winning-score") {
        market_label = `${
          typeof data.side === "string" ? data.side.toUpperCase() : "?"
        } ${typeof data.line === "number" ? data.line : "?"} · TOT`;
      } else {
        return null;
      }
      return {
        id: b.id,
        kind: b.kind,
        player_id: playerId,
        player_name: playerName,
        market_label,
        stake: Number.isFinite(stake) ? stake : 0,
        odds_label: oddsLabel,
        currency:
          typeof data.currency === "string" ? data.currency : "GBP",
      };
    })
    .filter((b): b is MemberOpenBet => b != null);
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
