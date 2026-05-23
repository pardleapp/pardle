"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import type { Burst, CachedLeaderboardRow } from "@/lib/feed/store";
import type { FeedRow } from "@/lib/feed/types";
import {
  DEFAULT_ODDS_FORMAT,
  formatOdds,
  ODDS_FORMAT_STORAGE_KEY,
  type OddsFormat,
} from "@/lib/odds-format";
import CatchMeUp from "./CatchMeUp";
import CommentThread from "./CommentThread";
import FollowButton, { getFollows } from "./FollowButton";
import { abbreviateName } from "@/lib/text/abbreviate";
import { readBets, type TrackedBet } from "./bet-shared";
import {
  betKindShortLabel,
  formatImpactGbp,
  headlineImpactForEvent,
} from "./bet-impact";
import PlayerAvatar from "./PlayerAvatar";
import PlayerSearch from "./PlayerSearch";
import PuttPollWidget from "./PuttPollWidget";
import ReelGroup from "./ReelGroup";

// Faster ticks during live play so the feed feels close to real-time
// alongside the IMG-ingest path; visibility-gated below so a backgrounded
// tab doesn't keep burning Upstash quota.
const REFRESH_MS = 3_000;
const REFRESH_MS_HIDDEN = 30_000;
const AUTHOR_KEY_STORAGE = "pardle_feed_author";
const BURST_EMOJIS = ["🔥", "😱", "⛳", "👏", "💀", "🐐"];
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
}

