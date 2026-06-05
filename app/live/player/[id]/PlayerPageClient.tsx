"use client";

/**
 * PlayerPageClient — real-data player surface.
 *
 * The page now fetches /api/feed for the live leaderboard + player
 * round state, plus /api/bet/scorecard for each round's hole-by-hole
 * strokes. We look the player up in the leaderboard by route id (the
 * orchestrator player id) — no mock fallback. Hero, position line,
 * tournament caption, and scorecard all reflect the actual player.
 *
 * Sub-blocks that the live feed doesn't carry yet (live strokes-gained
 * decomposition, advanced field-rank stats, season form/aggregates)
 * render explicit "not available yet" placeholders rather than
 * substituting another player's data.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import BackButton from "@/app/_components/BackButton";
import Scorecard, { type RoundStrokes } from "./Scorecard";
import { pgaTourHeadshotUrlById } from "@/lib/data/pga-tour-ids";

interface Props {
  playerId: string;
  initialName?: string | null;
}

interface LeaderboardRow {
  playerId: string;
  displayName: string;
  position: string;
  total: string;
  thru: string;
  playerState?: string;
}

interface PlayerRoundState {
  currentRound: number;
  holesPlayed: number;
  holesRemaining: number;
  toPar: number;
  rounds?: Record<number, { status?: string; strokes?: number; roundPar?: number; toPar?: number }>;
}

interface FeedSnapshot {
  tournament: { name: string; isLive: boolean } | null;
  leaderboard: LeaderboardRow[];
  playerRoundStates: Record<string, PlayerRoundState>;
}

interface ScorecardRound {
  holes: { holeNumber: number; par: number; strokes: number }[];
  roundPar: number;
}

interface SeasonResponse {
  found: boolean;
  displayName?: string;
  season?: {
    sgTotal: number;
    sgOtt: number;
    sgApp: number;
    sgArg: number;
    sgPutt: number;
  } | null;
  glance?: {
    eventsPlayed: number;
    wins: number;
    top10s: number;
    cutsMade: number;
    cutsMissed: number;
    scoringAvgVsPar: number | null;
    sgPerRound: number | null;
  } | null;
  form?: {
    eventId: number;
    season: number;
    tournament: string;
    date: string;
    finText: string | null;
    pos: number | null;
    roundsPlayed: number;
    totalScore: number;
    totalToPar: number;
    sgTotal: number | null;
    sgPerRound: number | null;
    keyStat: string;
  }[];
}

function fmtVsPar(n: number | null): string {
  if (n == null) return "—";
  if (Math.abs(n) < 0.05) return "E";
  return n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}

const POLL_MS = 15_000;

function fmtSg(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

function sgBarStyle(v: number): React.CSSProperties {
  const w = Math.min(Math.abs(v) / 2.5, 1) * 50;
  if (v < 0) return { left: `${50 - w}%`, width: `${w}%` };
  return { left: "50%", width: `${w}%` };
}

function todayLabel(state: PlayerRoundState | undefined): string {
  if (!state) return "—";
  const round = state.currentRound;
  const r = state.rounds?.[round];
  if (!r) return "—";
  if (typeof r.toPar !== "number" || !Number.isFinite(r.toPar)) return "—";
  if (r.toPar === 0) return "E";
  return r.toPar > 0 ? `+${r.toPar}` : String(r.toPar);
}

function thruLabel(row: LeaderboardRow | null, state: PlayerRoundState | undefined): string {
  if (row && row.thru && row.thru !== "—") return row.thru;
  if (state) {
    if (state.holesRemaining === 0) return "F";
    return String(state.holesPlayed);
  }
  return "—";
}

function positionLabel(row: LeaderboardRow | null): string {
  if (!row) return "—";
  if (row.position === "1") return "Leader";
  if (row.position) return `Pos ${row.position}`;
  return "—";
}

export default function PlayerPageClient({ playerId, initialName }: Props) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add("pv-theme-body");
    return () => {
      document.documentElement.classList.remove("pv-theme-body");
    };
  }, []);

  const [feed, setFeed] = useState<FeedSnapshot | null>(null);
  const [rounds, setRounds] = useState<(ScorecardRound | null)[]>([null, null, null, null]);
  const [season, setSeason] = useState<SeasonResponse | null>(null);
  const [tab, setTab] = useState<"week" | "season">("week");
  const [imgFailed, setImgFailed] = useState(false);
  const [following, setFollowing] = useState(true);
  const [notifying, setNotifying] = useState(false);

  // Poll /api/feed for the leaderboard + player round states. The
  // player's hero numbers (position / total / thru / today) live
  // here so they tick alongside the rest of the app.
  useEffect(() => {
    let cancel = false;
    const tick = async () => {
      try {
        const r = await fetch(
          "/api/feed?v=player&include=leaderboard,playerStates,tournament",
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const j = (await r.json()) as Partial<FeedSnapshot>;
        if (cancel) return;
        setFeed({
          tournament: j.tournament ?? null,
          leaderboard: j.leaderboard ?? [],
          playerRoundStates: j.playerRoundStates ?? {},
        });
      } catch {
        /* swallow; next tick retries */
      }
    };
    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancel = true;
      window.clearInterval(id);
    };
  }, []);

  // Season SG decomposition from DataGolf, fetched once on first
  // mount per playerId. The skill-ratings endpoint refreshes weekly
  // so there's no benefit to polling — one fetch is plenty.
  useEffect(() => {
    if (!playerId) return;
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/player/season?playerId=${encodeURIComponent(playerId)}`,
          { cache: "no-store" },
        );
        if (!r.ok) {
          if (!cancel) setSeason({ found: false });
          return;
        }
        const j = (await r.json()) as SeasonResponse;
        if (cancel) return;
        setSeason(j);
      } catch {
        if (!cancel) setSeason({ found: false });
      }
    })();
    return () => {
      cancel = true;
    };
  }, [playerId]);

  // Fetch each round's hole-by-hole scorecard in parallel. Refetched
  // whenever playerId changes; the scorecard route returns the
  // played-hole list for the orchestrator's tournament + round +
  // playerId tuple, so rounds the player hasn't reached yet come
  // back empty.
  useEffect(() => {
    if (!playerId) return;
    let cancel = false;
    (async () => {
      try {
        const results = await Promise.all(
          [1, 2, 3, 4].map(async (round) => {
            const r = await fetch(
              `/api/bet/scorecard?playerId=${encodeURIComponent(playerId)}&round=${round}`,
              { cache: "no-store" },
            );
            if (!r.ok) return null;
            const j = (await r.json()) as ScorecardRound;
            return j;
          }),
        );
        if (cancel) return;
        setRounds(results);
      } catch {
        /* leave as nulls */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [playerId]);

  const leaderboardRow =
    feed?.leaderboard.find((r) => r.playerId === playerId) ?? null;
  const state = feed?.playerRoundStates?.[playerId];
  const displayName =
    leaderboardRow?.displayName ?? initialName ?? "Loading…";

  const heroHeadshot = pgaTourHeadshotUrlById(playerId, 240);

  // Build the par-per-hole array from the first round that returned
  // hole data (par is fixed across rounds for a given course). The
  // first round to play tees off Thursday → R1 is usually our best
  // source, but if R1 didn't return for whatever reason fall back to
  // whichever round did.
  const parPerHole: number[] = (() => {
    for (const r of rounds) {
      if (!r || r.holes.length === 0) continue;
      const arr = new Array(18).fill(4);
      for (const h of r.holes) {
        if (h.holeNumber >= 1 && h.holeNumber <= 18) {
          arr[h.holeNumber - 1] = h.par;
        }
      }
      return arr;
    }
    return new Array(18).fill(4);
  })();

  const roundStrokes: RoundStrokes[] = rounds.map((r) => {
    const out: (number | null)[] = new Array(18).fill(null);
    if (!r) return out;
    for (const h of r.holes) {
      if (h.holeNumber >= 1 && h.holeNumber <= 18) {
        out[h.holeNumber - 1] = h.strokes;
      }
    }
    return out;
  });

  const anyScorecardData = roundStrokes.some((r) => r.some((v) => v != null));
  const tournamentCaption = feed?.tournament?.name ?? "Tournament";
  const roundCaption =
    state?.currentRound != null && state.currentRound > 0
      ? ` · R${state.currentRound}`
      : "";

  return (
    <div className="pl-pv">
      <header className="pl-pv-head">
        <BackButton fallback="/" className="bd-pv-back" />
        <div className="bd-pv-title">
          <div className="bd-pv-title-nm">{displayName}</div>
          <div className="bd-pv-title-mk">
            {tournamentCaption}
            {roundCaption}
          </div>
        </div>
      </header>

      <section className="pl-hero">
        <span className="pl-hero-av" aria-hidden="true">
          {!imgFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroHeadshot}
              alt=""
              onError={() => setImgFailed(true)}
            />
          ) : (
            <svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.9)">
              <circle cx="12" cy="8.4" r="3.9" />
              <path d="M4.5 21c0-4.3 3.4-6.8 7.5-6.8s7.5 2.5 7.5 6.8z" />
            </svg>
          )}
        </span>
        <div className="pl-hero-body">
          <div className="pl-hero-nm">{displayName}</div>
          <div className="pl-hero-pos">
            {positionLabel(leaderboardRow)} ·{" "}
            <b>{leaderboardRow?.total ?? "—"}</b> · thru{" "}
            {thruLabel(leaderboardRow, state)} · today{" "}
            {todayLabel(state)}
          </div>
        </div>
        <button
          type="button"
          className={`pl-follow${following ? " pl-follow-on" : ""}`}
          onClick={() => setFollowing((v) => !v)}
        >
          {following ? "Following ★" : "Follow"}
        </button>
      </section>

      <nav className="pl-tabs" role="tablist" aria-label="Player view">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "week"}
          className={tab === "week" ? "on" : ""}
          onClick={() => setTab("week")}
        >
          This week
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "season"}
          className={tab === "season" ? "on" : ""}
          onClick={() => setTab("season")}
        >
          Season
        </button>
      </nav>

      <div className="pl-pv-body">
        {tab === "week" && (
          <>
            <section className="bd-sec" style={{ borderTop: "none" }}>
              <h4 className="bd-sec-h">Scorecard · this week</h4>
              {anyScorecardData ? (
                <Scorecard rounds={roundStrokes} pars={parPerHole} />
              ) : (
                <div className="pl-empty">
                  No holes scored yet this week. Card fills in as the
                  round plays.
                </div>
              )}
            </section>

            <section className="bd-sec">
              <h4 className="bd-sec-h">Strokes gained · this week</h4>
              <div className="pl-empty">
                Live strokes-gained for this player isn't wired into
                the tracker yet. The leaderboard total above reflects
                the current round in real time.
              </div>
            </section>

            <section className="bd-sec">
              <h4 className="bd-sec-h">Advanced</h4>
              <div className="pl-empty">
                Field-rank stats (driving, GIR, scrambling, proximity)
                will land alongside the full per-player SG feed.
              </div>
            </section>
          </>
        )}

        {tab === "season" && (
          <>
            <section className="bd-sec" style={{ borderTop: "none" }}>
              <h4 className="bd-sec-h">
                Strokes gained · season{" "}
                <span className="bd-sec-h-aux">
                  per round vs the field
                </span>
              </h4>
              {season == null ? (
                <div className="pl-empty">Loading…</div>
              ) : !season.found || !season.season ? (
                <div className="pl-empty">
                  Season SG isn&apos;t available for this player yet.
                  Ratings refresh weekly and only cover players who
                  have played enough recent rounds to estimate.
                </div>
              ) : (
                <>
                  {[
                    { label: "Total", value: season.season.sgTotal, isTotal: true },
                    { label: "Off the tee", value: season.season.sgOtt },
                    { label: "Approach", value: season.season.sgApp },
                    { label: "Around green", value: season.season.sgArg },
                    { label: "Putting", value: season.season.sgPutt },
                  ].map((row) => (
                    <div
                      className="sgrow"
                      key={row.label}
                      style={
                        row.isTotal
                          ? {
                              marginBottom: 14,
                              paddingBottom: 11,
                              borderBottom: "1px solid var(--pv-line)",
                            }
                          : undefined
                      }
                    >
                      <span
                        className="sgrow-lbl"
                        style={row.isTotal ? { fontWeight: 800 } : undefined}
                      >
                        {row.label}
                      </span>
                      <span className="sgrow-track">
                        <i
                          className={
                            row.value < 0
                              ? "sgrow-bar sgrow-bar-neg"
                              : "sgrow-bar"
                          }
                          style={sgBarStyle(row.value)}
                        />
                      </span>
                      <span
                        className="sgrow-val"
                        style={{
                          color:
                            row.value < 0
                              ? "var(--pv-down)"
                              : "var(--pv-up)",
                        }}
                      >
                        {fmtSg(row.value)}
                      </span>
                    </div>
                  ))}
                  <p className="bd-sec-foot">
                    Skill ratings refreshed weekly — the same numbers
                    the bet tracker uses as its skill prior.
                  </p>
                </>
              )}
            </section>

            <section className="bd-sec">
              <h4 className="bd-sec-h">Season at a glance</h4>
              {season?.glance == null ? (
                <div className="pl-empty">
                  No season events on file for this player yet.
                </div>
              ) : (
                <div className="pl-seasongrid">
                  <div className="pl-advbox">
                    <div className="pl-advbox-v">
                      {season.glance.eventsPlayed}
                    </div>
                    <div className="pl-advbox-l">Events</div>
                  </div>
                  <div className="pl-advbox">
                    <div className="pl-advbox-v">{season.glance.wins}</div>
                    <div className="pl-advbox-l">Wins</div>
                  </div>
                  <div className="pl-advbox">
                    <div className="pl-advbox-v">
                      {season.glance.top10s}
                    </div>
                    <div className="pl-advbox-l">Top 10s</div>
                  </div>
                  <div className="pl-advbox">
                    <div className="pl-advbox-v">
                      {season.glance.cutsMade}/
                      {season.glance.eventsPlayed}
                    </div>
                    <div className="pl-advbox-l">Made cut</div>
                  </div>
                  <div className="pl-advbox">
                    <div className="pl-advbox-v">
                      {fmtVsPar(season.glance.scoringAvgVsPar)}
                    </div>
                    <div className="pl-advbox-l">Scoring avg</div>
                  </div>
                  <div className="pl-advbox">
                    <div className="pl-advbox-v">
                      {fmtSg(season.glance.sgPerRound ?? NaN)}
                    </div>
                    <div className="pl-advbox-l">SG / round</div>
                  </div>
                </div>
              )}
            </section>

            <section className="bd-sec">
              <h4 className="bd-sec-h">
                Recent form
                {season?.form && season.form.length > 0 && (
                  <span className="bd-sec-h-aux">
                    last {season.form.length} starts · tap to drill in
                  </span>
                )}
              </h4>
              {!season?.form || season.form.length === 0 ? (
                <div className="pl-empty">
                  No completed events for this player yet this season.
                </div>
              ) : (
                <>
                  <div className="pl-formrow">
                    {season.form.map((f) => {
                      const heightPct =
                        f.pos == null
                          ? 16
                          : Math.max(24, 100 - (f.pos - 1) * 2.4);
                      return (
                        <Link
                          key={f.eventId}
                          href={`/live/player/${encodeURIComponent(playerId)}/t/${f.season}/${f.eventId}?name=${encodeURIComponent(displayName)}`}
                          className={`pl-formbar${f.pos == null ? " pl-formbar-mc" : ""}`}
                        >
                          <span
                            className="pl-formbar-fill"
                            style={{ height: `${heightPct}%` }}
                          />
                          <span className="pl-formbar-lbl">
                            {f.finText ?? "—"}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                  <ul className="pl-formlist">
                    {season.form.map((f) => (
                      <li key={f.eventId}>
                        <Link
                          href={`/live/player/${encodeURIComponent(playerId)}/t/${f.season}/${f.eventId}?name=${encodeURIComponent(displayName)}`}
                          className="pl-formlist-row"
                        >
                          <span
                            className={`pl-formlist-fin${f.pos == null ? " pl-formlist-fin-mc" : ""}`}
                          >
                            {f.finText ?? "—"}
                          </span>
                          <span className="pl-formlist-tt">
                            {f.tournament}
                          </span>
                          <span className="pl-formlist-yr">{f.season}</span>
                          <span className="pl-formlist-chev">›</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </>
        )}
      </div>

      <footer className="pl-pv-foot">
        <button
          type="button"
          className={`pl-notify${notifying ? " pl-notify-on" : ""}`}
          onClick={() => setNotifying((v) => !v)}
        >
          {notifying ? "🔔 Notifying" : "🔔 Notify on his shots"}
        </button>
        <Link
          href={`/bets?addFor=${encodeURIComponent(displayName)}`}
          className="pl-bet"
        >
          ＋ Bet on {displayName.split(" ").pop() ?? displayName}
        </Link>
      </footer>
    </div>
  );
}
