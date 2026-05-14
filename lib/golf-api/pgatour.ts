/**
 * PGA Tour orchestrator GraphQL client.
 *
 * This is the same internal API the official PGA Tour app/site runs on.
 * It gives near-real-time per-hole scores, play-by-play text, and the
 * live leaderboard — far fresher than DataGolf's live model.
 *
 * IMPORTANT: this is an unofficial endpoint. The API key ships in PGA
 * Tour's own web bundle, but they can rotate it or rate-limit. Rules of
 * engagement:
 *   - Poll from ONE server-side cron, never per-user.
 *   - Batch scorecard queries (≤15 players per request).
 *   - Key lives in PGATOUR_API_KEY env var so a rotation is a config
 *     change, not a redeploy. A known-good default is baked in as a
 *     fallback for local dev.
 *   - Every call is wrapped so a failure degrades the feature, never
 *     crashes the request.
 *
 * Server-only.
 */

import "server-only";

const GQL_URL = "https://orchestrator.pgatour.com/graphql";

// Fallback key — same one in PGA Tour's public web bundle. Prefer the
// env var; this default just keeps local dev working.
const DEFAULT_KEY = "da2-gsrx5bibzbb4njvhl7t37wqyl4";

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": process.env.PGATOUR_API_KEY || DEFAULT_KEY,
    "x-pgat-platform": "web",
  };
}

