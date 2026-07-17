"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { Burst, CachedLeaderboardRow } from "@/lib/feed/store";
import type { FeedRow } from "@/lib/feed/types";
import {
  buildSmartImpactSet,
  isMaterialEvent,
} from "@/lib/feed/smart-filter";
import { buildHotFilterCtx, isHotEvent } from "@/lib/feed/hot-filter";
import {
  DEFAULT_ODDS_FORMAT,
  formatOdds,
  ODDS_FORMAT_STORAGE_KEY,
  type OddsFormat,
} from "@/lib/odds-format";
import dynamic from "next/dynamic";
import FeedSkeleton from "./FeedSkeleton";
import PredictionPollDeck from "./PredictionPollDeck";
import type {
  PredictionPoll,
  PredictionPollCounts,
} from "@/lib/feed/prediction-polls";

// CommentThread + ReelGroup are off the initial-paint critical
// path — comments only render when a row is expanded, the reel
// group sits well below the fold. Dynamic-import both so the
// home-feed first-contentful-paint bundle drops by ~25KB combined.
const CommentThread = dynamic(() => import("./CommentThread"), {
  ssr: false,
  loading: () => (
    <ul className="feed-thread-list" aria-busy="true">
      {[0, 1].map((i) => (
        <li key={i} className="feed-comment feed-comment-skeleton">
          <span className="skeleton-line feed-comment-skel-author" />
          <span className="skeleton-line feed-comment-skel-text" />
        </li>
      ))}
    </ul>
  ),
});
import FollowButton, { getFollows } from "./FollowButton";
import HeroIntro from "./HeroIntro";
import OffWeekLanding from "./OffWeekLanding";
import { abbreviateName } from "@/lib/text/abbreviate";
import { readBets, type TrackedBet } from "./bet-shared";
import {
  betKindShortLabel,
  formatImpactCurrency,
  headlineImpactForEvent,
} from "./bet-impact";
import NotificationPrompt from "./notifications/NotificationPrompt";
import IosInstallHint from "./notifications/IosInstallHint";
import { useNotifications } from "./notifications/useNotifications";
import PlayerAvatar from "./PlayerAvatar";
import PlayerSearch from "./PlayerSearch";
import PuttPollWidget from "./PuttPollWidget";
import { useToast } from "./Toast";
import { useFollowedPlayers } from "./useFollowedPlayers";
import HoleScoringAverage from "./HoleScoringAverage";
import BetPost from "./BetPost";
import BetPostErrorBoundary from "./BetPostErrorBoundary";
import SweatHeader from "./SweatHeader";
import PnLTicker from "./PnLTicker";
import ShotPost from "./ShotPost";
import ShotsReel from "./ShotsReel";
import ShotDetail from "./ShotDetail";
import TournamentChat from "./TournamentChat";
import type { FeedEvent } from "@/lib/feed/types";
import { DEMO_RESPONSE, DEMO_EMOJI_REACTIONS } from "./demo-feed";
import type { ReactionState } from "./ReactionChips";
import { CrewBetPost, CrewResultPost, CrewTipPost } from "./CrewPosts";
import { MOCK_CREW_POSTS, type MockCrewPost } from "./mock-crew-posts";
const ReelGroup = dynamic(() => import("./ReelGroup"), {
  ssr: false,
  loading: () => null,
});

// Faster ticks during live play so the feed feels close to real-time
// alongside the IMG-ingest path; visibility-gated below so a backgrounded
// tab doesn't keep burning Upstash quota.
const REFRESH_MS = 3_000;
const REFRESH_MS_HIDDEN = 30_000;
const AUTHOR_KEY_STORAGE = "pardle_feed_author";
/** Cache the last successful /api/feed response so repeat visits show
 *  data instantly + revalidate in the background. ~1h freshness — if
 *  older the user gets a normal skeleton, since stale tournament state
 *  could confuse (e.g. yesterday's "live" data appearing on a new
 *  tournament's tee day). Versioned so we can invalidate on payload
 *  shape changes. */
const FEED_CACHE_STORAGE = "pardle_feed_cache_v1";
const FEED_CACHE_TTL_MS = 60 * 60 * 1000;
/** Rolling log of recent fetch durations (ms). Drives the honest
 *  "usually ~2.1s" hint on the skeleton — gives the user a calibrated
 *  expectation instead of an open-ended wait. */
const FEED_LOAD_TIMES_STORAGE = "pardle_feed_load_times_v1";
const FEED_LOAD_TIMES_KEEP = 8;
const FLOATER_LIFETIME_MS = 2600;

interface FeedResponse {
  tournament: {
    id: string;
    name: string;
    isLive: boolean;
    startDate: number;
  } | null;
  rows: FeedRow[];
  bestReel: FeedRow[];
  worstReel: FeedRow[];
  bursts: Burst[];
  leaderboard: CachedLeaderboardRow[];
  playerIndex: CachedLeaderboardRow[];
  currentOdds: Record<string, number>;
  playerRoundStates: Record<
    string,
    {
      currentRound: number;
      holesPlayed: number;
      holesRemaining: number;
      strokes: number;
      parPlayed: number;
      parRemaining: number;
      roundPar: number;
      toPar: number;
      ttdPacePerHole: number;
      ttdHoles: number;
      rounds: Record<
        number,
        {
          holesPlayed: number;
          holesRemaining: number;
          strokes: number;
          parPlayed: number;
          parRemaining: number;
          roundPar: number;
          toPar: number;
          status: "not-started" | "in-progress" | "complete";
          expectedRemaining?: number;
          variance?: number;
        }
      >;
    }
  >;
  oddsHistories: Record<string, Array<{ ts: number; p: number }> | null>;
  tournamentProjections?: Record<
    string,
    { mean: number; variance: number; active: boolean }
  >;
  winningScoreHistory?: Array<{
    ts: number;
    points: Array<{ line: number; probUnder: number }>;
  }>;
  topFinishCurrent?: Record<
    string,
    { top5: number; top10: number; top20: number }
  >;
  /** Per-round-per-hole scoring aggregates (all players' completed
   *  holes, includes pars). Used by HoleScoringAverage so the mean
   *  isn't biased by the feed's par-suppression. */
  holeAggregates?: import("@/lib/feed/hole-aggregates").HoleAggregates;
  /** Course-trend chip signal — computed server-side over the full
   *  event buffer so the window is wide enough to show real shifts. */
  courseTrend?: import("@/lib/feed/course-trend").CourseTrend;
  topFinishHistory?: Array<{
    ts: number;
    byPlayer: Record<string, { top5: number; top10: number; top20: number }>;
  }>;
  /** "X% of Pardle bettors backing this player" — keyed by playerId.
   *  Sparse: only players who pass the 2-backer / 5% floor. */
  communityBackingPct?: Record<string, number>;
  /** Total distinct bettors in the tournament window. Use to decide
   *  if the population's big enough to surface the chip at all. */
  communityTotalBettors?: number;
  /** Putt prediction poll state keyed by pollId. Counts + close
   *  status + outcome + the caller's own vote. Sparse — only includes
   *  polls referenced by events in this response. */
  puttPolls?: Record<
    string,
    {
      counts: { yes: number; no: number };
      closedAt: number | null;
      made: boolean | null;
      myVote: "yes" | "no" | null;
      polledAtStroke: number;
      crowdWasWrong?: boolean;
    }
  >;
  /** Caller's putt-prediction accuracy + streak + tournament rank.
   *  Null when no visitorId in the request. */
  myPuttIq?: {
    total: number;
    correct: number;
    currentStreak: number;
    longestStreak: number;
    tournament?: { total: number; correct: number };
    tournamentRank?: number | null;
  } | null;
  /** Caller's Sharp Score across every prediction category. Null
   *  when no visitorId; empty (total: 0) when nothing's been
   *  recorded yet. */
  mySharp?: {
    total: number;
    correct: number;
    accuracy: number;
    qualified: boolean;
    currentStreak: number;
    rank: number | null;
  } | null;
  /** Open head-to-head / hold-the-lead prediction polls + the
   *  caller's own pick on each. Empty when nothing's open. */
  predictionPolls?: Array<{
    poll: PredictionPoll;
    counts: PredictionPollCounts;
    myVote: string | null;
  }>;
  /** Hot/cold hand status keyed by playerId — sparse (only the top 5
   *  / bottom 5 by today's sg_total who clear the magnitude floor). */
  handStatus?: Record<string, "hot" | "cold">;
  /** Top 3 / bottom 3 by week-to-date sg_total — powers the
   *  "🔥 hottest this week / 🥶 coldest" strip. */
  fieldMomentum?: {
    hot: Array<{ playerId: string; displayName: string; sgTotal: number }>;
    cold: Array<{ playerId: string; displayName: string; sgTotal: number }>;
  };
  /** Recent-form sparkline data — last 8 PGA Tour starts per player.
   *  Sparse: only top-30 leaderboard players are mapped. */
  recentForm?: Record<
    string,
    {
      name: string;
      recent: Array<{
        season: number;
        tournament: string;
        finishText: string;
        finishPos: number | null;
        madeCut: boolean;
      }>;
    }
  >;
  watching: number;
  seenToday: number;
  polled: boolean;
}