export default function FeedClient({ forcedTournamentId }: FeedClientProps = {}) {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [error, setError] = useState(false);
  const [myReactions, setMyReactions] = useState<
    Record<string, "up" | "down">
  >({});
  // Optimistic putt-poll state — overlays server data for instant
  // feedback when the user clicks yes/no. Keyed by pollId.
  const [myPollVotes, setMyPollVotes] = useState<
    Record<string, "yes" | "no">
  >({});
  const [pollCounts, setPollCounts] = useState<
    Record<string, { yes: number; no: number }>
  >({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>(
    {},
  );
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [filterMode, setFilterMode] = useState<"all" | "following">("all");
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

  useEffect(() => {
    authorKey.current = getAuthorKey();
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
    } catch {
      setError(true);
    }
  }, [spawnFloater, forcedTournamentId]);

  useEffect(() => {
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
  }, [load]);

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

  async function sendReaction(eventId: string, dir: "up" | "down") {
    setMyReactions((m) => ({ ...m, [eventId]: dir }));
    setData((d) => {
      if (!d) return d;
      return {
        ...d,
        rows: d.rows.map((row) => {
          if (row.event.id !== eventId) return row;
          const prev = myReactions[eventId];
          const r = { ...row.reactions };
          if (prev === dir) return row;
          if (prev === "up") r.up = Math.max(0, r.up - 1);
          if (prev === "down") r.down = Math.max(0, r.down - 1);
          r[dir] += 1;
          return { ...row, reactions: r };
        }),
      };
    });
    try {
      await fetch("/api/feed/react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, dir, authorKey: authorKey.current }),
      });
    } catch {
      /* optimistic update stays; next refresh corrects it */
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
        // Poll closed or rate-limited — revert.
        setMyPollVotes((m) => {
          const out = { ...m };
          delete out[pollId];
          return out;
        });
        setPollCounts((m) => ({ ...m, [pollId]: baseCounts }));
      }
    } catch {
      // Network blip — leave optimistic state; next refresh corrects.
    }
  }

  // ── Empty / loading / not-live states ───────────────────────────
  if (error && !data) {
    return (
      <section className="feed-wrap v4-theme">
        <p className="feed-empty">
          Couldn&apos;t load the feed. It&apos;ll retry automatically.
        </p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="feed-wrap v4-theme">
        <p className="feed-empty">Loading the feed…</p>
      </section>
    );
  }
  if (!data.tournament) {
    return (
      <section className="feed-wrap v4-theme">
        <p className="feed-empty">
          No tournament on the schedule right now. Check back on a tour week.
        </p>
      </section>
    );
  }
  if (!data.tournament.isLive) {
    const days = Math.max(
      0,
      Math.ceil((data.tournament.startDate - Date.now()) / 86_400_000),
    );
    // Show the countdown AND the bet tracker — users want to see
    // their bets (especially recently-settled ones from the last
    // tournament) regardless of whether the next event is live yet.
    return (
      <section className="feed-wrap v4-theme">
        <section className="feed-status-card">
          <h2 className="feed-tournament-name">{data.tournament.name}</h2>
          <p className="feed-empty">
            Tees off in {days} day{days === 1 ? "" : "s"}. The live feed
            fires up when the first group hits the course.
          </p>
        </section>
      </section>
    );
  }

  // ── Live feed ───────────────────────────────────────────────────
  const followSet = new Set(follows);
  const visibleRows =
    filterMode === "following"
      ? data.rows.filter((r) => followSet.has(r.event.playerId))
      : data.rows;

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
    <section className="feed-wrap v4-theme">
      <div className="feed-header-row">
        <h2 className="feed-tournament-name">
          <span
            className="feed-live-pulse feed-live-pulse-inline"
            aria-label="Live"
            title="Live"
          />
          {data.tournament.name}
        </h2>
        <PuttIqChip stats={data.myPuttIq ?? null} />
      </div>

      <PlayerSearch players={data.playerIndex ?? []} />

      <MomentumStrip momentum={data.fieldMomentum} />

      <CatchMeUp rows={data.rows ?? []} />

      <ReelGroup
        panes={[
          {
            key: "best",
            title: "⛳ Shots of the day",
            rows: data.bestReel ?? [],
          },
          {
            key: "worst",
            title: "💀 Worst of the day",
            rows: data.worstReel ?? [],
          },
        ]}
        myReactions={myReactions}
        onReact={sendReaction}
        storageKey="homefeed"
      />

      {/* Following toggle — bet relevance now surfaces inline as a
          per-row £ impact chip rather than a whole separate feed. */}
      {follows.length > 0 && (
        <div className="feed-filter-row">
          <button
            type="button"
            className={`feed-filter-btn ${filterMode === "all" ? "feed-filter-on" : ""}`}
            onClick={() => setFilterMode("all")}
          >
            All shots
          </button>
          <button
            type="button"
            className={`feed-filter-btn ${filterMode === "following" ? "feed-filter-on" : ""}`}
            onClick={() => setFilterMode("following")}
          >
            ★ Following ({follows.length})
          </button>
        </div>
      )}

      {data.rows.length === 0 ? (
        <p className="feed-empty">
          Feed is warming up — first scores will appear here within a
          minute or two of the groups going out.
        </p>
      ) : filterMode === "following" && visibleRows.length === 0 ? (
        <p className="feed-empty">
          {follows.length === 0
            ? "You're not following anyone yet. Tap a player's name to open their card and follow them."
            : "No shots from the players you follow yet — they'll show here."}
        </p>
      ) : (
        <ul className="feed-list">
          {visibleRows.map(({ event, reactions, commentCount }) => {
            const mine = myReactions[event.id];
            const isOpen = expanded === event.id;
            const count = commentCounts[event.id] ?? commentCount;
            return (
              <li
                key={event.id}
                className={`feed-row-wrap ${isOpen ? "feed-row-wrap-open" : ""}`}
              >
                <div
                  className={`feed-row ${
                    event.type === "shot"
                      ? `feed-row-shot${event.highlight ? " feed-row-shot-good" : ""}${event.lowlight ? " feed-row-shot-bad" : ""}`
                      : `feed-row-${event.result ?? "other"}`
                  }`}
                >
                  <span className="feed-emoji" aria-hidden="true">
                    {event.emoji}
                  </span>
                  <PlayerAvatar
                    playerId={event.playerId}
                    playerName={event.playerName}
                    size="md"
                    state={data.handStatus?.[event.playerId] ?? null}
                  />
                  <Link
                    href={`/live/player/${event.playerId}`}
                    className="feed-body feed-body-link"
                  >
                    <div className="feed-row-head">
                      <span className="feed-row-name">
                        {abbreviateName(event.playerName)}
                        {data.handStatus?.[event.playerId] && (
                          <HandBadge
                            status={data.handStatus[event.playerId]}
                          />
                        )}
                      </span>
                      <ScoreChip event={event} />
                    </div>
                    {/* Action sentence only on events whose score chip
                        can't carry the full identity — shots and polls.
                        Score events (birdie/eagle/bogey/etc.) get the
                        result label baked into the chip itself, so a
                        duplicate "Birdies the 14th" line would be noise. */}
                    {event.type !== "score" && (
                      <p className="feed-row-action">
                        {stripPlayerName(event.headline, event.playerName)}
                      </p>
                    )}
                    {(() => {
                      const backingPct =
                        data.communityBackingPct?.[event.playerId];
                      const showBacking =
                        typeof backingPct === "number" &&
                        (data.communityTotalBettors ?? 0) >= 5;
                      // Build a single chip list, then cap at 2 — keeps
                      // mobile rows from wrapping to 3-4 chip lines.
                      // Priority: bet-relevance (your bet), odds shift,
                      // top-10 shift, context tags, community backing.
                      const chips: Array<JSX.Element> = [];
                      // PnL impact chip — fires only when this event
                      // materially moved one of the user's tracked
                      // bets. Computed per row from the engine-baked
                      // oddsBefore/After + top10Before/After deltas
                      // (precise for outright + top-10) or a per-stroke
                      // heuristic for round-score. Direct: event player
                      // is the bet player; indirect: a top-of-leaderboard
                      // competitor moved your guy's prob via market
                      // redistribution. Chip carries the actual £ swing.
                      const impact =
                        trackedBets.length > 0
                          ? headlineImpactForEvent(event, trackedBets, {
                              currentOdds: data.currentOdds,
                              leaderboard: data.leaderboard,
                            })
                          : null;
                      if (impact) {
                        const positive = impact.deltaValue >= 0;
                        const indirect = impact.source === "indirect";
                        const emoji = positive
                          ? indirect
                            ? "🎯"
                            : "🚀"
                          : "💀";
                        const kindLabel = betKindShortLabel(impact.bet);
                        const verb = indirect
                          ? positive
                            ? "lifts"
                            : "hurts"
                          : "on";
                        chips.push(
                          <Link
                            key="impact"
                            href={`/live/bet/${impact.bet.id}`}
                            className={`feed-tag feed-tag-impact ${
                              positive
                                ? "feed-tag-impact-up"
                                : "feed-tag-impact-down"
                            }`}
                            title={
                              indirect
                                ? `Competitor moved the market — estimated ${formatImpactGbp(impact.deltaValue)} on your ${kindLabel}`
                                : `${formatImpactGbp(impact.deltaValue)} change to your ${kindLabel}`
                            }
                          >
                            {emoji} {formatImpactGbp(impact.deltaValue)} {verb} your {kindLabel}
                          </Link>,
                        );
                      }
                      if (event.oddsBefore && event.oddsAfter) {
                        chips.push(
                          <span
                            key="odds"
                            className={`feed-tag feed-tag-odds ${
                              event.oddsAfter < event.oddsBefore
                                ? "feed-tag-odds-shorten"
                                : "feed-tag-odds-drift"
                            }`}
                            title="Win-market odds shift"
                          >
                            odds {formatOdds(event.oddsBefore, oddsFormat)} →{" "}
                            {formatOdds(event.oddsAfter, oddsFormat)}
                          </span>,
                        );
                      }
                      if (
                        event.top10Before != null &&
                        event.top10After != null
                      ) {
                        chips.push(
                          <span
                            key="top10"
                            className={`feed-tag feed-tag-odds ${
                              event.top10After > event.top10Before
                                ? "feed-tag-odds-shorten"
                                : "feed-tag-odds-drift"
                            }`}
                            title="Top-10 finish probability shift"
                          >
                            top 10 {Math.round(event.top10Before * 100)}% →{" "}
                            {Math.round(event.top10After * 100)}%
                          </span>,
                        );
                      }
                      for (const t of event.tags ?? []) {
                        // Deprecated chip strings — old events in the
                        // Redis-cached feed list still carry these in
                        // their baked-in tags array. Filter them at
                        // render time so they don't show until those
                        // events naturally scroll off (~24h).
                        if (
                          /^\d+ of last \d+ in red$/.test(t) ||
                          /^top \d+ in field today$/.test(t) ||
                          /^among most /.test(t)
                        ) {
                          continue;
                        }
                        chips.push(
                          <span key={`tag-${t}`} className="feed-tag">
                            {t}
                          </span>,
                        );
                      }
                      if (showBacking) {
                        chips.push(
                          <span
                            key="backing"
                            className="feed-tag feed-tag-community"
                            title={`Backed by ${backingPct}% of Pardle bettors this week`}
                          >
                            {backingPct}% of Pardle backs him
                          </span>,
                        );
                      }
                      if (chips.length === 0) return null;
                      // Cap at 2 visible chips. Extras are dropped on
                      // mobile (the data is still surfaced on the bet
                      // detail card for tracked bets).
                      const visible = chips.slice(0, 2);
                      return <p className="feed-tags">{visible}</p>;
                    })()}
                    <p className="feed-meta">
                      R{event.round} · {timeAgo(event.ts)}
                    </p>
                  </Link>
                  {event.type === "putt-poll" &&
                    event.pollId &&
                    // Latest open poll → render widget for live voting.
                    // Closed poll → render widget showing the result.
                    // Older open poll (putt already struck offscreen) → skip.
                    (event.pollId === latestOpenPollId ||
                      data.puttPolls?.[event.pollId]?.closedAt != null) && (
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
                  <div className="feed-actions">
                    <button
                      type="button"
                      className={`feed-react ${mine === "up" ? "feed-react-on" : ""} ${reactions.up === 0 && mine !== "up" ? "feed-react-zero" : ""}`}
                      onClick={() => sendReaction(event.id, "up")}
                      aria-label="Like"
                    >
                      <IconThumbUp />
                      {reactions.up > 0 && (
                        <span className="feed-react-count">{reactions.up}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      className={`feed-react ${mine === "down" ? "feed-react-on" : ""} ${reactions.down === 0 && mine !== "down" ? "feed-react-zero" : ""}`}
                      onClick={() => sendReaction(event.id, "down")}
                      aria-label="Dislike"
                    >
                      <IconThumbDown />
                      {reactions.down > 0 && (
                        <span className="feed-react-count">{reactions.down}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      className={`feed-react ${isOpen ? "feed-react-on" : ""} ${count === 0 && !isOpen ? "feed-react-zero" : ""}`}
                      onClick={() => setExpanded(isOpen ? null : event.id)}
                      aria-label="Comments"
                    >
                      <IconComment />
                      {count > 0 && (
                        <span className="feed-react-count">{count}</span>
                      )}
                    </button>
                    <FollowButton
                      playerId={event.playerId}
                      playerName={event.playerName}
                      variant="icon"
                    />
                  </div>
                </div>
                {isOpen && (
                  <CommentThread
                    eventId={event.id}
                    authorKey={authorKey.current}
                    onCountChange={(c) =>
                      setCommentCounts((m) => ({ ...m, [event.id]: c }))
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="feed-footnote">
        Live PGA Tour scoring · auto-refreshes every 15s · usually within
        ~30s of the course
      </p>

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

      {/* Burst reaction bar — sticky at the bottom */}
      <div className="feed-burst-bar">
        {BURST_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            className="feed-burst-btn"
            onClick={() => sendBurst(e)}
            aria-label={`React ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </section>
  );
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

// ── Inline icons for reaction buttons ─────────────────────────────

function IconThumbUp() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 22V11" />
      <path d="M5 11h2" />
      <path d="M7 11h7l2-2 0-4a2 2 0 0 1 2 2v4l-1 2h4a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 1H7" />
    </svg>
  );
}

function IconThumbDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 2v11" />
      <path d="M19 13h-2" />
      <path d="M17 13h-7l-2 2 0 4a2 2 0 0 0 2 2 2 2 0 0 0 2-2v-4l1-2H7a2 2 0 0 0-2-2L7 2a2 2 0 0 0 2-1h8" transform="translate(0,0)" />
    </svg>
  );
}

function IconComment() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
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

function ScoreChip({ event }: { event: FeedRow["event"] }) {
  // Three pieces on score events: TYPE · H{hole} · {±n}. Carries the
  // full event identity so the action sentence below can be dropped,
  // saving a line per row.
  if (event.ace) {
    return (
      <span className="feed-row-score">
        <span className="feed-row-score-label">ACE</span>
        {event.hole && (
          <span className="feed-row-score-hole">H{event.hole}</span>
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
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
    const value = diff === 0 ? "E" : `${sign}${Math.abs(diff)}`;
    const isBad = diff > 0;
    const label = event.result ? RESULT_LABEL[event.result] : null;
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
        <span className="feed-row-score-num">{value}</span>
      </span>
    );
  }
  if (event.hole) {
    return (
      <span className="feed-row-score">
        <span className="feed-row-score-hole">H{event.hole}</span>
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

