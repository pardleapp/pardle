/**
 * Aggregate "% of Pardle bettors backing this player" for the
 * current tournament. The novel layer Real-style apps can't easily
 * replicate — only we know what our community is actually betting on.
 *
 * Server-only.
 */
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/** Floor on absolute backers — anything below this is just the
 *  tipster themselves; not worth a chip. */
const MIN_BACKERS = 2;
/** Floor on percentage — keeps the chip rare-ish so it lands as a
 *  signal, not visual noise. */
const MIN_PCT = 5;

export interface CommunityBackingMap {
  /** playerId → integer percent of distinct bettors backing them
   *  (out of every distinct bettor who placed a bet in the window). */
  byPlayer: Record<string, number>;
  /** Total distinct bettors in the window. Useful for the UI to
   *  decide whether the population is big enough to surface the
   *  community-backing chip at all (e.g. ignore if total < 10). */
  totalBettors: number;
}

const EMPTY: CommunityBackingMap = { byPlayer: {}, totalBettors: 0 };

/**
 * Compute community-backing for a tournament window.
 *   - Personal bets only (channel_id IS NULL — skip tipster channel posts)
 *   - Outright + top-finish only (other kinds have no player to attribute)
 *   - Active (removed_at IS NULL)
 *   - Placed within `[tournamentStart - 2d, tournamentStart + 7d]` so
 *     pre-tournament Wednesday-night bets count
 *
 * Returns an empty map if the population is too small for a stable
 * percentage to be meaningful.
 */
export async function computeCommunityBacking(
  tournamentStartMs: number,
): Promise<CommunityBackingMap> {
  if (!Number.isFinite(tournamentStartMs)) return EMPTY;
  const start = new Date(tournamentStartMs - 2 * 24 * 60 * 60 * 1000);
  const end = new Date(tournamentStartMs + 7 * 24 * 60 * 60 * 1000);
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("bets")
    .select("user_id, kind, data, placed_at")
    .gte("placed_at", start.toISOString())
    .lte("placed_at", end.toISOString())
    .is("removed_at", null)
    .is("channel_id", null)
    .in("kind", ["outright", "top-finish"]);
  if (error || !data) return EMPTY;
  const byPlayer = new Map<string, Set<string>>();
  const allUsers = new Set<string>();
  for (const row of data as Array<{
    user_id: string;
    kind: string;
    data: { playerId?: string };
  }>) {
    const playerId = row.data?.playerId;
    if (!playerId) continue;
    if (!byPlayer.has(playerId)) byPlayer.set(playerId, new Set());
    byPlayer.get(playerId)!.add(row.user_id);
    allUsers.add(row.user_id);
  }
  const total = allUsers.size;
  if (total < 2) return EMPTY;
  const out: Record<string, number> = {};
  for (const [pid, set] of byPlayer) {
    if (set.size < MIN_BACKERS) continue;
    const pct = Math.round((set.size / total) * 100);
    if (pct < MIN_PCT) continue;
    out[pid] = pct;
  }
  return { byPlayer: out, totalBettors: total };
}
