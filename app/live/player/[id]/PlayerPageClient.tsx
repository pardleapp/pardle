"use client";

/**
 * PlayerPageClient — redesigned player surface matching the design-
 * handoff prototype's <PlayerPage>. Replaces the older multi-component
 * player layout (PlayerHighlights / PlayerStats / PlayerSeasonView /
 * RecentHoles) for the broadcast theme.
 *
 * Header: pinned back-arrow + tournament caption.
 * Hero:   PGA Tour headshot (silhouette fallback) + name + hot/cold
 *         emoji + position line + Follow toggle.
 * Tabs:   This week / Season — only the body swaps, header stays.
 *
 * This-week tab:
 *   - Strokes gained · today block (live SG + R1-R4 chips + 4 SG
 *     buckets with centre-origin bars + field-rank pills).
 *   - Scorecard · this week — <Scorecard /> child.
 *   - Advanced grid (2x3) — driving / GIR / scrambling / proximity.
 *   - In your group — % backing + crew members on him.
 *
 * Season tab:
 *   - Season at a glance — 6-up grid.
 *   - Strokes gained · season avg.
 *   - Recent form — bar chart + tappable list. Tap → EventDetail
 *     overlay.
 *
 * Footer: Notify-on-shots toggle + ＋ Bet on {player} (deep-link
 * pre-fills add-bet flow on /bets).
 *
 * All negatives use Unicode minus; pf() in mock-player-data.ts is
 * the gatekeeper.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  PLAYER_DATA,
  SEASON,
  SEASON_SG,
  resolvePlayerKey,
  pf,
  type PlayerFormEvent,
} from "./mock-player-data";
import Scorecard from "./Scorecard";
import EventDetail from "./EventDetail";
import { pgaTourHeadshotUrlById } from "@/lib/data/pga-tour-ids";

interface Props {
  /** Route id from the URL — used to fetch the PGA headshot. The
   *  mock data is keyed by name; we use the route id only for the
   *  photo lookup. */
  playerId: string;
  /** Resolved display name when available (server passes from
   *  leaderboard lookup) — falls back to the mock key. */
  initialName?: string | null;
}

function sgBarStyle(v: number): React.CSSProperties {
  const w = Math.min(Math.abs(v) / 3, 1) * 50;
  if (v < 0) return { left: `${50 - w}%`, width: `${w}%` };
  return { left: "50%", width: `${w}%` };
}

