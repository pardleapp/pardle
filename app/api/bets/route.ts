import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Reasonable bounds for the per-bet numbers we persist. Stake is
 *  capped well above what a friends-launch user could realistically
 *  type but well below "obvious garbage". Odds and line ranges are
 *  picked to be inclusive of every real market we surface. */
const MAX_STAKE = 100_000;
const MAX_ODDS = 1_000;
const MAX_LINE = 400; // covers winning-score totals + per-round lines
const VALID_KINDS = new Set([
  "outright",
  "round-score",
  "winning-score",
  "top-finish",
]);
const VALID_SIDES = new Set(["under", "over"]);
const VALID_TOP_CUTOFFS = new Set([5, 10, 20]);
const PLAYER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function isPositiveNumberInRange(
  v: unknown,
  min: number,
  max: number,
): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

function isOptString(v: unknown, max = 200): v is string | undefined {
  return v === undefined || (typeof v === "string" && v.length <= max);
}

/** Validate every field we'll persist. Returns null on success or a
 *  short reason string for the 400 response. Errs on the strict side
 *  — a real client whose validation matches ours will never hit this
 *  branch; an attacker hand-rolling the JSON will. */
function validateBet(bet: Record<string, unknown>): string | null {
  const { id, kind, placedAt, stake, oddsTaken, oddsTakenLabel } = bet;
  if (typeof id !== "string" || !ID_RE.test(id)) return "bad-id";
  if (typeof kind !== "string" || !VALID_KINDS.has(kind)) return "bad-kind";
  if (
    typeof placedAt !== "number" ||
    !Number.isFinite(placedAt) ||
    placedAt < 0 ||
    placedAt > Date.now() + 60_000
  ) {
    return "bad-placedAt";
  }
  if (!isPositiveNumberInRange(stake, 0.01, MAX_STAKE)) return "bad-stake";
  if (!isPositiveNumberInRange(oddsTaken, 1, MAX_ODDS)) return "bad-oddsTaken";
  if (!isOptString(oddsTakenLabel, 32)) return "bad-oddsTakenLabel";

  if (kind === "outright" || kind === "round-score" || kind === "top-finish") {
    const playerId = bet.playerId;
    if (typeof playerId !== "string" || !PLAYER_ID_RE.test(playerId)) {
      return "bad-playerId";
    }
    if (!isOptString(bet.playerName, 80)) return "bad-playerName";
  }
  if (kind === "round-score") {
    if (
      bet.round !== null &&
      !(typeof bet.round === "number" && Number.isInteger(bet.round) && bet.round >= 1 && bet.round <= 4)
    ) {
      return "bad-round";
    }
    if (typeof bet.side !== "string" || !VALID_SIDES.has(bet.side)) return "bad-side";
    if (!isPositiveNumberInRange(bet.line, 50, 130)) return "bad-line";
  }
  if (kind === "winning-score") {
    if (typeof bet.side !== "string" || !VALID_SIDES.has(bet.side)) return "bad-side";
    if (!isPositiveNumberInRange(bet.line, 200, MAX_LINE)) return "bad-line";
  }
  if (kind === "top-finish") {
    if (
      typeof bet.cutoff !== "number" ||
      !VALID_TOP_CUTOFFS.has(bet.cutoff)
    ) {
      return "bad-cutoff";
    }
  }
  return null;
}

/**
 * GET /api/bets — list the signed-in user's bets (active only).
 */
export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ bets: [] });
  }
  // Fetch ALL the user's bets (including removed ones) so we can
  // tell the client which IDs to prune from its localStorage cache.
  // A bet removed on device A leaves a zombie in device B's local
  // store until we explicitly say "drop this id".
  const { data, error } = await supabase
    .from("bets")
    .select("id, kind, data, placed_at, settled_at, settled_won, removed_at")
    .eq("user_id", user.id)
    .order("placed_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const allRows = data ?? [];
  const removedIds = allRows
    .filter((row) => row.removed_at != null)
    .map((row) => row.id as string);
  const bets = allRows
    .filter((row) => row.removed_at == null)
    .map((row) => ({
      ...(row.data as Record<string, unknown>),
      id: row.id,
      kind: row.kind,
      placedAt: new Date(row.placed_at).getTime(),
      // Settlement state from notify-poll. The bet tracker reads these
      // for bets from past tournaments — the client-side detector only
      // works against the active leaderboard, so once the resolver
      // rolls forward it loses sight of "did this PGA bet win?" without
      // these columns.
      settledAt: row.settled_at
        ? new Date(row.settled_at as string).getTime()
        : null,
      settledWon: (row.settled_won as boolean | null) ?? null,
    }));
  return NextResponse.json({ bets, removedIds });
}

/**
 * POST /api/bets — create a bet. Body is the full bet payload as
 * already shaped by the client (id, kind, placedAt, …kind-specific).
 */
export async function POST(req: Request) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  let bet: Record<string, unknown>;
  try {
    bet = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }

  // Per-kind field validation. The bets table stores `data` as JSONB
  // and is read back verbatim in many places (community-backing chip,
  // Sharp Score, share view, PnL chart) — so a malformed POST flows
  // into the rest of the product. Reject anything that doesn't match
  // a realistic bet shape.
  const validationError = validateBet(bet);
  if (validationError) {
    return NextResponse.json(
      { error: "invalid-bet", reason: validationError },
      { status: 400 },
    );
  }
  const id = bet.id as string;
  const kind = bet.kind as string;
  const placedAt = bet.placedAt as number;

  // Strip authorKey out of the JSON blob before persisting — the
  // dedicated bets.author_key column carries the attribution. The
  // public /share/bet view returns row.data verbatim and we don't
  // want the visitor's cookie identity travelling with shared bets.
  const authorKey =
    typeof bet.authorKey === "string" && bet.authorKey.length > 0
      ? bet.authorKey
      : null;
  const { authorKey: _stripped, ...betWithoutAuthor } = bet;
  void _stripped;
  const { error } = await supabase.from("bets").upsert(
    {
      id,
      user_id: user.id,
      kind,
      data: betWithoutAuthor,
      placed_at: new Date(placedAt).toISOString(),
      author_key: authorKey,
    } as never,
    { onConflict: "id" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