async function gql<T>(query: string): Promise<T | null> {
  try {
    const res = await fetch(GQL_URL, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ query }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[pgatour] ${res.status}: ${await res.text()}`);
      return null;
    }
    const json = (await res.json()) as { data?: T; errors?: unknown };
    if (json.errors) {
      console.error("[pgatour] graphql errors", JSON.stringify(json.errors));
    }
    return json.data ?? null;
  } catch (err) {
    console.error("[pgatour] request failed", err);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────
// Schedule
// ──────────────────────────────────────────────────────────────────

export interface PGATournamentRef {
  /** Tournament id, e.g. "R2026033". */
  id: string;
  name: string;
  startDate: number; // epoch ms
}

interface ScheduleGroup {
  tournaments: { id: string; tournamentName: string; startDate: number }[];
}
interface ScheduleResponse {
  schedule: {
    upcoming: ScheduleGroup[];
    completed: ScheduleGroup[];
  };
}

/** Flat list of all 2026 tournaments (upcoming + completed). */
export async function getSchedule(
  year: string = String(new Date().getUTCFullYear()),
): Promise<{ upcoming: PGATournamentRef[]; completed: PGATournamentRef[] }> {
  const data = await gql<ScheduleResponse>(
    `{ schedule(tourCode: "R", year: "${year}") {
        upcoming { tournaments { id tournamentName startDate } }
        completed { tournaments { id tournamentName startDate } }
    } }`,
  );
  // GraphQL field is `tournamentName`; we normalise it to `name`.
  const flatten = (
    groups: {
      tournaments: { id: string; tournamentName: string; startDate: number }[];
    }[] = [],
  ): PGATournamentRef[] =>
    groups.flatMap((g) =>
      g.tournaments.map((t) => ({
        id: t.id,
        name: t.tournamentName,
        startDate: t.startDate,
      })),
    );
  if (!data?.schedule) return { upcoming: [], completed: [] };
  return {
    upcoming: flatten(data.schedule.upcoming),
    completed: flatten(data.schedule.completed),
  };
}

/**
 * Resolve the tournament we should be showing a live feed for: the
 * one whose window (startDate → startDate + 5 days, generous for
 * Mon finishes) contains "now". Falls back to the next upcoming
 * tournament so the /live page can show a countdown.
 */
export async function getActiveTournament(): Promise<{
  tournament: PGATournamentRef;
  isLive: boolean;
} | null> {
  const { upcoming, completed } = await getSchedule();
  const now = Date.now();
  const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;

  // A tournament is "live" if now is within its 5-day window.
  const all = [...completed, ...upcoming];
  for (const t of all) {
    if (now >= t.startDate && now <= t.startDate + FIVE_DAYS) {
      return { tournament: t, isLive: true };
    }
  }
  // Nothing live — return the soonest upcoming one for a countdown.
  const next = upcoming
    .filter((t) => t.startDate > now)
    .sort((a, b) => a.startDate - b.startDate)[0];
  return next ? { tournament: next, isLive: false } : null;
}

// ──────────────────────────────────────────────────────────────────
// Leaderboard
// ──────────────────────────────────────────────────────────────────

export interface PGALeaderboardRow {
  playerId: string;
  displayName: string;
  position: string; // "1", "T2", "CUT", "--"
  total: string; // to-par overall, e.g. "-7" or "E"
  thru: string; // "12", "F", "7*" (* = started back nine)
  score: string; // today's score to par
  currentRound: number | null;
  playerState: string; // "ACTIVE" | "CUT" | "WD" | "DQ" | "MC" | ...
}

interface LeaderboardResponse {
  leaderboardV2: {
    players: ({
      player?: { id: string; displayName: string };
      position?: string;
      total?: string;
      thru?: string;
      score?: string;
      currentRound?: number;
      playerState?: string;
    } | null)[];
  } | null;
}

export async function getLeaderboard(
  tournamentId: string,
): Promise<PGALeaderboardRow[]> {
  const data = await gql<LeaderboardResponse>(
    `{ leaderboardV2(id: "${tournamentId}") {
        players { ... on PlayerRowV2 {
          position total thru score currentRound playerState
          player { id displayName }
        } }
    } }`,
  );
  const rows = data?.leaderboardV2?.players ?? [];
  return rows
    .filter((r): r is NonNullable<typeof r> => !!r && !!r.player)
    .map((r) => ({
      playerId: r.player!.id,
      displayName: r.player!.displayName,
      position: r.position ?? "--",
      total: r.total ?? "E",
      thru: r.thru ?? "-",
      score: r.score ?? "E",
      currentRound: r.currentRound ?? null,
      playerState: r.playerState ?? "ACTIVE",
    }));
}

// ──────────────────────────────────────────────────────────────────
// Scorecards (per-hole detail + play-by-play)
// ──────────────────────────────────────────────────────────────────

export interface PGAHoleScore {
  holeNumber: number;
  /** "-" while unplayed, otherwise a stroke count string. */
  score: string;
  par: number;
}

export interface PGAScorecard {
  playerId: string;
  currentHole: number | null;
  currentShotDisplay: string | null;
  playByPlay: string | null;
  playerState: string | null;
  /** Per round → per hole. roundScores[3] = round 3's 18 holes. */
  rounds: Record<number, PGAHoleScore[]>;
}

interface ScorecardNode {
  currentHole?: number;
  currentShotDisplay?: string;
  playByPlay?: string;
  playerState?: string;
  roundScores?: {
    roundNumber: number;
    firstNine?: { holes?: { holeNumber: number; score: string; par: number }[] };
    secondNine?: { holes?: { holeNumber: number; score: string; par: number }[] };
  }[];
}

const CHUNK_SIZE = 15;

/**
 * Batch-fetch scorecards for a list of player ids. Chunks of 15 are
 * sent as aliased queries in parallel; failures within a chunk yield
 * empty scorecards rather than throwing.
 */
export async function getScorecards(
  tournamentId: string,
  playerIds: string[],
): Promise<Record<string, PGAScorecard>> {
  if (playerIds.length === 0) return {};

  const chunks: string[][] = [];
  for (let i = 0; i < playerIds.length; i += CHUNK_SIZE) {
    chunks.push(playerIds.slice(i, i + CHUNK_SIZE));
  }

  const fetchChunk = async (
    chunk: string[],
  ): Promise<Record<string, PGAScorecard>> => {
    const aliases = chunk
      .map(
        (pid) =>
          `p${pid}: scorecardV3(tournamentId: "${tournamentId}", playerId: "${pid}") {
             currentHole currentShotDisplay playByPlay playerState
             roundScores {
               roundNumber
               firstNine { holes { holeNumber score par } }
               secondNine { holes { holeNumber score par } }
             }
           }`,
      )
      .join("\n");
    const data = await gql<Record<string, ScorecardNode | null>>(
      `{ ${aliases} }`,
    );
    const out: Record<string, PGAScorecard> = {};
    for (const pid of chunk) {
      const node = data?.[`p${pid}`] ?? null;
      out[pid] = normalizeScorecard(pid, node);
    }
    return out;
  };

  const results = await Promise.all(chunks.map(fetchChunk));
  return Object.assign({}, ...results);
}

// ──────────────────────────────────────────────────────────────────
// Shot details — per-stroke data for disaster detection
// ──────────────────────────────────────────────────────────────────

export interface PGAStroke {
  strokeNumber: number;
  /** "STROKE" | "PENALTY" | "DROP" — drives disaster detection. */
  strokeType: string;
  /** e.g. "OGR" (on green), "OTB" (tee box), "OFW" (fairway), "ORO" (rough). */
  fromLocationCode: string;
  toLocationCode: string;
  /** Display distance of the stroke, e.g. "299 yds" or "50 ft 10 in.". */
  distance: string;
  playByPlay: string;
  /**
   * Enhanced (normalised 0-1) shot coordinates on the hole's
   * left-to-right overhead view. -1 when the orchestrator hasn't
   * captured tracking for this stroke.
   */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface PGAShotHole {
  holeNumber: number;
  par: number;
  score: string;
  strokes: PGAStroke[];
}

interface CoordNode {
  enhancedX?: number;
  enhancedY?: number;
}
interface ShotDetailNode {
  holes?: {
    holeNumber: number;
    par: number;
    score: string;
    strokes?: {
      strokeNumber: number;
      strokeType: string;
      fromLocationCode: string;
      toLocationCode: string;
      distance: string;
      playByPlay: string;
      overview?: {
        leftToRightCoords?: {
          fromCoords?: CoordNode;
          toCoords?: CoordNode;
        };
      };
    }[];
  }[];
}

/**
 * Batch-fetch shot-by-shot detail for a set of (playerId, round) pairs.
 * Used sparingly — only for players who just carded a blow-up — so the
 * extra orchestrator load stays small.
 */
export async function getShotDetailsBatch(
  tournamentId: string,
  requests: { playerId: string; round: number }[],
): Promise<Record<string, PGAShotHole[]>> {
  if (requests.length === 0) return {};

  const chunks: { playerId: string; round: number }[][] = [];
  for (let i = 0; i < requests.length; i += CHUNK_SIZE) {
    chunks.push(requests.slice(i, i + CHUNK_SIZE));
  }

  const fetchChunk = async (
    chunk: { playerId: string; round: number }[],
  ): Promise<Record<string, PGAShotHole[]>> => {
    const aliases = chunk
      .map(
        ({ playerId, round }) =>
          `s${playerId}_${round}: shotDetailsV3(tournamentId: "${tournamentId}", playerId: "${playerId}", round: ${round}) {
             holes {
               holeNumber par score
               strokes {
                 strokeNumber strokeType fromLocationCode toLocationCode
                 distance playByPlay
                 overview {
                   leftToRightCoords {
                     fromCoords { enhancedX enhancedY }
                     toCoords { enhancedX enhancedY }
                   }
                 }
               }
             }
           }`,
      )
      .join("\n");
    const data = await gql<Record<string, ShotDetailNode | null>>(
      `{ ${aliases} }`,
    );
    const out: Record<string, PGAShotHole[]> = {};
    for (const { playerId, round } of chunk) {
      const node = data?.[`s${playerId}_${round}`] ?? null;
      out[`${playerId}:${round}`] = (node?.holes ?? []).map((h) => ({
        holeNumber: h.holeNumber,
        par: h.par,
        score: h.score,
        strokes: (h.strokes ?? []).map((s) => {
          const ltr = s.overview?.leftToRightCoords;
          return {
            strokeNumber: s.strokeNumber,
            strokeType: s.strokeType,
            fromLocationCode: s.fromLocationCode,
            toLocationCode: s.toLocationCode,
            distance: s.distance,
            playByPlay: s.playByPlay,
            fromX: ltr?.fromCoords?.enhancedX ?? -1,
            fromY: ltr?.fromCoords?.enhancedY ?? -1,
            toX: ltr?.toCoords?.enhancedX ?? -1,
            toY: ltr?.toCoords?.enhancedY ?? -1,
          };
        }),
      }));
    }
    return out;
  };

  const results = await Promise.all(chunks.map(fetchChunk));
  return Object.assign({}, ...results);
}

function normalizeScorecard(
  playerId: string,
  node: ScorecardNode | null,
): PGAScorecard {
  const rounds: Record<number, PGAHoleScore[]> = {};
  for (const rs of node?.roundScores ?? []) {
    const holes: PGAHoleScore[] = [];
    for (const nine of [rs.firstNine, rs.secondNine]) {
      for (const h of nine?.holes ?? []) {
        holes.push({
          holeNumber: h.holeNumber,
          score: h.score,
          par: h.par,
        });
      }
    }
    holes.sort((a, b) => a.holeNumber - b.holeNumber);
    rounds[rs.roundNumber] = holes;
  }
  return {
    playerId,
    currentHole: node?.currentHole ?? null,
    currentShotDisplay: node?.currentShotDisplay ?? null,
    playByPlay: node?.playByPlay ?? null,
    playerState: node?.playerState ?? null,
    rounds,
  };
}
