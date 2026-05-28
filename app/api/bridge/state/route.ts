import { NextResponse } from "next/server";
import {
  getActiveTournament,
  getLeaderboard,
  getSchedule,
} from "@/lib/golf-api/pgatour";
import { getEvents } from "@/lib/feed/store";
import {
  getPuttPollBulk,
  type PuttPoll,
} from "@/lib/feed/putt-polls";

/**
 * GET /api/bridge/state[?players=name1,name2,...]
 *
 * Lightweight state probe used by the post-puzzle bridge card on
 * /pros, /holes, and /faces. Returns whatever's most engagement-
 * compelling in the next 30 seconds:
 *
 *   - Open putt poll → "Call Scheffler's 12-footer on 8 →"
 *   - Players-the-user-just-knew on the leaderboard → "Rory is
 *     T3 thru 11 — see his round →"
 *   - Live tournament (no specific hook) → "Live: The Open R2 →"
 *   - Pre-tournament (≤3 days out) → "Tees off in 2 days →"
 *   - Off-week → null (caller falls back to /sharp invite)
 *
 * Cached at the edge for 20s so a million puzzle wins per minute
 * don't melt the orchestrator. State changes slowly relative to
 * the cadence puzzle wins fire at.
 */
export const dynamic = "force-dynamic";
export const revalidate = 20;

interface BridgeOpenPoll {
  pollId: string;
  playerId: string;
  playerName: string;
  holeNum: number;
  puttFor: "birdie" | "eagle" | "par save" | "the hole";
  puttDistanceFt: number | null;
}

interface BridgeActivePlayer {
  playerId: string;
  name: string;
  position: string;
  total: string;
  thru: string;
}

export interface BridgeStateResponse {
  isLive: boolean;
  tournament: { id: string; name: string } | null;
  daysToNextEvent: number | null;
  openPoll: BridgeOpenPoll | null;
  activePlayers: BridgeActivePlayer[];
}

const EMPTY: BridgeStateResponse = {
  isLive: false,
  tournament: null,
  daysToNextEvent: null,
  openPoll: null,
  activePlayers: [],
};

/** Lower-case, strip non-alnum so "S. Scheffler" matches
 *  "Scottie Scheffler" via shared lastname tokens. */
function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

/** Does the user's puzzle answer (e.g. "Rory McIlroy") meaningfully
 *  match a leaderboard display name (e.g. "R. McIlroy")? We accept
 *  any shared lastname token of length ≥ 4 — short enough to handle
 *  single-name pros (Kim, Im) without exploding into false positives
 *  via accidental short-word overlap. */
function namesMatch(puzzleName: string, lbName: string): boolean {
  const a = normaliseName(puzzleName).split(/\s+/).filter(Boolean);
  const b = normaliseName(lbName).split(/\s+/).filter(Boolean);
  if (a.length === 0 || b.length === 0) return false;
  // Last token (surname) match is the strongest signal.
  const aLast = a[a.length - 1];
  const bLast = b[b.length - 1];
  if (aLast.length >= 3 && aLast === bLast) return true;
  // Fallback: any shared token >= 4 chars (handles "Min Woo Lee" vs
  // "M.W. Lee" where lastnames match too — covered above — but also
  // any unusual middle-name surface).
  for (const t of a) {
    if (t.length < 4) continue;
    if (b.includes(t)) return true;
  }
  return false;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const playerNames = (url.searchParams.get("players") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 12); // cap at the daily-Faces count

  let tournamentId: string | null = null;
  let isLive = false;
  let tournamentName: string | null = null;
  let daysToNextEvent: number | null = null;

  try {
    const active = await getActiveTournament();
    if (active?.isLive) {
      tournamentId = active.tournament.id;
      tournamentName = active.tournament.name;
      isLive = true;
    } else if (active) {
      // Upcoming on the schedule but not yet teed off.
      tournamentName = active.tournament.name;
      tournamentId = active.tournament.id;
      const days = Math.ceil(
        (active.tournament.startDate - Date.now()) / 86_400_000,
      );
      daysToNextEvent = Math.max(0, days);
    } else {
      // No window-of-now event AND no upcoming → fall back to
      // schedule lookup for the next one.
      const { upcoming } = await getSchedule().catch(() => ({
        upcoming: [],
      }));
      const next = upcoming
        .filter((t) => t.startDate > Date.now())
        .sort((a, b) => a.startDate - b.startDate)[0];
      if (next) {
        tournamentName = next.name;
        tournamentId = next.id;
        daysToNextEvent = Math.max(
          0,
          Math.ceil((next.startDate - Date.now()) / 86_400_000),
        );
      }
    }
  } catch {
    return NextResponse.json(EMPTY);
  }

  if (!tournamentId) {
    return NextResponse.json(EMPTY);
  }

  // For live tournaments only: dig for an open putt poll + match
  // requested player names against the leaderboard.
  let openPoll: BridgeOpenPoll | null = null;
  let activePlayers: BridgeActivePlayer[] = [];

  if (isLive) {
    try {
      const [events, leaderboard] = await Promise.all([
        getEvents(tournamentId, 60).catch(() => []),
        getLeaderboard(tournamentId).catch(() => []),
      ]);

      // Most-recent putt-poll event with an associated pollId — that
      // tells us a poll exists. We then check Redis for its open
      // state (closedAt == null) before promoting it.
      const candidatePollEvents = events
        .filter((e) => e.type === "putt-poll" && e.pollId)
        .slice(0, 5);
      if (candidatePollEvents.length > 0) {
        const polls = await getPuttPollBulk(
          candidatePollEvents.map((e) => e.pollId!),
        );
        for (const ev of candidatePollEvents) {
          const p = polls[ev.pollId!];
          if (!p) continue;
          const poll = p.poll as PuttPoll;
          if (poll.closedAt != null) continue;
          openPoll = {
            pollId: ev.pollId!,
            playerId: ev.playerId,
            playerName: ev.playerName,
            holeNum: ev.hole ?? 0,
            puttFor: ev.puttFor ?? "the hole",
            puttDistanceFt:
              typeof ev.puttDistanceFt === "number"
                ? ev.puttDistanceFt
                : null,
          };
          break;
        }
      }

      if (playerNames.length > 0) {
        for (const requested of playerNames) {
          const match = leaderboard.find((r) =>
            namesMatch(requested, r.displayName),
          );
          if (match) {
            activePlayers.push({
              playerId: match.playerId,
              name: match.displayName,
              position: match.position,
              total: match.total,
              thru: match.thru,
            });
          }
        }
        // Cap at 5 — the bridge card can't fit more than a few
        // chips on mobile, and "5 of your 12 faces are in the field"
        // is a richer hook than a 12-player dump.
        activePlayers = activePlayers.slice(0, 5);
      }
    } catch {
      // Fall through — return what we have.
    }
  }

  const body: BridgeStateResponse = {
    isLive,
    tournament:
      tournamentId && tournamentName
        ? { id: tournamentId, name: tournamentName }
        : null,
    daysToNextEvent,
    openPoll,
    activePlayers,
  };

  return NextResponse.json(body);
}