export default function PlayerPageClient({ playerId, initialName }: Props) {
  // Stamp pv-theme-body on mount so brand bar / nav re-skin paper.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.add("pv-theme-body");
    return () => {
      document.documentElement.classList.remove("pv-theme-body");
    };
  }, []);

  // Pick the mock data slot for this player. We try the URL id
  // first (crew-post links encode the player name there), then
  // initialName (server-resolved when wired), and finally fall
  // back to Henley so the page never blanks. Real wiring replaces
  // this with a server-fetched DataGolf + orchestrator merge.
  const decodedId = (() => {
    try {
      return decodeURIComponent(playerId);
    } catch {
      return playerId;
    }
  })();
  const key = resolvePlayerKey(decodedId in PLAYER_DATA ? decodedId : initialName ?? "");
  const data = PLAYER_DATA[key];
  const season = SEASON[key];
  const seasonSg = SEASON_SG[key];
  const displayName = decodedId in PLAYER_DATA ? decodedId : initialName ?? key;

  const [tab, setTab] = useState<"week" | "season">("week");
  const [following, setFollowing] = useState(true);
  const [notifying, setNotifying] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [openEvent, setOpenEvent] = useState<PlayerFormEvent | null>(null);

  const heroHeadshot = pgaTourHeadshotUrlById(playerId, 240);

  return (
    <div className="pl-pv">
      <header className="pl-pv-head">
        <Link href="/" className="bd-pv-back" aria-label="Back">
          ←
        </Link>
        <div className="bd-pv-title">
          <div className="bd-pv-title-nm">{displayName}</div>
          <div className="bd-pv-title-mk">
            Charles Schwab Challenge · R4
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
          <div className="pl-hero-nm">
            {displayName}
            {data.hand === "hot" && <span aria-label="hot streak">🔥</span>}
            {data.hand === "cold" && <span aria-label="cold streak">🥶</span>}
          </div>
          <div className="pl-hero-pos">
            {data.pos === "1" ? "Leader" : `Pos ${data.pos}`} ·{" "}
            <b>{data.total}</b> · thru {data.thru} · today {data.today}
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
            {data.liveSg && (
              <section className="bd-sec" style={{ borderTop: "none" }}>
                <h4 className="bd-sec-h">
                  Strokes gained · today{" "}
                  <span className="pl-rank-pill pl-rank-pill-good">LIVE</span>
                </h4>
                <div className="pl-livesg">
                  <div className="pl-livesg-top">
                    <span
                      className="pl-livesg-num"
                      style={{
                        color:
                          pf(data.liveSg.num) < 0
                            ? "var(--pv-down)"
                            : "var(--pv-up)",
                      }}
                    >
                      {data.liveSg.num}
                    </span>
                    <span className="pl-livesg-meta">{data.liveSg.meta}</span>
                  </div>
                  <div className="pl-livesg-rounds">
                    {data.liveSg.rounds.map((r) => (
                      <div className="pl-livesg-rd" key={r.label}>
                        <div className="pl-livesg-rd-lbl">{r.label}</div>
                        <div
                          className="pl-livesg-rd-val"
                          style={{
                            color:
                              pf(r.value) < 0
                                ? "var(--pv-down)"
                                : "var(--pv-up)",
                          }}
                        >
                          {r.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="pl-sg-cats">
                  {data.sg.map((row) => {
                    const v = pf(row.value);
                    return (
                      <div className="sgrow" key={row.label}>
                        <span className="sgrow-lbl">{row.label}</span>
                        <span className="sgrow-track">
                          <i
                            className={
                              v < 0
                                ? "sgrow-bar sgrow-bar-neg"
                                : "sgrow-bar"
                            }
                            style={sgBarStyle(v)}
                          />
                        </span>
                        <span
                          className="sgrow-val"
                          style={{
                            color: v < 0 ? "var(--pv-down)" : "var(--pv-up)",
                          }}
                        >
                          {row.value}
                        </span>
                        <span className={`pl-rank-pill pl-rank-pill-${row.tier}`}>
                          {row.rank}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="bd-sec">
              <h4 className="bd-sec-h">Scorecard · this week</h4>
              <Scorecard />
            </section>

            {data.advanced.length > 0 && (
              <section className="bd-sec">
                <h4 className="bd-sec-h">Advanced</h4>
                <div className="pl-advgrid">
                  {data.advanced.map((a) => (
                    <div className="pl-advbox" key={a.label}>
                      <div className="pl-advbox-v">{a.value}</div>
                      <div className="pl-advbox-l">{a.label}</div>
                      <div className={`pl-advbox-r pl-advbox-r-${a.tier}`}>
                        {a.rank} in field
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="bd-sec">
              <h4 className="bd-sec-h">
                In your group
                {data.backing != null &&
                  ` · ${data.backing}% of Pardle backs him`}
              </h4>
              {data.groupBets.length > 0 ? (
                data.groupBets.map((g) => (
                  <div className="pl-gbet-row" key={g.name}>
                    <span
                      className="crew-mini-av"
                      style={{
                        width: 28,
                        height: 28,
                        fontSize: 11,
                        background: "linear-gradient(135deg,#6b7df2,#3b1f8a)",
                      }}
                      aria-hidden="true"
                    >
                      {g.initials}
                    </span>
                    <span className="pl-gbet-nm">{g.name}</span>
                    <span className="pl-gbet-desc">{g.description}</span>
                  </div>
                ))
              ) : (
                <div className="pl-gbet-empty">
                  No one in your group is on him yet.
                </div>
              )}
            </section>
          </>
        )}

        {tab === "season" && (
          <>
            {season && (
              <section className="bd-sec" style={{ borderTop: "none" }}>
                <h4 className="bd-sec-h">Season at a glance · 2025</h4>
                <div className="pl-seasongrid">
                  <div className="pl-advbox">
                    <div className="pl-advbox-v">{season.events}</div>
                    <div className="pl-advbox-l">Events</div>
                  </div>
                  <div className="pl-advbox">
                    <div className="pl-advbox-v">{season.wins}</div>
                    <div className="pl-advbox-l">Wins</div>
                  </div>
                  <div className="pl-advbox">
                    <div className="pl-advbox-v">{season.top10}</div>
                    <div className="pl-advbox-l">Top 10s</div>
                  </div>
                  <div className="pl-advbox">
                    <div className="pl-advbox-v">{season.cuts}</div>
                    <div className="pl-advbox-l">Made cut</div>
                  </div>
                  <div className="pl-advbox">
                    <div className="pl-advbox-v">{season.avg}</div>
                    <div className="pl-advbox-l">Scoring avg</div>
                  </div>
                  <div className="pl-advbox">
                    <div className="pl-advbox-v">{season.sg}</div>
                    <div className="pl-advbox-l">SG / round</div>
                  </div>
                </div>
              </section>
            )}

            {seasonSg && (
              <section className="bd-sec">
                <h4 className="bd-sec-h">Strokes gained · season avg</h4>
                {seasonSg.map(([label, value], i) => {
                  const v = pf(value);
                  const isTotal = i === 0;
                  return (
                    <div
                      className="sgrow"
                      key={label}
                      style={
                        isTotal
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
                        style={isTotal ? { fontWeight: 800 } : undefined}
                      >
                        {label}
                      </span>
                      <span className="sgrow-track">
                        <i
                          className={
                            v < 0 ? "sgrow-bar sgrow-bar-neg" : "sgrow-bar"
                          }
                          style={sgBarStyle(v)}
                        />
                      </span>
                      <span
                        className="sgrow-val"
                        style={{
                          color: v < 0 ? "var(--pv-down)" : "var(--pv-up)",
                        }}
                      >
                        {value}
                      </span>
                    </div>
                  );
                })}
              </section>
            )}

            {data.form.length > 0 && (
              <section className="bd-sec">
                <h4 className="bd-sec-h">
                  Recent form · last 6 starts
                  <span className="bd-sec-h-aux">tap to drill in</span>
                </h4>
                <div className="pl-formrow">
                  {data.form.map((f, i) => {
                    const heightPct =
                      f.pos === 0 ? 16 : Math.max(24, 100 - (f.pos - 1) * 2.4);
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`pl-formbar${f.pos === 0 ? " pl-formbar-mc" : ""}`}
                        onClick={() => setOpenEvent(f)}
                      >
                        <span
                          className="pl-formbar-fill"
                          style={{ height: `${heightPct}%` }}
                        />
                        <span className="pl-formbar-lbl">{f.fin}</span>
                      </button>
                    );
                  })}
                </div>
                <ul className="pl-formlist">
                  {data.form.map((f, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="pl-formlist-row"
                        onClick={() => setOpenEvent(f)}
                      >
                        <span
                          className={`pl-formlist-fin${f.pos === 0 ? " pl-formlist-fin-mc" : ""}`}
                        >
                          {f.fin}
                        </span>
                        <span className="pl-formlist-tt">{f.t}</span>
                        <span className="pl-formlist-yr">{f.season}</span>
                        <span className="pl-formlist-chev">›</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
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
          ＋ Bet on {displayName.split(" ").pop()}
        </Link>
      </footer>

      {openEvent && (
        <EventDetail
          ev={openEvent}
          playerName={displayName}
          onClose={() => setOpenEvent(null)}
        />
      )}
    </div>
  );
}
