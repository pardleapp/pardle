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
import { getCachedLeaderboard } from "@/lib/feed/store";

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

const TOURNAMENT_INACTIVE_STATES = new Set([
  "CUT",
  "MC",
  "WD",
  "DQ",
  "DNS",
  "COMPLETE",
  "FINISHED",
]);

/** "Concluded" = the cached leaderboard exists AND every player is
 *  either at thru="F" or has a terminal playerState. We use this to
 *  roll forward to the next tournament when one in its schedule
 *  window has actually wrapped up — the PGA Tour schedule can lag
 *  by a day or two moving a tournament from upcoming → completed,
 *  so the 5-day window alone keeps a finished event "live" for
 *  longer than we want. */
async function isTournamentConcluded(
  tournamentId: string,
  startDate: number,
): Promise<boolean> {
  // A four-round PGA Tour event can't be over until late Sunday at
  // the earliest — even a Thursday-morning start with every R1
  // finisher showing thru="F" is a between-rounds gap, not the end
  // of the tournament. Require at least 80 hours since startDate
  // before trusting the leaderboard's all-F signal as "concluded".
  // 80h covers normal Thu→Sun finishes; weather-shortened events
  // are rare enough that we'd rather over-include than over-exclude.
  const MIN_ELAPSED_MS = 80 * 60 * 60 * 1000;
  if (Date.now() - startDate < MIN_ELAPSED_MS) return false;

  const lb = await getCachedLeaderboard(tournamentId).catch(() => []);
  if (lb.length === 0) return false;
  return lb.every((r) => {
    if (TOURNAMENT_INACTIVE_STATES.has(r.playerState)) return true;
    return r.thru === "F" || r.thru === "—";
  });
}

/**
 * Resolve the tournament we should be showing a live feed for: the
 * one whose window (startDate → startDate + 5 days, generous for
 * Mon finishes) contains "now" AND that hasn't already fully wrapped
 * up on the leaderboard. Falls back to the next upcoming tournament
 * so the page can show a countdown.
 */
export async function getActiveTournament(): Promise<{
  tournament: PGATournamentRef;
  isLive: boolean;
} | null> {
  const { upcoming, completed } = await getSchedule();
  const now = Date.now();
  const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;

  // Walk all tournaments whose window contains "now", oldest start
  // first, and return the first that isn't already concluded on
  // the leaderboard.
  const inWindow = [...completed, ...upcoming]
    .filter((t) => now >= t.startDate && now <= t.startDate + FIVE_DAYS)
    .sort((a, b) => a.startDate - b.startDate);
  for (const t of inWindow) {
    const concluded = await isTournamentConcluded(t.id, t.startDate);
    if (!concluded) {
      return { tournament: t, isLive: true };
    }
  }

  // Nothing live (or everything in-window has concluded) — return
  // the soonest upcoming for a countdown.
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
// Shot-detail queries carry per-stroke coordinates (now two sets each:
// full-hole + zoomed-green), so each player's payload is far larger
// than a plain scorecard. Keep these chunks small so the response
// stays well under the serverless runtime's limits.
const SHOT_CHUNK_SIZE = 3;

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

/**
 * Replace the orchestrator's default `w_1500` Cloudinary transform
 * with a wider one so the hole-diagram backdrop stays crisp when a
 * user pinches in on the modal tracer. Pure URL rewrite — no extra
 * API calls. Cloudinary serves f_auto/q_auto so the byte cost is
 * modest (~300KB at w_4000 vs ~70KB at w_1500).
 */
function upscalePickle(url: string): string {
  if (!url || !url.includes("pga-tour-res.cloudinary.com")) return url;
  return url.replace(/(^|[,/])w_\d+([,/])/, "$1w_4000$2");
}

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
  /**
   * Same, but on the *zoomed-green* overhead view. Only on-green shots
   * (putts, the approach that landed) fall inside 0-1 here — off-green
   * shots come back out of range and are dropped by the tracer.
   */
  greenFromX: number;
  greenFromY: number;
  greenToX: number;
  greenToY: number;
}

export interface PGAShotHole {
  holeNumber: number;
  par: number;
  score: string;
  strokes: PGAStroke[];
  /**
   * PGA Tour "TourCast Pickle" overhead hole-diagram image URL — the
   * enhanced left-to-right view that the enhanced shot coords map onto.
   * Empty string when unavailable.
   */
  holeImage: string;
  /** Zoomed-green version of the same diagram — used for putt traces. */
  greenImage: string;
}