interface Floater {
  key: string;
  emoji: string;
  xPct: number;
}

/** Stable per-browser id for reactions/presence — generated once, persisted. */
function getAuthorKey(): string {
  if (typeof window === "undefined") return "";
  let k = window.localStorage.getItem(AUTHOR_KEY_STORAGE);
  if (!k) {
    k = `a${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.localStorage.setItem(AUTHOR_KEY_STORAGE, k);
  }
  return k;
}

interface CachedFeedEnvelope {
  ts: number;
  data: FeedResponse;
}

function readCachedFeed(): FeedResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FEED_CACHE_STORAGE);
    if (!raw) return null;
    const env = JSON.parse(raw) as CachedFeedEnvelope;
    if (!env?.ts || !env.data) return null;
    if (Date.now() - env.ts > FEED_CACHE_TTL_MS) return null;
    return env.data;
  } catch {
    return null;
  }
}

function writeCachedFeed(data: FeedResponse): void {
  if (typeof window === "undefined") return;
  try {
    const env: CachedFeedEnvelope = { ts: Date.now(), data };
    window.localStorage.setItem(FEED_CACHE_STORAGE, JSON.stringify(env));
  } catch {
    // localStorage full / disabled — silent. Cache miss next time is fine.
  }
}

function readLoadTimes(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FEED_LOAD_TIMES_STORAGE);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((n): n is number => typeof n === "number" && n > 0);
  } catch {
    return [];
  }
}

function recordLoadTime(ms: number): number[] {
  if (typeof window === "undefined") return [];
  const arr = readLoadTimes();
  arr.push(ms);
  const trimmed = arr.slice(-FEED_LOAD_TIMES_KEEP);
  try {
    window.localStorage.setItem(
      FEED_LOAD_TIMES_STORAGE,
      JSON.stringify(trimmed),
    );
  } catch {
    // silent
  }
  return trimmed;
}

function medianMs(times: number[]): number | null {
  if (times.length === 0) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Coarse "time ago" label. The orchestrator's score data lags real
 * play by a couple of minutes, so the `ts` we capture at detection is
 * already 1–5 minutes after the shot actually happened — second-level
 * precision would claim accuracy we don't have. Bucket to "just now" /
 * "few min ago" / "Nm ago" / "Nh ago".
 */

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 120) return "just now";
  const m = Math.floor(s / 60);
  if (m < 6) return "few min ago";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}


/**
 * Strip the leading player name from an engine-generated headline so
 * the v4 row can render the name in its own slot. Falls back to the
 * full headline if the name isn't a prefix (unusual but possible).
 */
function stripPlayerName(headline: string, playerName: string): string {
  if (!headline.startsWith(playerName)) return headline;
  const rest = headline.slice(playerName.length).trim();
  if (rest.length === 0) return headline;
  return rest[0].toUpperCase() + rest.slice(1);
}

interface FeedClientProps {
  /** Optional past-tournament id to replay. When set, the component
   *  fetches /api/feed?tournamentId=X (skipping the active resolver
   *  + poll path) and treats the resulting data as if it were live
   *  for rendering purposes — used by /replay/[id] for demo /
   *  screenshot work. */
  forcedTournamentId?: string;
  /** Rewind cutoff in hours. When set, we filter the replay events
   *  to those older than `latestEventTs - (backHours × 1h)`. Lets us
   *  scrub back to mid-round density on tournaments that have already
   *  finished — otherwise the buffer is pinned at end-of-R4. */
  replayBackHours?: number;
}

/** Resolve a poll ID's matching event ID. Used by the deep-link
 *  handler — the bridge card on /pros / /faces sends users here
 *  with ?poll=<id> after they finish a puzzle, and we need to
 *  find which feed row carries that poll so we can scroll it
 *  into view. */
function findEventIdForPoll(
  rows: FeedResponse["rows"] | undefined,
  pollId: string,
): string | null {
  if (!rows) return null;
  for (const r of rows) {
    if (r.event.type === "putt-poll" && r.event.pollId === pollId) {
      return r.event.id;
    }
  }
  return null;
}

export default function FeedClient({
  forcedTournamentId,
  replayBackHours,
}: FeedClientProps = {}) {
  const toast = useToast();
  const { followed: followedPlayerIds } = useFollowedPlayers();
  /** Read demo flag synchronously so initial state can seed
   *  DEMO_RESPONSE into `data` and the very first paint already
   *  shows stub cards — no flash to the off-week landing on
   *  re-hydration. */
  const isDemo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("demo") === "1";
  const [data, setData] = useState<FeedResponse | null>(
    isDemo ? (DEMO_RESPONSE as unknown as FeedResponse) : null,
  );
  /** Pulled from ?poll=<id> on first mount. When set, the matching
   *  feed row scrolls into view + flashes a highlight ring once
   *  the data resolves. */
  const [deepLinkPollId, setDeepLinkPollId] = useState<string | null>(null);
  const [deepLinkFired, setDeepLinkFired] = useState(false);
  // Mirror isDemo into state so any future flips (e.g. clicking
  // "Exit demo") could be wired through; today it's a one-way flag
  // for the lifetime of the page mount. Crucially: this state is
  // initialised SYNCHRONOUSLY from isDemo so it's correct from the
  // very first render — no useEffect race against the polling
  // load() to lose.
  const [demoMode] = useState<boolean>(isDemo);

  // Per-event emoji reactions — counts + the user's own reactions.
  // Seeded from DEMO_EMOJI_REACTIONS on demo mounts; on real loads
  // starts empty and accumulates as users tap-toggle / hold-pick.
  // (Persisted-server reactions are a follow-up — same shape on
  // the wire, just hydrated from /api/feed.)
  const [emojiReactions, setEmojiReactions] = useState<
    Record<string, ReactionState>
  >(() => (isDemo ? { ...DEMO_EMOJI_REACTIONS } : {}));
  const toggleEmojiReaction = useCallback(
    (eventId: string, emoji: string) => {
      setEmojiReactions((all) => {
        const cur: ReactionState = all[eventId] ?? { counts: {}, mine: [] };
        const had = cur.mine.includes(emoji);
        const nextCount = Math.max(
          0,
          (cur.counts[emoji] ?? 0) + (had ? -1 : 1),
        );
        const nextCounts = { ...cur.counts };
        if (nextCount === 0) delete nextCounts[emoji];
        else nextCounts[emoji] = nextCount;
        return {
          ...all,
          [eventId]: {
            counts: nextCounts,
            mine: had
              ? cur.mine.filter((e) => e !== emoji)
              : [...cur.mine, emoji],
          },
        };
      });
    },
    [],
  );
  // Long-press pick is always an ADD — never a toggle-off. Re-picking
  // the same emoji is idempotent so the pill stays put. The tap-pill
  // path (`toggleEmojiReaction` above) is what removes a reaction.
  const addEmojiReaction = useCallback(
    (eventId: string, emoji: string) => {
      setEmojiReactions((all) => {
        const cur: ReactionState = all[eventId] ?? { counts: {}, mine: [] };
        if (cur.mine.includes(emoji)) return all;
        return {
          ...all,
          [eventId]: {
            counts: {
              ...cur.counts,
              [emoji]: (cur.counts[emoji] ?? 0) + 1,
            },
            mine: [...cur.mine, emoji],
          },
        };
      });
    },
    [],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const p = params.get("poll");
    if (p) setDeepLinkPollId(p);
  }, []);

  // (Demo data is now seeded synchronously in initial useState so
  // the very first paint already shows stub cards. No post-mount
  // effect is needed.)

  // Once data arrives + the deep-link poll exists, scroll its row
  // into view and apply a brief highlight ring. Strip the ?poll
  // param from the URL so a refresh doesn't re-fire the scroll.
  useEffect(() => {
    if (!deepLinkPollId || deepLinkFired || !data) return;
    const eventId = findEventIdForPoll(data.rows, deepLinkPollId);
    if (!eventId) return;
    setDeepLinkFired(true);
    // Defer one paint so the row's actually in the DOM.
    window.requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(
        `[data-event-id="${CSS.escape(eventId)}"]`,
      );
      if (!node) return;
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      node.classList.add("feed-row-deep-linked");
      window.setTimeout(() => {
        node.classList.remove("feed-row-deep-linked");
      }, 2400);
    });
    // Strip ?poll so a refresh doesn't loop us back.
    const url = new URL(window.location.href);
    url.searchParams.delete("poll");
    window.history.replaceState({}, "", url.toString());
  }, [data, deepLinkPollId, deepLinkFired]);

  const [error, setError] = useState(false);
  // Optimistic putt-poll state — overlays server data for instant
  // feedback when the user clicks yes/no. Keyed by pollId.
  const [myPollVotes, setMyPollVotes] = useState<
    Record<string, "yes" | "no">
  >({});
  const [pollCounts, setPollCounts] = useState<
    Record<string, { yes: number; no: number }>
  >({});
  // Optimistic state for prediction polls (head-to-head, hold-the-
  // lead) — same pattern as putt polls, keyed by pollId.
  const [myPredictionVotes, setMyPredictionVotes] = useState<
    Record<string, { myVote: string | null; counts: PredictionPollCounts }>
  >({});
  const [expanded, setExpanded] = useState<string | null>(null);
  // Per-event flag for "user tapped the truncated context tag and
  // wants to read the full text" — toggles the .feed-actions-tag
  // from a nowrap+ellipsis pill into a wrapping multi-line chip.
  const [expandedTags, setExpandedTags] = useState<Record<string, boolean>>({});
  const toggleTag = useCallback((eventId: string) => {
    setExpandedTags((m) => ({ ...m, [eventId]: !m[eventId] }));
  }, []);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>(
    {},
  );
  const [floaters, setFloaters] = useState<Floater[]>([]);
  // Burst bar visibility — hidden on cold landing so a brand-new
  // visitor doesn't see a permanent strip of unexplained emoji
  // (Used to gate the bottom burst-bar's visibility on first
  // scroll. Bar removed in favour of the per-card hold-to-react
  // gesture; this scroll listener went with it.)
  type FilterMode = "all" | "hot" | "smart";
  // Default landing = All (chronological) — Hot's curated view was
  // confusing users on cold-load because it silently dropped whole
  // stretches of the timeline. Hot is still a one-tap toggle away.
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  /** Shot-detail overlay — opens when a notable shot is tapped
   *  (inline shot card OR a Shots-of-the-day reel card). The
   *  detail surface in turn has its own Share button that opens
   *  the existing ShotShareCard. */
  const [shotDetail, setShotDetail] = useState<FeedEvent | null>(null);
  const [follows, setFollowsState] = useState<string[]>([]);
  // Tracked bets loaded from localStorage on mount + whenever they
  // change. Drives the per-row bet-impact chip — "🚀 +£42 your
  // outright" / "💀 −£18 your outright" — that fires on events the
  // engine confirms materially moved the bet's probability.
  const [trackedBets, setTrackedBets] = useState<TrackedBet[]>([]);
  const [oddsFormat, setOddsFormat] =
    useState<OddsFormat>(DEFAULT_ODDS_FORMAT);

  // Hydrate odds-format preference from localStorage after mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(ODDS_FORMAT_STORAGE_KEY);
    if (raw === "american" || raw === "fractional" || raw === "decimal") {
      setOddsFormat(raw);
    }
  }, []);

  const pickOddsFormat = useCallback((fmt: OddsFormat) => {
    setOddsFormat(fmt);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ODDS_FORMAT_STORAGE_KEY, fmt);
    }
  }, []);

  const authorKey = useRef<string>("");
  const seenBursts = useRef<Set<string>>(new Set());
  // Event IDs we've already auto-celebrated this session — prevents
  // re-spawning floaters every poll cycle for the same eagle.
  const celebratedEvents = useRef<Set<string>>(new Set());
  // Median /api/feed duration across recent fetches (ms). Drives the
  // honest "usually ~2.1s" hint on the skeleton. Hydrated from
  // localStorage on mount + updated after each successful load.
  const [medianLoadMs, setMedianLoadMs] = useState<number | null>(null);

  useEffect(() => {
    authorKey.current = getAuthorKey();
    if (demoMode) return; // demo seeded synchronously — don't overwrite
    // Cached-first display: show last successful response immediately
    // so repeat visits feel instant. Background fetch (kicked off by
    // the load() polling effect below) replaces with fresh data
    // within the typical 1-3s, no visual interruption.
    const cached = readCachedFeed();
    if (cached) setData(cached);
    setMedianLoadMs(medianMs(readLoadTimes()));
  }, [demoMode]);

  // Stamp the html element so body bg goes warm paper while the feed
  // is mounted; clear on unmount so /bets, /sharp etc. keep their
  // dark v4 background.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add("pv-theme-body");
    return () => {
      document.documentElement.classList.remove("pv-theme-body");
    };
  }, []);

  // Track followed players — re-read whenever a FollowButton fires the event.
  useEffect(() => {
    const sync = () => setFollowsState(getFollows());
    sync();
    window.addEventListener("pardle-follows-changed", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("pardle-follows-changed", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  // Mirror followed-players to the server so the notify-poll cron can
  // address birdie/eagle/blow-up + putt-poll-open events to this
  // device. Cheap when push isn't enabled (the hook returns early).
  // Debounced via the effect tick — multiple rapid follow toggles
  // collapse to one POST per render frame.
  const { syncFollows } = useNotifications();
  useEffect(() => {
    void syncFollows(follows);
  }, [follows, syncFollows]);

  // Tracked bets — refresh on mount, on tab focus (might have edited
  // bets on /bets in another tab), and on storage events. Drives
  // the bet-aware chip + the Your-bets filter tab.
  useEffect(() => {
    const sync = () => setTrackedBets(readBets());
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // ── Floating emoji bursts ──────────────────────────────────────
  const spawnFloater = useCallback((emoji: string) => {
    const key = `f${Math.random().toString(36).slice(2)}${Date.now()}`;
    const xPct = 8 + Math.random() * 84; // keep away from the very edges
    setFloaters((f) => [...f, { key, emoji, xPct }]);
    setTimeout(() => {
      setFloaters((f) => f.filter((x) => x.key !== key));
    }, FLOATER_LIFETIME_MS);
  }, []);

  const load = useCallback(async () => {
    // Belt-and-braces: even if something accidentally calls load()
    // in demo mode (manual trigger, stale interval that survived a
    // demoMode flip), bail before touching state so the stub is
    // never overwritten.
    if (demoMode) return;
    const startedAt = performance.now();
    try {
      const tParam = forcedTournamentId
        ? `&tournamentId=${encodeURIComponent(forcedTournamentId)}`
        : "";
      const res = await fetch(`/api/feed?v=${authorKey.current}${tParam}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as FeedResponse;
      // When forcing a past tournament we want the full feed UI to
      // render — but /api/feed sets isLive=false for those, which
      // would short-circuit FeedClient into the countdown card.
      // Override isLive=true locally so the page renders as if live.
      if (forcedTournamentId && json.tournament) {
        json.tournament = { ...json.tournament, isLive: true };
      }
      setData(json);
      setError(false);
      // Cache for instant repeat-visit display. Skipped for past-
      // tournament replays so we don't poison the home cache.
      if (!forcedTournamentId) {
        writeCachedFeed(json);
      }
      // Record this fetch's duration so the skeleton's "usually ~X.Xs"
      // hint stays calibrated to the user's actual experience.
      const duration = performance.now() - startedAt;
      const updated = recordLoadTime(duration);
      setMedianLoadMs(medianMs(updated));

      // Once the server has a recorded vote for a poll, drop the
      // optimistic overlay so closed-poll outcomes (made/missed)
      // and the canonical community counts take over the render.
      const serverPolls = json.puttPolls ?? {};
      setMyPollVotes((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [pid, p] of Object.entries(serverPolls)) {
          if (next[pid] && (p.myVote === next[pid] || p.closedAt != null)) {
            delete next[pid];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setPollCounts((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const pid of Object.keys(prev)) {
          if (serverPolls[pid]?.closedAt != null) {
            delete next[pid];
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      // Animate any bursts we haven't shown yet (others' taps).
      for (const b of json.bursts ?? []) {
        if (!seenBursts.current.has(b.id)) {
          seenBursts.current.add(b.id);
          // Only animate genuinely recent ones — avoids a flood when
          // first opening the page mid-tournament.
          if (Date.now() - b.ts < 12_000) {
            spawnFloater(b.emoji);
          }
        }
      }

      // Auto-celebrate genuinely big shots — eagles, aces, blow-ups,
      // and long putts (≥30 ft) spawn the matching emoji floater so
      // the screen reacts to the moment without anyone needing to
      // tap. Same dedup pattern as bursts above. Only events from
      // the last ~30s trigger — avoids a confetti rain when an
      // hour-old eagle scrolls in for the first time.
      const NEW_EVENT_CUTOFF_MS = 30_000;
      const now = Date.now();
      for (const row of json.rows ?? []) {
        const ev = row.event;
        if (celebratedEvents.current.has(ev.id)) continue;
        celebratedEvents.current.add(ev.id);
        if (now - ev.ts > NEW_EVENT_CUTOFF_MS) continue;
        let emoji: string | null = null;
        if (ev.ace) emoji = "🎯";
        else if (ev.result === "albatross") emoji = "🤯";
        else if (ev.result === "eagle") emoji = "🦅";
        else if (ev.result === "triple-plus") emoji = "💥";
        else if (
          ev.type === "score" &&
          typeof ev.proximityInches === "number" &&
          ev.proximityInches >= 360 &&
          (ev.result === "birdie" || ev.result === "par")
        ) {
          // Long-distance hole-out / drained putt — proximity is "to
          // hole" so ≥30ft (360 in) putts holed are the signature
          // moments we want to celebrate.
          emoji = "🐦";
        }
        if (emoji) spawnFloater(emoji);
      }
    } catch {
      setError(true);
    }
  }, [spawnFloater, forcedTournamentId, demoMode]);

  useEffect(() => {
    // Demo mode owns the data — skip the network fetch + the
    // polling loop entirely so the stub doesn't get overwritten.
    if (demoMode) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const isHidden = () =>
      typeof document !== "undefined" && document.hidden;
    const schedule = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(load, isHidden() ? REFRESH_MS_HIDDEN : REFRESH_MS);
    };
    const onVis = () => {
      if (!isHidden()) load();
      schedule();
    };
    load();
    schedule();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load, demoMode]);

  async function sendBurst(emoji: string) {
    spawnFloater(emoji); // optimistic — instant feedback for the tapper
    try {
      await fetch("/api/feed/burst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji, visitorId: authorKey.current }),
      });
    } catch {
      /* the floater still showed; no-op on failure */
    }
  }

  /**
   * Cast a vote on a putt prediction poll. Optimistic — increment the
   * chosen side immediately and snap back on error. Server response
   * (next /api/feed refresh) re-syncs the canonical counts.
   */
  async function sendPollVote(pollId: string, vote: "yes" | "no") {
    const baseCounts =
      pollCounts[pollId] ??
      data?.puttPolls?.[pollId]?.counts ??
      { yes: 0, no: 0 };
    const prevVote = myPollVotes[pollId] ?? data?.puttPolls?.[pollId]?.myVote ?? null;
    if (prevVote === vote) return;
    setMyPollVotes((m) => ({ ...m, [pollId]: vote }));
    setPollCounts((m) => {
      const c = { ...baseCounts };
      if (prevVote === "yes") c.yes = Math.max(0, c.yes - 1);
      if (prevVote === "no") c.no = Math.max(0, c.no - 1);
      c[vote] += 1;
      return { ...m, [pollId]: c };
    });
    try {
      const res = await fetch(
        `/api/polls/${encodeURIComponent(pollId)}/vote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vote, authorKey: authorKey.current }),
        },
      );
      if (!res.ok) {
        // Revert the optimistic bump regardless of why the server said no.
        setMyPollVotes((m) => {
          const out = { ...m };
          delete out[pollId];
          return out;
        });
        setPollCounts((m) => ({ ...m, [pollId]: baseCounts }));
        // 409 = poll already closed on the server (putt has been made or
        // missed between the client's last feed refresh and this click).
        // Tell the user their vote was too late, sync counts from the
        // server response, and force-refresh the feed so the widget flips
        // to its "Drained it / Missed" state on the next paint instead of
        // silently disappearing.
        if (res.status === 409) {
          try {
            const j = await res.json();
            if (j?.counts) {
              setPollCounts((m) => ({ ...m, [pollId]: j.counts }));
            }
          } catch {}
          toast.info(
            "Too late — putt already dropped or missed",
          );
          void load();
        }
      }
    } catch {
      // Network blip — leave optimistic state; next refresh corrects.
    }
  }

  /** Cast a vote on a prediction poll (head-to-head / hold-the-
   *  lead). Optimistic — bump the chosen option immediately, snap
   *  back on a server error. Next /api/feed refresh re-syncs. */
  async function sendPredictionVote(pollId: string, optionKey: string) {
    const server = data?.predictionPolls?.find((p) => p.poll.id === pollId);
    if (!server) return;
    const base = myPredictionVotes[pollId];
    const prevVote = base?.myVote ?? server.myVote;
    if (prevVote === optionKey) return;
    const baseCounts = base?.counts ?? server.counts;
    const nextCounts: PredictionPollCounts = { ...baseCounts };
    if (prevVote && nextCounts[prevVote] != null) {
      nextCounts[prevVote] = Math.max(0, nextCounts[prevVote] - 1);
    }
    nextCounts[optionKey] = (nextCounts[optionKey] ?? 0) + 1;
    setMyPredictionVotes((m) => ({
      ...m,
      [pollId]: { myVote: optionKey, counts: nextCounts },
    }));
    try {
      const res = await fetch("/api/predictions/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pollId,
          authorKey: authorKey.current,
          optionKey,
        }),
      });
      if (!res.ok) {
        // Revert on rejection (closed poll, rate-limited).
        setMyPredictionVotes((m) => {
          const out = { ...m };
          delete out[pollId];
          return out;
        });
      }
    } catch {
      // Network blip — keep optimistic state; next refresh corrects.
    }
  }

  // ── Empty / loading / not-live states ───────────────────────────
  if (error && !data) {
    return (
      <section className="feed-wrap v4-theme pv-theme">
        <p className="feed-empty">
          Couldn&apos;t load the feed. It&apos;ll retry automatically.
        </p>
      </section>
    );
  }
  if (!data) {
    return <FeedSkeleton hintMs={medianLoadMs} />;
  }
  if (!data.tournament) {
    return <OffWeekLanding tournament={null} />;
  }
  if (!data.tournament.isLive) {
    return <OffWeekLanding tournament={data.tournament} />;
  }

  // ── Live feed ───────────────────────────────────────────────────
  const followSet = new Set(follows);
  // Putt-poll rows: only keep the single latest open poll (the one
  // that shows the vote widget). Older open polls + closed polls
  // both render as plain "Has X ft for birdie…" rows that read as
  // historical noise — the user has no widget to vote on and the
  // eventual score event already lands the outcome. Compute the
  // latest open pollId first, then drop every other putt-poll row.
  const POLL_MAX_AGE_MS = 8 * 60 * 1000;
  const _latestOpenPollIdForFilter: string | null =
    data.rows.find((r) => {
      const ev = r.event;
      if (ev.type !== "putt-poll" || !ev.pollId) return false;
      const ps = data.puttPolls?.[ev.pollId];
      if (!ps || ps.closedAt != null) return false;
      if (typeof ev.ts === "number" && Date.now() - ev.ts > POLL_MAX_AGE_MS) {
        return false;
      }
      return true;
    })?.event.pollId ?? null;
  const rowsAfterPollFilter = data.rows.filter((r) => {
    const ev = r.event;
    if (ev.type !== "putt-poll") return true;
    return ev.pollId != null && ev.pollId === _latestOpenPollIdForFilter;
  });

  // Rewind cutoff — anchored to the LATEST event in the buffer, not
  // wall-clock, because the buffer for a finished tournament is
  // frozen at its end. `back=6` means "show events at least 6 hours
  // before the last thing that happened."
  const latestBufferTs = data.rows.reduce(
    (max, r) => (r.event.ts > max ? r.event.ts : max),
    0,
  );
  const rewoundRows =
    replayBackHours != null && replayBackHours > 0 && latestBufferTs > 0
      ? rowsAfterPollFilter.filter(
          (r) =>
            r.event.ts <= latestBufferTs - replayBackHours * 60 * 60 * 1000,
        )
      : rowsAfterPollFilter;

  // When an IMG collector is active for this tournament (past OR
  // present — determined by whether any imgSourced event is in the
  // window), IMG is the canonical shot/score source. Filter out
  // orchestrator-sourced score/shot events entirely so we don't
  // surface stale "Player birdies the Nth" cards that duplicate
  // IMG's version. Non-shot/score events (putt-poll, position,
  // milestone) still pass — those are engine-only and additive.
  //
  // On tournaments without an IMG collector, no imgSourced events
  // exist → this filter no-ops and the feed behaves as before.
  const hasImgEvents = data.rows.some((r) => r.event.imgSourced === true);
  const rowsAfterImgPrimary = hasImgEvents
    ? rewoundRows.filter((r) => {
        const ev = r.event;
        if (ev.type !== "score" && ev.type !== "shot") return true;
        return ev.imgSourced === true;
      })
    : rewoundRows;
  // Smart-feed impact set — Tier 1 per-kind heuristic:
  //   - round-score  → owned player only, every shot
  //   - outright     → owned + top-5 by current odds, notable only
  //   - top-finish   → owned + bubble around cutoff, notable only
  //   - winning-score→ top-10 by leaderboard, notable only
  // Built once per render from the current feed slice; the filter then
  // gates each row through isMaterialEvent().
  const smartImpact = buildSmartImpactSet({
    bets: trackedBets,
    leaderboard: data.leaderboard,
    currentOdds: data.currentOdds,
    followedPlayerIds,
  });
  const hotCtx = buildHotFilterCtx({ leaderboard: data.leaderboard });
  const visibleRows = (() => {
    if (filterMode === "smart") {
      return rowsAfterImgPrimary.filter((r) =>
        isMaterialEvent(r.event, smartImpact),
      );
    }
    if (filterMode === "hot") {
      return rowsAfterImgPrimary.filter((r) => isHotEvent(r.event, hotCtx));
    }
    return rowsAfterImgPrimary;
  })();

  // Build interleaved timeline — tracked bets become first-class
  // posts sorted alongside shot rows. Each bet's sort timestamp
  // anchors to its most-recent player shot when one exists in the
  // current row window (so an active bet bubbles up to the action),
  // falling back to placedAt for bets whose player is quiet.
  // Best / Worst modes skip bet + crew interleaving — those filters
  // are pure curated highlight reels.
  type TimelineItem =
    | { kind: "shot"; ts: number; row: (typeof visibleRows)[number] }
    | {
        kind: "bet";
        ts: number;
        bet: TrackedBet;
        playerId: string;
      }
    | { kind: "crew"; ts: number; post: MockCrewPost };
  const timeline: TimelineItem[] = [];
  for (const row of visibleRows) {
    timeline.push({ kind: "shot", ts: row.event.ts, row });
  }
  // Mock crew posts — fictional Jordan/Mia/Theo/Sam/Edge "is sweating"
  // cards. Gated to ?demo=1 only. Outside demo, the live feed shows
  // ONLY real shots + the user's own tracked bets — never demo crew.
  // (CLAUDE.md: never inject demo data into the live experience.)
  if (filterMode === "all" && demoMode) {
    const now = Date.now();
    for (const post of MOCK_CREW_POSTS) {
      timeline.push({ kind: "crew", ts: now + post.tsOffsetMs, post });
    }
  }
  for (const bet of trackedBets) {
    if (bet.settledAt != null) continue;
    if (
      bet.kind !== "outright" &&
      bet.kind !== "top-finish" &&
      bet.kind !== "round-score"
    ) {
      continue;
    }
    const playerId = "playerId" in bet ? String(bet.playerId) : "";
    if (!playerId) continue;
    let ts = bet.placedAt ?? 0;
    // visibleRows is newest-first; the first match is the most recent.
    for (const row of visibleRows) {
      if (row.event.playerId === playerId) {
        ts = Math.max(ts, row.event.ts);
        break;
      }
    }
    timeline.push({ kind: "bet", ts, bet, playerId });
  }
  timeline.sort((a, b) => b.ts - a.ts);

  // Only show the vote widget on the LATEST open putt poll in the
  // feed. Older open polls (their putt was struck minutes ago) and
  // closed polls (already resolved) render as plain rows. Rationale:
  // the widget only does work when the putt is still live; on a
  // 10-minute-old poll the answer is already known.
  const latestOpenPollId: string | null =
    data.rows.find((r) => {
      const ev = r.event;
      if (ev.type !== "putt-poll" || !ev.pollId) return false;
      const ps = data.puttPolls?.[ev.pollId];
      return !ps || ps.closedAt == null;
    })?.event.pollId ?? null;

  return (
    <section className="feed-wrap v4-theme pv-theme tchat-content-pad">
      <SweatHeader />
      {demoMode && (
        <div className="demo-banner" role="note" aria-live="polite">
          <span className="demo-banner-tag">DEMO</span>
          <span className="demo-banner-text">
            Stub shot cards · for previewing the gesture + reel.{" "}
            <a className="demo-banner-exit" href="/">
              Exit demo
            </a>
          </span>
        </div>
      )}
      <PnLTicker
        trackedBets={trackedBets}
        displayName={
          typeof window !== "undefined"
            ? window.localStorage.getItem("pardle_display_name")
            : null
        }
      />
      <div className="pv-tournament-strip">
        <span
          className="feed-live-pulse feed-live-pulse-inline"
          aria-label="Live"
          title="Live"
        />
        <span className="pv-tournament-strip-name">
          {data.tournament.name}
        </span>
      </div>

      {data.predictionPolls && data.predictionPolls.length > 0 && (
        <div className="pv-poll-deck-host">
          <PredictionPollDeck
            polls={data.predictionPolls}
            myVotes={myPredictionVotes}
            onVote={sendPredictionVote}
          />
        </div>
      )}

      <main className="feed-main">

      {/* Live scoring-average chart — how each hole is playing, live
          from IMG score events. Only mounts when the buffer has
          score events to aggregate. Pars come off each score event
          itself, so no separate pars map required. */}
      {(data.holeAggregates &&
        Object.keys(data.holeAggregates).length > 0) ||
      data.rows.some((r) => r.event.type === "score") ? (
        <HoleScoringAverage
          rows={data.rows}
          aggregates={data.holeAggregates}
          trend={data.courseTrend}
        />
      ) : null}

      {/* Filter row — Hot / All / (Mine).
          Hot is the default landing: notable moments (birdies, close
          approaches, big drives, trouble, top-10 contenders) without
          the raw-firehose density of All. Mine is the personal
          tab — bets + follows — and only surfaces when the user has
          either an active bet OR a followed player. */}
      <div className="feed-filter-row">
        <button
          type="button"
          className={`feed-filter-btn ${filterMode === "hot" ? "feed-filter-on" : ""}`}
          onClick={() => setFilterMode("hot")}
          title="Notable moments only — birdies, close approaches, big drives, contenders"
        >
          🔥 Hot
        </button>
        <button
          type="button"
          className={`feed-filter-btn ${filterMode === "all" ? "feed-filter-on" : ""}`}
          onClick={() => setFilterMode("all")}
          title="Every shot from every player — the raw firehose"
        >
          All
        </button>
        {(trackedBets.some((b) => b.settledAt == null) ||
          followedPlayerIds.length > 0) && (
          <button
            type="button"
            className={`feed-filter-btn ${filterMode === "smart" ? "feed-filter-on" : ""}`}
            onClick={() => setFilterMode("smart")}
            title="Your bets + followed players only"
          >
            ✦ Mine
          </button>
        )}
      </div>

      {data.rows.length === 0 ? (
        <FeedWarmingUp leaderboard={data.leaderboard} />
      ) : timeline.length === 0 ? (
        <p className="feed-empty">
          {filterMode === "smart"
            ? "No bet-relevant updates yet — your players are quiet right now. Tap All to see the whole feed."
            : "No updates yet."}
        </p>
      ) : (
        <ul className="feed-list">
          {timeline.map((__item, __idx) => {
            // After the first 4 timeline items, splice in the
            // "Shots of the day" reel as a full-width inline strip.
            // Sits partway down the feed (not pinned at top, not
            // tucked into a desktop sidebar).
            const reelHere =
              __idx === 4 &&
              ((data.bestReel?.length ?? 0) > 0 ||
                (data.worstReel?.length ?? 0) > 0) ? (
                <li className="feed-row-wrap" key="shots-reel">
                  <ShotsReel
                    best={data.bestReel ?? []}
                    worst={data.worstReel ?? []}
                    tournamentLabel={
                      data.tournament
                        ? `${data.tournament.name} · Live`
                        : "Live"
                    }
                    onTapShot={(ev) => setShotDetail(ev)}
                  />
                </li>
              ) : null;
            // ── Bet post branch ────────────────────────────────────
            // Tracked bets render inline among shot rows. Sort ts is
            // either the player's most recent shot or placedAt — see
            // timeline construction above.
            if (__item.kind === "bet") {
              const __bet = __item.bet;
              const __playerId = __item.playerId;
              const __rowsForPlayer = visibleRows
                .filter((r) => r.event.playerId === __playerId)
                .slice(0, 3);
              return (
                <Fragment key={`bet:${__bet.id}`}>
                  {reelHere}
                  <li
                    data-bet-id={__bet.id}
                    className="feed-row-wrap"
                  >
                    <BetPostErrorBoundary label={__bet.id}>
                      <BetPost
                        bet={__bet}
                        currentOdds={data.currentOdds}
                        topFinishCurrent={data.topFinishCurrent}
                        playerRoundStates={data.playerRoundStates}
                        contextRows={data.rows}
                        recentRowsForPlayer={__rowsForPlayer}
                        oddsHistory={
                          data.oddsHistories?.[__playerId] ?? null
                        }
                        onCustomReact={(emoji) => {
                          void sendBurst(emoji);
                          addEmojiReaction(`bet:${__bet.id}`, emoji);
                        }}
                        reactionState={emojiReactions[`bet:${__bet.id}`]}
                        onToggleReaction={(emoji) =>
                          toggleEmojiReaction(`bet:${__bet.id}`, emoji)
                        }
                      />
                    </BetPostErrorBoundary>
                  </li>
                </Fragment>
              );
            }
            // ── Crew-post branch ──────────────────────────────────
            // Mock bet/result/tip posts from fictional members.
            if (__item.kind === "crew") {
              const p = __item.post;
              return (
                <Fragment key={`crew:${p.id}`}>
                  {reelHere}
                  <li className="feed-row-wrap">
                    {p.kind === "crew-bet" && (
                      <CrewBetPost
                        post={p}
                        onCustomReact={(emoji) => {
                          void sendBurst(emoji);
                          addEmojiReaction(`crew:${p.id}`, emoji);
                        }}
                        reactionState={emojiReactions[`crew:${p.id}`]}
                        onToggleReaction={(emoji) =>
                          toggleEmojiReaction(`crew:${p.id}`, emoji)
                        }
                      />
                    )}
                    {p.kind === "crew-result" && (
                      <CrewResultPost
                        post={p}
                        onCustomReact={(emoji) => {
                          void sendBurst(emoji);
                          addEmojiReaction(`crew:${p.id}`, emoji);
                        }}
                        reactionState={emojiReactions[`crew:${p.id}`]}
                        onToggleReaction={(emoji) =>
                          toggleEmojiReaction(`crew:${p.id}`, emoji)
                        }
                      />
                    )}
                    {p.kind === "crew-tip" && (
                      <CrewTipPost
                        post={p}
                        onCustomReact={(emoji) => {
                          void sendBurst(emoji);
                          addEmojiReaction(`crew:${p.id}`, emoji);
                        }}
                        reactionState={emojiReactions[`crew:${p.id}`]}
                        onToggleReaction={(emoji) =>
                          toggleEmojiReaction(`crew:${p.id}`, emoji)
                        }
                      />
                    )}
                  </li>
                </Fragment>
              );
            }
            const { event, commentCount } = __item.row;
            const count = commentCounts[event.id] ?? commentCount;
            // First non-deprecated context tag worth surfacing.
            const primaryContextTag = (event.tags ?? []).find((t) => {
              if (/^\d+ of last \d+ in red$/.test(t)) return false;
              if (/^top \d+ in field today$/.test(t)) return false;
              if (/^among most /.test(t)) return false;
              if (t.startsWith("🔥 going off")) return false;
              return true;
            });
            // Notable shots (highlight or lowlight from the engine)
            // get an inline Share button + a small shot diagram.
            const isNotable =
              event.highlight === true || event.lowlight === true;
            // Putt-poll rows only survive the earlier filter when
            // they're the single latest OPEN poll — so the widget
            // always has a votable poll to render.
            const isPuttPoll =
              event.type === "putt-poll" && event.pollId != null;
            // Only compute impact for the Mine tab — for All/Hot we'd
            // spam every user's feed with impact chips even when they
            // haven't opted into bet-aware surfacing. Impact only
            // renders when a user has an active bet AND the shot
            // materially moves it.
            const impact =
              filterMode === "smart" &&
              trackedBets.some((b) => b.settledAt == null)
                ? headlineImpactForEvent(event, trackedBets, {
                    currentOdds: data.currentOdds,
                    leaderboard: data.leaderboard,
                    contextRows: data.rows,
                  })
                : null;
            return (
              <Fragment key={event.id}>
                {reelHere}
                <li
                  data-event-id={event.id}
                  className="feed-row-wrap"
                >
                  <ShotPost
                    event={event}
                    commentCount={count}
                    contextTag={primaryContextTag}
                    handStatus={data.handStatus?.[event.playerId] ?? null}
                    impact={impact}
                    onShare={
                      isNotable ? (ev) => setShotDetail(ev) : undefined
                    }
                    showDiagram={isNotable}
                    onCustomReact={(emoji) => {
                      // Float-up across the page + bump the chip
                      // cluster on this card. Long-press adds (never
                      // toggles off); tap-pill below toggles.
                      void sendBurst(emoji);
                      addEmojiReaction(`shot:${event.id}`, emoji);
                    }}
                    reactionState={emojiReactions[`shot:${event.id}`]}
                    onToggleReaction={(emoji) =>
                      toggleEmojiReaction(`shot:${event.id}`, emoji)
                    }
                  />
                  {isPuttPoll && event.pollId && (
                    <PuttPollWidget
                      pollId={event.pollId}
                      puttDistanceFt={event.puttDistanceFt}
                      playerName={event.playerName}
                      serverState={data.puttPolls?.[event.pollId]}
                      optimisticVote={myPollVotes[event.pollId]}
                      optimisticCounts={pollCounts[event.pollId]}
                      onVote={(v) => sendPollVote(event.pollId!, v)}
                    />
                  )}
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}

      <p className="feed-footnote">
        Live PGA Tour scoring
      </p>
        </main>

      {/* + Track-bet affordance lives in SweatHeader's icon row now,
          not as a floating action button — keeps the feed scroll
          surface free of overlapping chrome. */}

      {shotDetail && (
        <ShotDetail
          event={shotDetail}
          tournamentLabel={
            data.tournament
              ? `${data.tournament.name} · Live`
              : "Live"
          }
          onClose={() => setShotDetail(null)}
        />
      )}

      {/* Floating-emoji overlay — fixed so bursts rise over the whole feed */}
      <div className="feed-floater-layer" aria-hidden="true">
        {floaters.map((f) => (
          <span
            key={f.key}
            className="feed-floater"
            style={{ left: `${f.xPct}%` }}
          >
            {f.emoji}
          </span>
        ))}
      </div>

      {/* Old bottom burst bar removed — reactions now live per-card
          via the hold-to-pick tray on each shot's thumb button.
          Frees up the vertical space the sticky strip used to eat
          and ties the gesture to the specific shot the user is
          reacting to (not a global "this round" burst). */}

      {/* Tournament chat — peek bar above BottomNav, expands to a
          half-sheet on tap and full viewport on second expand. Only
          shows during a live tournament (already gated above). */}
      <TournamentChat
        tournamentId={data.tournament.id}
        tournamentName={data.tournament.name}
      />
    </section>
  );
}

// ── Feed warming-up state (live tournament, no shots yet) ─────────

function FeedWarmingUp({
  leaderboard,
}: {
  leaderboard: CachedLeaderboardRow[];
}) {
  // "Currently mid-round" — has a positive numeric thru (with or
  // without the back-tee asterisk) but hasn't finished. These are
  // the players whose next shot lands in the feed first.
  const onCourse: CachedLeaderboardRow[] = [];
  const yetToTee: CachedLeaderboardRow[] = [];
  for (const r of leaderboard) {
    const t = (r.thru ?? "").trim();
    if (!t || t === "-") {
      yetToTee.push(r);
      continue;
    }
    if (t === "F" || t === "F*") continue;
    const m = /^(\d+)\*?$/.exec(t);
    if (m) {
      const n = Number(m[1]);
      if (n > 0 && n < 18) onCourse.push(r);
    }
  }
  // Top 5 of each by position so the leader-board context is clearest.
  const byPos = (a: CachedLeaderboardRow, b: CachedLeaderboardRow) => {
    const pa = parsePosNum(a.position);
    const pb = parsePosNum(b.position);
    return (pa ?? 999) - (pb ?? 999);
  };
  const onCourseTop = onCourse.sort(byPos).slice(0, 5);
  const yetToTeeTop = yetToTee.sort(byPos).slice(0, 5);

  return (
    <section className="feed-warming">
      <p className="feed-warming-title">
        Tournament is live · first shots landing soon
      </p>
      <p className="feed-warming-blurb">
        Every birdie, eagle, blow-up, and crowd-call putt arrives here
        as it happens. While we wait —
      </p>
      {onCourseTop.length > 0 && (
        <div className="feed-warming-section">
          <div className="feed-warming-label">On course now</div>
          <ul className="feed-warming-list">
            {onCourseTop.map((p) => (
              <li key={p.playerId} className="feed-warming-row">
                <PlayerAvatar
                  playerId={p.playerId}
                  playerName={p.displayName}
                  size="sm"
                />
                <span className="feed-warming-row-name">
                  {abbreviateName(p.displayName)}
                </span>
                <span className="feed-warming-row-meta">
                  thru {p.thru} · {p.total}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {yetToTeeTop.length > 0 && (
        <div className="feed-warming-section">
          <div className="feed-warming-label">Yet to tee off</div>
          <ul className="feed-warming-list">
            {yetToTeeTop.map((p) => (
              <li key={p.playerId} className="feed-warming-row">
                <PlayerAvatar
                  playerId={p.playerId}
                  playerName={p.displayName}
                  size="sm"
                />
                <span className="feed-warming-row-name">
                  {abbreviateName(p.displayName)}
                </span>
                <span className="feed-warming-row-meta">{p.position}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function parsePosNum(p: string): number | null {
  if (!p) return null;
  const m = /^T?(\d+)$/.exec(p);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// ── Hottest-in-field strip ─────────────────────────────────────────

function MomentumStrip({
  momentum,
}: {
  momentum: FeedResponse["fieldMomentum"] | undefined;
}) {
  const hot = momentum?.hot ?? [];
  const cold = momentum?.cold ?? [];
  if (hot.length === 0 && cold.length === 0) return null;
  const fmt = (n: number) => {
    const r = Math.round(n * 10) / 10;
    return `${r >= 0 ? "+" : ""}${r.toFixed(1)}`;
  };
  return (
    <div className="momentum-strip" aria-label="Field momentum this week">
      {hot.length > 0 && (
        <div className="momentum-row momentum-row-hot">
          <span className="momentum-row-label" aria-hidden="true">
            🔥
          </span>
          <span className="momentum-row-label-text">Hottest this week</span>
          <div className="momentum-chips">
            {hot.map((r) => (
              <Link
                key={r.playerId}
                href={`/live/player/${r.playerId}`}
                className="momentum-chip"
              >
                <span className="momentum-chip-name">
                  {abbreviateName(r.displayName)}
                </span>
                <span className="momentum-chip-sg">{fmt(r.sgTotal)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      {cold.length > 0 && (
        <div className="momentum-row momentum-row-cold">
          <span className="momentum-row-label" aria-hidden="true">
            🥶
          </span>
          <span className="momentum-row-label-text">Coldest</span>
          <div className="momentum-chips">
            {cold.map((r) => (
              <Link
                key={r.playerId}
                href={`/live/player/${r.playerId}`}
                className="momentum-chip momentum-chip-cold"
              >
                <span className="momentum-chip-name">
                  {abbreviateName(r.displayName)}
                </span>
                <span className="momentum-chip-sg">{fmt(r.sgTotal)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Score chip — score vs par + hole, hero-treatment in v4 rows ───

const RESULT_LABEL: Record<string, string> = {
  albatross: "ALBA",
  eagle: "EAGLE",
  birdie: "BIRDIE",
  par: "PAR",
  bogey: "BOGEY",
  double: "DOUBLE",
  "triple-plus": "BLOW-UP",
};

/** Normalise an orchestrator to-par string ("-3" / "E" / "+1") into
 *  the display form we use elsewhere — Unicode minus, "E" for level. */
function formatToPar(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (s === "E" || s === "0") return "E";
  if (s.startsWith("-")) return `−${s.slice(1)}`;
  if (s.startsWith("+")) return s;
  // Bare number with no sign — treat as plus for positives.
  const n = Number(s);
  if (Number.isFinite(n)) {
    if (n === 0) return "E";
    return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
  }
  return s;
}

function ScoreChip({ event }: { event: FeedRow["event"] }) {
  // Score chip carries the full event identity so the action sentence
  // below can be dropped. Pieces: TYPE · H{hole} · {overall to-par}.
  // The per-hole ±N is implied by the TYPE label (BOGEY = +1, etc),
  // so we surface the player's running tournament total instead —
  // far more useful for a bettor parsing the leaderboard at a glance.
  const totalDisplay = formatToPar(event.toPar);
  if (event.ace) {
    return (
      <span className="feed-row-score">
        <span className="feed-row-score-label">ACE</span>
        {event.hole && (
          <span className="feed-row-score-hole">H{event.hole}</span>
        )}
        {totalDisplay && (
          <span className="feed-row-score-num">{totalDisplay}</span>
        )}
      </span>
    );
  }
  if (
    event.type === "score" &&
    typeof event.strokes === "number" &&
    typeof event.par === "number"
  ) {
    const diff = event.strokes - event.par;
    const isBad = diff > 0;
    const label = event.result ? RESULT_LABEL[event.result] : null;
    // Per-hole fallback when the orchestrator hasn't given us an
    // overall total yet (rare — usually only mid-poll lag).
    const fallback = diff === 0
      ? "E"
      : `${diff > 0 ? "+" : "−"}${Math.abs(diff)}`;
    return (
      <span
        className={`feed-row-score${isBad ? " feed-row-score-bad" : ""}`}
      >
        {label && (
          <span className="feed-row-score-label">{label}</span>
        )}
        {event.hole && (
          <span className="feed-row-score-hole">H{event.hole}</span>
        )}
        <span className="feed-row-score-num">
          {totalDisplay ?? fallback}
        </span>
      </span>
    );
  }
  if (event.hole) {
    return (
      <span className="feed-row-score">
        <span className="feed-row-score-hole">H{event.hole}</span>
        {totalDisplay && (
          <span className="feed-row-score-num">{totalDisplay}</span>
        )}
      </span>
    );
  }
  return null;
}

// ── Hot/cold hand badge ────────────────────────────────────────────

function HandBadge({ status }: { status: "hot" | "cold" }) {
  const label =
    status === "hot"
      ? "Hot hand today — top 5 by strokes gained"
      : "Cold today — bottom 5 by strokes gained";
  return (
    <span
      className={`hand-badge hand-badge-${status}`}
      aria-label={label}
      title={label}
    >
      {status === "hot" ? "🔥" : "🥶"}
    </span>
  );
}

// ── Sharp Score chip ────────────────────────────────────────────────

function SharpScoreChip({
  stats,
}: {
  stats: FeedResponse["mySharp"] | null;
}) {
  // Three visual states — the cold state is the discovery loop for
  // brand-new visitors so we render even when total === 0:
  //   0 calls   → "Start a Sharp Score →"  (engagement hook)
  //   1–9 calls → "Sharp · 4/10 to qualify"  (progress bar style)
  //   ≥10 calls → "Sharp · 67% · 23 calls · #4"  (full stats)
  const total = stats?.total ?? 0;
  const qualified = !!stats?.qualified;
  const acc = qualified
    ? Math.round((stats?.accuracy ?? 0) * 100)
    : null;

  if (total === 0) {
    return (
      <Link
        href="/sharp"
        className="sharp-chip sharp-chip-cold"
        title="Build a credibility score from your putt-poll votes and bet outcomes"
      >
        <span className="sharp-chip-label">Sharp Score</span>
        <span className="sharp-chip-cta">Start →</span>
      </Link>
    );
  }

  return (
    <Link
      href="/sharp"
      className="sharp-chip"
      title="Your accuracy across every prediction on Pardle"
    >
      <span className="sharp-chip-label">Sharp</span>
      {acc != null ? (
        <span className="sharp-chip-acc">{acc}%</span>
      ) : (
        <span className="sharp-chip-progress">{total}/10 to qualify</span>
      )}
      {acc != null && (
        <span className="sharp-chip-calls">{total} calls</span>
      )}
      {qualified && stats?.rank != null && (
        <span className="sharp-chip-rank">#{stats.rank}</span>
      )}
    </Link>
  );
}

// ── Putt-IQ chip ────────────────────────────────────────────────────

function PuttIqChip({
  stats,
}: {
  stats: FeedResponse["myPuttIq"] | null;
}) {
  // Don't render anything until the user has cast at least one vote —
  // nobody wants to see "0/0" advertised to them.
  const tTotal = stats?.tournament?.total ?? 0;
  const tCorrect = stats?.tournament?.correct ?? 0;
  if (!stats || tTotal === 0) return null;
  const acc = tTotal > 0 ? Math.round((tCorrect / tTotal) * 100) : 0;
  const streak = stats.currentStreak;
  return (
    <Link href="/leaderboard/polls" className="puttiq-chip" title="Putt-call stats">
      <span className="puttiq-chip-num">
        {tCorrect}/{tTotal}
      </span>
      <span className="puttiq-chip-acc">{acc}%</span>
      {streak >= 2 && (
        <span className="puttiq-chip-streak" title={`${streak} in a row`}>
          🔥 {streak}
        </span>
      )}
      {typeof stats.tournamentRank === "number" && (
        <span className="puttiq-chip-rank">#{stats.tournamentRank}</span>
      )}
    </Link>
  );
}

