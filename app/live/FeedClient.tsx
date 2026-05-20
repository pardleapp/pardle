"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Burst, CachedLeaderboardRow } from "@/lib/feed/store";
import type { FeedRow } from "@/lib/feed/types";
import {
  DEFAULT_ODDS_FORMAT,
  formatOdds,
  ODDS_FORMAT_STORAGE_KEY,
  type OddsFormat,
} from "@/lib/odds-format";
import BetTracker from "./BetTracker";
import CatchMeUp from "./CatchMeUp";
import CommentThread from "./CommentThread";
import FollowButton, { getFollows } from "./FollowButton";
import LeaderboardPanel from "./LeaderboardPanel";
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
  const [view, setView] = useState<"feed" | "leaderboard">("feed");
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
      <p className="feed-empty">
        Couldn&apos;t load the feed. It&apos;ll retry automatically.
      </p>
    );
  }
  if (!data) {
    return <p className="feed-empty">Loading the feed…</p>;
  }
  if (!data.tournament) {
    return (
      <p className="feed-empty">
        No tournament on the schedule right now. Check back on a tour week.
      </p>
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
      <>
        <section className="feed-status-card">
          <h2 className="feed-tournament-name">{data.tournament.name}</h2>
          <p className="feed-empty">
            Tees off in {days} day{days === 1 ? "" : "s"}. The live feed
            fires up when the first group hits the course.
          </p>
        </section>
        <BetTracker
          players={data.playerIndex ?? []}
          currentOdds={data.currentOdds ?? {}}
          playerRoundStates={data.playerRoundStates ?? {}}
          tournamentProjections={data.tournamentProjections ?? {}}
          topFinishCurrent={data.topFinishCurrent}
          recentForm={data.recentForm}
          handStatus={data.handStatus}
          oddsFormat={oddsFormat}
          onPickOddsFormat={pickOddsFormat}
        />
      </>
    );
  }

  // ── Live feed ───────────────────────────────────────────────────
  const followSet = new Set(follows);
  const visibleRows =
    filterMode === "following"
      ? data.rows.filter((r) => followSet.has(r.event.playerId))
      : data.rows;

  return (
    <section className="feed-wrap">
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

      <nav className="feed-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === "feed"}
          className={`feed-tab ${view === "feed" ? "feed-tab-on" : ""}`}
          onClick={() => setView("feed")}
        >
          Live feed
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "leaderboard"}
          className={`feed-tab ${view === "leaderboard" ? "feed-tab-on" : ""}`}
          onClick={() => setView("leaderboard")}
        >
          Leaderboard
        </button>
      </nav>

      {view === "leaderboard" ? (
        <LeaderboardPanel
          rows={data.leaderboard ?? []}
          mode="tab"
          recentForm={data.recentForm}
          handStatus={data.handStatus}
        />
      ) : (
        <>
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

      <BetTracker
        players={data.playerIndex ?? []}
        currentOdds={data.currentOdds ?? {}}
        playerRoundStates={data.playerRoundStates ?? {}}
        tournamentProjections={data.tournamentProjections ?? {}}
        topFinishCurrent={data.topFinishCurrent}
        oddsFormat={oddsFormat}
        onPickOddsFormat={pickOddsFormat}
      />

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
          ★ Following {follows.length > 0 ? `(${follows.length})` : ""}
        </button>
      </div>

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
                  <Link
                    href={`/live/player/${event.playerId}`}
                    className="feed-body feed-body-link"
                  >
                    <p className="feed-headline">
                      {data.handStatus?.[event.playerId] && (
                        <HandBadge
                          status={data.handStatus[event.playerId]}
                        />
                      )}
                      {event.headline}
                    </p>
                    {(() => {
                      const backingPct =
                        data.communityBackingPct?.[event.playerId];
                      const showBacking =
                        typeof backingPct === "number" &&
                        (data.communityTotalBettors ?? 0) >= 5;
                      const hasAny =
                        event.tags?.length ||
                        (event.oddsBefore && event.oddsAfter) ||
                        (event.top10Before != null &&
                          event.top10After != null) ||
                        showBacking;
                      if (!hasAny) return null;
                      return (
                        <p className="feed-tags">
                          {event.tags?.map((t) => (
                            <span key={t} className="feed-tag">
                              {t}
                            </span>
                          ))}
                          {event.oddsBefore && event.oddsAfter && (
                            <span
                              className={`feed-tag feed-tag-odds ${
                                event.oddsAfter < event.oddsBefore
                                  ? "feed-tag-odds-shorten"
                                  : "feed-tag-odds-drift"
                              }`}
                              title="Win-market odds shift"
                            >
                              odds {formatOdds(event.oddsBefore, oddsFormat)} →{" "}
                              {formatOdds(event.oddsAfter, oddsFormat)}
                            </span>
                          )}
                          {event.top10Before != null &&
                            event.top10After != null && (
                              <span
                                className={`feed-tag feed-tag-odds ${
                                  event.top10After > event.top10Before
                                    ? "feed-tag-odds-shorten"
                                    : "feed-tag-odds-drift"
                                }`}
                                title="Top-10 finish probability shift"
                              >
                                top 10{" "}
                                {Math.round(event.top10Before * 100)}% →{" "}
                                {Math.round(event.top10After * 100)}%
                              </span>
                            )}
                          {showBacking && (
                            <span
                              className="feed-tag feed-tag-community"
                              title={`Backed by ${backingPct}% of Pardle bettors this week`}
                            >
                              {backingPct}% of Pardle backs him
                            </span>
                          )}
                        </p>
                      );
                    })()}
                    <p className="feed-meta">
                      R{event.round} · {timeAgo(event.ts)} · view card →
                    </p>
                  </Link>
                  {event.type === "putt-poll" && event.pollId && (
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
                      className={`feed-react ${mine === "up" ? "feed-react-on" : ""}`}
                      onClick={() => sendReaction(event.id, "up")}
                      aria-label="Like"
                    >
                      👍 {reactions.up > 0 ? reactions.up : ""}
                    </button>
                    <button
                      type="button"
                      className={`feed-react ${mine === "down" ? "feed-react-on" : ""}`}
                      onClick={() => sendReaction(event.id, "down")}
                      aria-label="Dislike"
                    >
                      👎 {reactions.down > 0 ? reactions.down : ""}
                    </button>
                    <button
                      type="button"
                      className={`feed-react ${isOpen ? "feed-react-on" : ""}`}
                      onClick={() => setExpanded(isOpen ? null : event.id)}
                      aria-label="Comments"
                    >
                      💬 {count > 0 ? count : ""}
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
        </>
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
                <span className="momentum-chip-name">{r.displayName}</span>
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
                <span className="momentum-chip-name">{r.displayName}</span>
                <span className="momentum-chip-sg">{fmt(r.sgTotal)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
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