interface CoordNode {
  enhancedX?: number;
  enhancedY?: number;
}
interface CoordWrapNode {
  leftToRightCoords?: {
    fromCoords?: CoordNode;
    toCoords?: CoordNode;
  };
}
interface ShotDetailNode {
  holes?: {
    holeNumber: number;
    par: number;
    score: string;
    enhancedPickle?: {
      leftToRight?: string | null;
      greenLeftToRight?: string | null;
    };
    strokes?: {
      strokeNumber: number;
      strokeType: string;
      fromLocationCode: string;
      toLocationCode: string;
      distance: string;
      playByPlay: string;
      overview?: CoordWrapNode;
      green?: CoordWrapNode;
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
  for (let i = 0; i < requests.length; i += SHOT_CHUNK_SIZE) {
    chunks.push(requests.slice(i, i + SHOT_CHUNK_SIZE));
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
               enhancedPickle { leftToRight greenLeftToRight }
               strokes {
                 strokeNumber strokeType fromLocationCode toLocationCode
                 distance playByPlay
                 overview {
                   leftToRightCoords {
                     fromCoords { enhancedX enhancedY }
                     toCoords { enhancedX enhancedY }
                   }
                 }
                 green {
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
        holeImage: upscalePickle(h.enhancedPickle?.leftToRight ?? ""),
        greenImage: upscalePickle(h.enhancedPickle?.greenLeftToRight ?? ""),
        strokes: (h.strokes ?? []).map((s) => {
          const ltr = s.overview?.leftToRightCoords;
          const grn = s.green?.leftToRightCoords;
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
            greenFromX: grn?.fromCoords?.enhancedX ?? -1,
            greenFromY: grn?.fromCoords?.enhancedY ?? -1,
            greenToX: grn?.toCoords?.enhancedX ?? -1,
            greenToY: grn?.toCoords?.enhancedY ?? -1,
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

// ──────────────────────────────────────────────────────────────────
// Pin sheet — per-round pin coordinates + green diagram image
// ──────────────────────────────────────────────────────────────────

/** Normalised (0-1) coordinates of a pin on the paired green diagram
 *  image. `enhancedX/Y` is the refined tracer value; `x/y` is the raw
 *  fallback for the odd hole where enhanced isn't populated. */
export interface PinCoord {
  x: number;
  y: number;
}

/** Field scoring for one hole in one round. */
export interface HoleScoringSummary {
  /** Field average strokes on the hole (e.g. 3.87). */
  avg: number | null;
  /** Signed vs-par (avg − par), e.g. −0.13. */
  vsPar: number | null;
}

/** Pin sheet for one hole across the tournament. `greenImageUrl` is
 *  the Cloudinary raster that pin coords are normalised against — the
 *  same asset the shot tracer uses. `pinByRound` is keyed 1-4; a hole
 *  might miss a round if PGA Tour hasn't posted it yet. */
export interface CoursePinHole {
  holeNumber: number;
  par: number | null;
  yards: number | null;
  greenImageUrl: string;
  pinByRound: Record<number, PinCoord>;
  /** Per-round scoring average + vs-par. Keys match pinByRound
   *  (1-4). Rounds not yet played will be missing. */
  scoringByRound: Record<number, HoleScoringSummary>;
}

export interface CoursePinSheet {
  tournamentId: string;
  courseName: string;
  holes: CoursePinHole[];
}

interface CourseStatsCoords {
  enhancedX?: number | null;
  enhancedY?: number | null;
  x?: number | null;
  y?: number | null;
}
interface CourseStatsHoleStats {
  /** Confirmed via introspection: CourseHoleStats.courseHoleNum
   *  (Int, non-null). Neither `hole` nor `holeNumber` exists on this
   *  type — those live on scorecard types. */
  courseHoleNum?: number;
  /** parValue is String on this type (not Int). Parse it to a number. */
  parValue?: string;
  yards?: number;
  /** Field scoring average for this (round, hole). String like "3.845". */
  scoringAverage?: string;
  /** Scoring average vs par, signed string like "+0.15" or "-0.42". */
  scoringAverageDiff?: string;
  pinGreen?: {
    leftToRightCoords?: CourseStatsCoords | null;
  } | null;
  holePickle?: {
    greenLeftToRight?: string | null;
  } | null;
}
interface CourseStatsRoundHole {
  roundNum?: number;
  holeStats?: (CourseStatsHoleStats | null)[];
}
interface CourseStatsCourse {
  id?: string;
  courseName?: string;
  roundHoleStats?: (CourseStatsRoundHole | null)[];
}
interface CourseStatsResp {
  courseStats?: {
    courses?: (CourseStatsCourse | null)[];
  } | null;
}

/** Same as getCoursePins, but returns the raw orchestrator payload
 *  alongside so the API layer can surface diagnostic info when the
 *  parsed sheet is empty. Never throws — errors are captured.
 *
 *  Inlines the fetch (rather than going through gql<T>) so that
 *  GraphQL errors + non-200 bodies are visible in the response,
 *  not silently swallowed. */
export async function getCoursePinsWithDiag(
  tournamentId: string,
): Promise<{ sheet: CoursePinSheet | null; raw: unknown; error?: string }> {
  const query = `{
    courseStats(tournamentId: "${tournamentId}") {
      courses {
        roundHoleStats {
          roundNum
          holeStats {
            ... on CourseHoleStats {
              courseHoleNum
              parValue
              yards
              scoringAverage
              scoringAverageDiff
              pinGreen {
                leftToRightCoords {
                  x
                  y
                  enhancedX
                  enhancedY
                }
              }
              holePickle {
                greenLeftToRight
              }
            }
          }
        }
      }
    }
  }`;
  let raw: unknown = null;
  let error: string | undefined;
  try {
    const res = await fetch(GQL_URL, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ query }),
      cache: "no-store",
    });
    const text = await res.text();
    try {
      raw = JSON.parse(text);
    } catch {
      raw = { httpStatus: res.status, body: text.slice(0, 800) };
    }
    if (!res.ok) error = `http ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : "fetch failed";
  }
  const data =
    typeof raw === "object" && raw != null && "data" in raw
      ? ((raw as { data: CourseStatsResp | null }).data ?? null)
      : null;
  const sheet = parseCoursePinsPayload(tournamentId, data);
  return { sheet, raw, error };
}

function parseCoursePinsPayload(
  tournamentId: string,
  raw: CourseStatsResp | null,
): CoursePinSheet | null {
  const courses = raw?.courseStats?.courses ?? [];
  if (courses.length === 0) return null;
  const primary = courses[0];
  if (!primary) return null;

  const holeMap = new Map<number, CoursePinHole>();
  for (const rh of primary.roundHoleStats ?? []) {
    const round = rh?.roundNum;
    if (typeof round !== "number") continue;
    for (const hs of rh?.holeStats ?? []) {
      if (!hs) continue;
      const holeNum = hs.courseHoleNum;
      if (typeof holeNum !== "number") continue;
      const coords = hs.pinGreen?.leftToRightCoords;
      const x = coords?.enhancedX ?? coords?.x;
      const y = coords?.enhancedY ?? coords?.y;
      const img = hs.holePickle?.greenLeftToRight ?? "";
      const parNum =
        typeof hs.parValue === "string" && hs.parValue
          ? Number.parseInt(hs.parValue, 10)
          : null;
      const existing = holeMap.get(holeNum);
      const target: CoursePinHole = existing ?? {
        holeNumber: holeNum,
        par: Number.isFinite(parNum) ? (parNum as number) : null,
        yards: typeof hs.yards === "number" ? hs.yards : null,
        greenImageUrl: upscalePickle(img),
        pinByRound: {},
        scoringByRound: {},
      };
      if (!target.greenImageUrl && img) target.greenImageUrl = upscalePickle(img);
      if (target.par == null && Number.isFinite(parNum)) target.par = parNum;
      if (target.yards == null && typeof hs.yards === "number") target.yards = hs.yards;
      if (
        typeof x === "number" &&
        typeof y === "number" &&
        x >= 0 &&
        y >= 0
      ) {
        target.pinByRound[round] = { x, y };
      }
      // Per-round scoring — comes as strings on this type. Parse
      // defensively; "0" (all pars) is still valid.
      const avgStr = hs.scoringAverage;
      const diffStr = hs.scoringAverageDiff;
      const avgNum =
        typeof avgStr === "string" && avgStr.trim()
          ? Number.parseFloat(avgStr)
          : NaN;
      const diffNum =
        typeof diffStr === "string" && diffStr.trim()
          ? Number.parseFloat(diffStr)
          : NaN;
      if (Number.isFinite(avgNum) || Number.isFinite(diffNum)) {
        target.scoringByRound[round] = {
          avg: Number.isFinite(avgNum) ? avgNum : null,
          vsPar: Number.isFinite(diffNum) ? diffNum : null,
        };
      }
      holeMap.set(holeNum, target);
    }
  }
  const holes = [...holeMap.values()].sort((a, b) => a.holeNumber - b.holeNumber);
  return { tournamentId, courseName: "", holes };
}

/** Pull pin positions for every (hole, round) in a tournament. One
 *  query, one caller — merge on the client (or in the /api layer)
 *  since PGA Tour returns the whole table in one shot. */
export async function getCoursePins(
  tournamentId: string,
): Promise<CoursePinSheet | null> {
  // Minimal query — only fields the schema recon confirmed. Adding
  // parValue/yards/courseName earlier caused the whole query to be
  // rejected (courseStats returned null). Par + yards are cosmetic
  // for the modal; not worth breaking pin lookup for.
  const data = await gql<CourseStatsResp>(`{
    courseStats(tournamentId: "${tournamentId}") {
      courses {
        roundHoleStats {
          roundNum
          holeStats {
            ... on CourseHoleStats {
              courseHoleNum
              parValue
              yards
              scoringAverage
              scoringAverageDiff
              pinGreen {
                leftToRightCoords {
                  x
                  y
                  enhancedX
                  enhancedY
                }
              }
              holePickle {
                greenLeftToRight
              }
            }
          }
        }
      }
    }
  }`);
  const courses = data?.courseStats?.courses ?? [];
  if (courses.length === 0) return null;
  // Multi-course events (rare — 3M, WMPO — one venue) still return
  // an array. Take the first course; if a tournament ever splits
  // rounds across venues we'll handle that when it comes up.
  const primary = courses[0];
  if (!primary) return null;

  const holeMap = new Map<number, CoursePinHole>();
  for (const rh of primary.roundHoleStats ?? []) {
    const round = rh?.roundNum;
    if (typeof round !== "number") continue;
    for (const hs of rh?.holeStats ?? []) {
      if (!hs) continue;
      const holeNum = hs.courseHoleNum;
      if (typeof holeNum !== "number") continue;
      const coords = hs.pinGreen?.leftToRightCoords;
      const x = coords?.enhancedX ?? coords?.x;
      const y = coords?.enhancedY ?? coords?.y;
      const img = hs.holePickle?.greenLeftToRight ?? "";
      // parValue is a String on this type — parse it to number.
      const parNum =
        typeof hs.parValue === "string" && hs.parValue
          ? Number.parseInt(hs.parValue, 10)
          : null;
      const existing = holeMap.get(holeNum);
      const target: CoursePinHole =
        existing ?? {
          holeNumber: holeNum,
          par: Number.isFinite(parNum) ? (parNum as number) : null,
          yards: typeof hs.yards === "number" ? hs.yards : null,
          greenImageUrl: upscalePickle(img),
          pinByRound: {},
          scoringByRound: {},
        };
      if (!target.greenImageUrl && img) target.greenImageUrl = upscalePickle(img);
      if (target.par == null && Number.isFinite(parNum)) target.par = parNum;
      if (target.yards == null && typeof hs.yards === "number") target.yards = hs.yards;
      if (
        typeof x === "number" &&
        typeof y === "number" &&
        x >= 0 &&
        y >= 0
      ) {
        target.pinByRound[round] = { x, y };
      }
      const avgStr = hs.scoringAverage;
      const diffStr = hs.scoringAverageDiff;
      const avgNum =
        typeof avgStr === "string" && avgStr.trim()
          ? Number.parseFloat(avgStr)
          : NaN;
      const diffNum =
        typeof diffStr === "string" && diffStr.trim()
          ? Number.parseFloat(diffStr)
          : NaN;
      if (Number.isFinite(avgNum) || Number.isFinite(diffNum)) {
        target.scoringByRound[round] = {
          avg: Number.isFinite(avgNum) ? avgNum : null,
          vsPar: Number.isFinite(diffNum) ? diffNum : null,
        };
      }
      holeMap.set(holeNum, target);
    }
  }
  const holes = [...holeMap.values()].sort((a, b) => a.holeNumber - b.holeNumber);
  return {
    tournamentId,
    courseName: primary.courseName ?? "",
    holes,
  };
}

// ──────────────────────────────────────────────────────────────────
// Tournament putt sheet — aggregate every on-green stroke across a
// slice of the field × every round, for the green-diagram contour
// overlay. Each putt gives us a `from → to` vector on the zoomed
// green view; stacking hundreds reveals slope direction without any
// paid contour data.
// ──────────────────────────────────────────────────────────────────

export interface HolePutt {
  round: number;
  playerId: string;
  /** Normalised 0-1 start position on the zoomed-green diagram. */
  x1: number;
  y1: number;
  /** End position — where the putt finished / went in the hole. */
  x2: number;
  y2: number;
  /** True when the putt was holed. Derived from
   *  toLocationCode === "OHL" (in the hole). */
  made: boolean;
  /** Distance of the putt in feet, parsed from the display string
   *  ("12 ft 4 in." etc). Null when un-parseable. */
  distanceFt: number | null;
  strokeNumber: number;
}

export interface TournamentPuttSheet {
  tournamentId: string;
  /** Requested cap on how many players we fetched (top N of the
   *  leaderboard). */
  playersRequested: number;
  /** Actual player-round bundles returned with putt data. */
  playerRoundsReturned: number;
  /** Green-diagram image URL keyed by hole — same asset as the
   *  shot tracer uses. When empty, fall back to the pin sheet's
   *  greenImageUrl. */
  greenImageByHole: Record<number, string>;
  /** All putts on the tournament grouped by hole number. */
  puttsByHole: Record<number, HolePutt[]>;
}

/** Parse a distance string ("12 ft 4 in.", "3 ft") into feet. */
function parseDistanceFt(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  const ft = t.match(/(\d+(?:\.\d+)?)\s*ft/i);
  const inch = t.match(/(\d+(?:\.\d+)?)\s*in/i);
  const feet = ft ? Number(ft[1]) : 0;
  const inches = inch ? Number(inch[1]) : 0;
  if (feet === 0 && inches === 0) return null;
  return feet + inches / 12;
}

/** Pull every putt on the course for a tournament — batched across
 *  top-N players of the current leaderboard, then filtered to
 *  strokes taken from the green. Data is bulky (thousands of putts)
 *  but travels well as JSON and gets Redis-cached upstream. */
export async function getTournamentPutts(
  tournamentId: string,
  playerLimit: number = 60,
): Promise<TournamentPuttSheet> {
  const leaderboard = await getLeaderboard(tournamentId);
  const players = leaderboard.slice(0, playerLimit).map((p) => p.playerId);

  // Fan out every (player, round) that could have data. shotDetailsV3
  // silently returns null for players who missed the cut / didn't
  // start a round; we tolerate that.
  const requests: { playerId: string; round: number }[] = [];
  for (const pid of players) {
    for (let r = 1; r <= 4; r++) requests.push({ playerId: pid, round: r });
  }
  const shotData = await getShotDetailsBatch(tournamentId, requests);

  const puttsByHole: Record<number, HolePutt[]> = {};
  const greenImageByHole: Record<number, string> = {};
  let playerRoundsReturned = 0;
  for (const [key, holes] of Object.entries(shotData)) {
    if (!holes || holes.length === 0) continue;
    playerRoundsReturned++;
    const [playerId, roundStr] = key.split(":");
    const round = Number(roundStr);
    if (!Number.isFinite(round)) continue;
    for (const hole of holes) {
      const holeNum = hole.holeNumber;
      if (typeof holeNum !== "number") continue;
      if (!greenImageByHole[holeNum] && hole.greenImage) {
        greenImageByHole[holeNum] = hole.greenImage;
      }
      for (const stroke of hole.strokes ?? []) {
        // Only on-green strokes (putts). Guard against penalty /
        // drop strokes with no coords.
        if (stroke.fromLocationCode !== "OGR") continue;
        if (stroke.strokeType && stroke.strokeType !== "STROKE") continue;
        const x1 = stroke.greenFromX;
        const y1 = stroke.greenFromY;
        const x2 = stroke.greenToX;
        const y2 = stroke.greenToY;
        // -1 sentinel used when the orchestrator didn't capture
        // green coords for this stroke.
        if (
          !Number.isFinite(x1) ||
          !Number.isFinite(y1) ||
          !Number.isFinite(x2) ||
          !Number.isFinite(y2) ||
          x1 < 0 ||
          y1 < 0 ||
          x2 < 0 ||
          y2 < 0
        ) {
          continue;
        }
        const putt: HolePutt = {
          round,
          playerId,
          x1,
          y1,
          x2,
          y2,
          // toLocationCode "OHL" = in the hole. Occasionally spelled
          // "HOL" in older feeds; check both.
          made:
            stroke.toLocationCode === "OHL" || stroke.toLocationCode === "HOL",
          distanceFt: parseDistanceFt(stroke.distance),
          strokeNumber: stroke.strokeNumber,
        };
        if (!puttsByHole[holeNum]) puttsByHole[holeNum] = [];
        puttsByHole[holeNum].push(putt);
      }
    }
  }

  return {
    tournamentId,
    playersRequested: playerLimit,
    playerRoundsReturned,
    greenImageByHole,
    puttsByHole,
  };
}
