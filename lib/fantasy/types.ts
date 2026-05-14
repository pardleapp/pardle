/**
 * Fantasy Golf — shared TypeScript types.
 *
 * One row per entity, kept flat for easy serialization to Upstash
 * Redis JSON values. IDs are short, URL-safe strings.
 *
 * High-level relationships:
 *   Tournament  1—N  RoundScore (per golfer per round)
 *   League      N—1  Tournament
 *   League      1—N  Membership  (capped at MAX_LEAGUE_MEMBERS)
 *   Membership  1—N  Pick        (a list of golferIds, length = league.pickCount)
 *   User        1—N  Membership
 */

export const MAX_LEAGUE_MEMBERS = 10;
export const DEFAULT_PICK_COUNT = 6;
export const LEAGUE_ID_LENGTH = 8;
export const INVITE_CODE_LENGTH = 6;

/** Golfer participating in the live tournament. Pulled from DataGolf. */
export interface FieldGolfer {
  /** DataGolf player id (numeric, stringified). */
  dgId: string;
  /** Display name "First Last". */
  name: string;
  /** ISO country code or three-letter (e.g. "USA", "ESP"). */
  country?: string;
  /** Pre-tournament world ranking, if available. */
  owgr?: number;
  /** Pre-tournament odds-implied skill rank within this field (1 = best). */
  fieldRank?: number;
}

export type TournamentStatus =
  | "scheduled" // not yet underway
  | "live" // any round in progress
  | "between-rounds" // rounds finished but more to come
  | "completed";

export type RoundStatus =
  | "scheduled"
  | "live"
  | "completed";

/**
 * Per-golfer per-round scoring detail. Sourced from DataGolf live stats.
 * `position` is final position after the round; null while in progress.
 */
export interface GolferRoundScore {
  dgId: string;
  round: 1 | 2 | 3 | 4;
  strokes: number | null; // null if WD/MC and didn't tee off
  toPar: number | null;
  /** Hole-level counts; we use these for fantasy scoring. */
  birdies: number;
  eagles: number;
  doubleEagles: number; // albatross
  bogeys: number;
  doubles: number; // includes worse (triple+ counted as one double for simplicity)
  /** True after R2 cut if applied and golfer missed. */
  missedCut?: boolean;
  /** Withdrawn / disqualified. */
  wd?: boolean;
  /** Final position to par after this round (cumulative). */
  positionAfter?: number | null;
}

export interface Tournament {
  id: string; // slug, e.g. "pga-championship-2026"
  name: string;
  course: string;
  startDate: string; // ISO date "YYYY-MM-DD" — first tee time R1 in venue tz
  endDate: string;
  status: TournamentStatus;
  /** Round-level status flags. */
  rounds: Record<1 | 2 | 3 | 4, RoundStatus>;
  /** DataGolf event id, used to pull live stats. */
  dgEventId: number;
  field: FieldGolfer[];
  cutLineToPar?: number | null;
  /** Round score lookup: scores[`${dgId}:${round}`] */
  scores: Record<string, GolferRoundScore>;
  updatedAt: number; // epoch ms
}

/**
 * A user account. After magic-link auth `email` is set; before that
 * we identify by anonymous cookie id. We never persist an email-only
 * user — a User row exists only once magic-link verification succeeds.
 */
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: number;
}

/**
 * One person's slot in one league. We store picks inside the membership
 * so leaderboards can be computed without joins.
 */
export interface Membership {
  leagueId: string;
  userId: string;
  displayName: string; // can override User.name per-league
  joinedAt: number;
  /** Drafted/picked golfer dgIds. Empty until picks lock. */
  picks: string[];
  /** Set once the user has locked their picks (before R1 tee-off). */
  picksLockedAt: number | null;
  /** Snake-draft order assigned at league lock; null if async picks. */
  draftPosition: number | null;
}

export type DraftMode = "async" | "snake";

export interface ScoringRules {
  /** Per-event point values. */
  eagle: number;
  birdie: number;
  par: number;
  bogey: number;
  double: number;
  albatross: number;
  /** Finish-position bonus (applied once tournament completes). */
  winBonus: number;
  top5Bonus: number;
  top10Bonus: number;
  top25Bonus: number;
  madeCutBonus: number;
  missedCutPenalty: number;
}

export const DEFAULT_SCORING: ScoringRules = {
  eagle: 8,
  birdie: 3,
  par: 0.5,
  bogey: -1,
  double: -3,
  albatross: 20,
  winBonus: 30,
  top5Bonus: 15,
  top10Bonus: 8,
  top25Bonus: 3,
  madeCutBonus: 2,
  missedCutPenalty: -5,
};

export type LeagueStatus =
  | "draft" // members joining, picks open
  | "locked" // picks locked, tournament not started or in progress
  | "completed";

export interface League {
  id: string;
  name: string;
  createdByUserId: string;
  createdAt: number;
  tournamentId: string;
  inviteCode: string; // human-shareable, e.g. "ASTRAL"
  draftMode: DraftMode;
  pickCount: number;
  scoring: ScoringRules;
  status: LeagueStatus;
  memberIds: string[]; // cap MAX_LEAGUE_MEMBERS
}

/** Computed at request time, not persisted. */
export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  totalPoints: number;
  /** Per-pick breakdown for the expanded row view. */
  pickBreakdown: {
    dgId: string;
    name: string;
    points: number;
    cutStatus: "made" | "missed" | "unknown";
  }[];
  rank: number;
}
