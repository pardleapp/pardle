"use client";

/**
 * Interactive simulations for the onboarding modal's second step.
 * Each intent gets a bespoke animation that shows — not tells —
 * what the corresponding surface actually does.
 *
 *   BetSimulation      — a live-drawing win-probability chart
 *                        driven by a scripted shot-by-shot script,
 *                        with a rolling event ticker and PnL that
 *                        updates on every shot.
 *   LiveFeedSimulation — a mini feed with shot cards streaming in
 *                        top-down and reaction counters ticking up.
 *   ToolsSimulation    — a mini ranking that fills in one row at
 *                        a time, showing predicted Event Δ
 *                        counting up for each player.
 *
 * All three run on the same animation timer so they don't drift.
 * Kept in one file (not one-per-sim) because the modal only ever
 * shows one at a time; splitting further would just add import
 * ceremony without buying anything.
 */

import { useEffect, useMemo, useState } from "react";

// ── Palette ────────────────────────────────────────────────────────
//
// Sim cards use a dark "mission control" theme — deep near-black
// panel with saturated neon accents. The rest of the modal stays
// light warm-paper per CLAUDE.md's design-handoff rule; the dark
// panel is scoped to the sim itself so the app's main theme is
// untouched.
//
// Dark tokens (inside the bet + live sim panels):
const D_BG = "oklch(0.19 0.02 155)";
const D_BG_LO = "oklch(0.14 0.015 155)";
const D_PANEL = "oklch(0.22 0.02 155)";
const D_INK = "oklch(0.96 0.008 150)";
const D_MUTED = "oklch(0.72 0.02 150)";
const D_DIM = "oklch(0.55 0.02 150)";
const D_LINE = "oklch(0.36 0.02 150)";

// Light tokens (used inside the tools walkthrough, which mirrors
// the real Pardle UI rather than the mission-control aesthetic):
const L_CARD = "oklch(0.995 0.004 95)";
const L_SOFT = "oklch(0.945 0.012 95)";
const L_LINE = "oklch(0.90 0.013 95)";
const L_INK = "oklch(0.26 0.04 155)";
const L_MUTED = "oklch(0.50 0.02 150)";
const L_DIM = "oklch(0.62 0.018 150)";
const L_UP = "oklch(0.50 0.13 155)";
const L_DOWN = "oklch(0.60 0.19 30)";
const L_EMERALD_TINT = "oklch(0.96 0.04 155)";
const L_BLUE = "oklch(0.55 0.14 245)";
const L_BLUE_TINT = "oklch(0.965 0.04 240)";

// Accents — kept saturated so they bloom against the dark panel.
const EMERALD = "oklch(0.72 0.19 155)";
const EMERALD_D = "oklch(0.50 0.14 155)";
const EMERALD_TINT = "oklch(0.30 0.10 155)";
const EMERALD_GLOW = "oklch(0.72 0.19 155 / 0.55)";
const TANG = "oklch(0.75 0.20 45)";
const TANG_D = "oklch(0.60 0.18 45)";
const TANG_TINT = "oklch(0.32 0.12 45)";
const TANG_GLOW = "oklch(0.75 0.20 45 / 0.55)";
const BLUE = "oklch(0.72 0.16 235)";
const BLUE_D = "oklch(0.55 0.14 245)";
const BLUE_TINT = "oklch(0.30 0.10 240)";
const BLUE_GLOW = "oklch(0.72 0.16 235 / 0.55)";
const DOWN = "oklch(0.74 0.20 25)";
const DOWN_TINT = "oklch(0.30 0.12 25)";

// ── BET TRACKER SIMULATION ────────────────────────────────────────

/**
 * Scripted 4-round arc for a Top-10 outright bet.
 * `p` = win probability (%), one value per animation tick (400 ms).
 * Every ~4-6 ticks a scripted shot event fires with a delta annotation.
 *
 * Total: 40 ticks × 400 ms = 16 s per full pass, then a 2 s pause
 * and the whole thing rewinds.
 */
interface Tick {
  p: number;
  round: 1 | 2 | 3 | 4;
  /** Text that flashes in the ticker when this tick lands.
   *  Undefined = no ticker event this tick (probability just drifted). */
  event?: string;
  /** Delta annotation shown in the ticker; tint follows sign. */
  delta?: number;
}

const BET_SCRIPT: Tick[] = [
  { p: 45, round: 1, event: "R1 tee off · Scheffler off #10", delta: 0 },
  { p: 47, round: 1 },
  { p: 48, round: 1, event: "Birdie · #14", delta: 3 },
  { p: 46, round: 1, event: "Bogey · #17", delta: -2 },
  { p: 48, round: 1 },
  { p: 51, round: 1, event: "Birdie · #4", delta: 3 },
  { p: 50, round: 1 },
  { p: 52, round: 1 },
  { p: 55, round: 1, event: "Birdie · #8 (–3 R1)", delta: 3 },
  { p: 54, round: 1 },
  { p: 54, round: 2 },
  { p: 57, round: 2, event: "R2: birdie #2", delta: 3 },
  { p: 55, round: 2 },
  { p: 58, round: 2, event: "Birdie · #7", delta: 3 },
  { p: 61, round: 2, event: "Eagle · #15", delta: 7 },
  { p: 60, round: 2 },
  { p: 63, round: 2, event: "Birdie · #17 (T6, –8)", delta: 3 },
  { p: 62, round: 2 },
  { p: 65, round: 2 },
  { p: 64, round: 2 },
  { p: 64, round: 3 },
  { p: 61, round: 3, event: "R3: bogey #2", delta: -3 },
  { p: 62, round: 3 },
  { p: 65, round: 3, event: "Birdie · #6", delta: 3 },
  { p: 66, round: 3 },
  { p: 68, round: 3, event: "Birdie · #11 (T5)", delta: 2 },
  { p: 70, round: 3 },
  { p: 68, round: 3 },
  { p: 71, round: 3, event: "Birdie · #17", delta: 3 },
  { p: 68, round: 3 },
  { p: 68, round: 4 },
  { p: 74, round: 4, event: "R4: hot start, –2 thru 4", delta: 6 },
  { p: 72, round: 4 },
  { p: 76, round: 4, event: "Birdie · #12", delta: 4 },
  { p: 74, round: 4 },
  { p: 80, round: 4, event: "Birdie · #14 (T7)", delta: 6 },
  { p: 78, round: 4 },
  { p: 86, round: 4, event: "Birdie · #16 → T10 clinched", delta: 8 },
  { p: 89, round: 4 },
  { p: 92, round: 4, event: "Signs card · finishes T9 · +£25 win", delta: 3 },
];

const BET_STAKE = 10;
const BET_ODDS = 3.5;

export function BetSimulation() {
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setTick((t) => {
        if (t >= BET_SCRIPT.length - 1) {
          // Hold at the end for 2s, then rewind.
          window.setTimeout(() => setTick(0), 2000);
          return t;
        }
        return t + 1;
      });
    }, 400);
    return () => window.clearInterval(id);
  }, [running]);

  const currentProb = BET_SCRIPT[tick]?.p ?? BET_SCRIPT[0].p;
  // Derive the latest event synchronously from the current tick.
  // Previous impl used a ref that got out of sync with tick after a
  // loop reset — the ticker would show the FINAL event while tick
  // was already back at 0. Deriving inline via a memo guarantees the
  // event, prob, and round always agree.
  const eventTick = useMemo(() => {
    for (let i = tick; i >= 0; i--) {
      if (BET_SCRIPT[i]?.event) return BET_SCRIPT[i];
    }
    return BET_SCRIPT[0];
  }, [tick]);

  // Path built from the played portion of the script.
  const svgW = 320;
  const svgH = 108;
  const padX = 8;
  const padY = 10;

  const chartPoints = useMemo(() => {
    const pts: Array<{ x: number; y: number }> = [];
    const played = BET_SCRIPT.slice(0, tick + 1);
    for (let i = 0; i < played.length; i++) {
      const x =
        padX +
        (i / (BET_SCRIPT.length - 1)) * (svgW - padX * 2);
      const y =
        padY +
        (1 - played[i].p / 100) * (svgH - padY * 2);
      pts.push({ x, y });
    }
    return pts;
  }, [tick]);

  const chartPath = useMemo(() => {
    if (chartPoints.length === 0) return "";
    return chartPoints
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(" ");
  }, [chartPoints]);

  const areaPath = useMemo(() => {
    if (chartPoints.length === 0) return "";
    const first = chartPoints[0];
    const last = chartPoints[chartPoints.length - 1];
    return (
      `M ${first.x} ${svgH - padY} ` +
      chartPoints.map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ") +
      ` L ${last.x} ${svgH - padY} Z`
    );
  }, [chartPoints]);

  const currentPoint = chartPoints[chartPoints.length - 1];

  // Expected return calc — approximate PnL from win prob.
  const expectedReturn = (
    (currentProb / 100) * BET_STAKE * (BET_ODDS - 1) -
    (1 - currentProb / 100) * BET_STAKE
  );

  return (
    <div style={simCardStyle(EMERALD)}>
      {/* Bet header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        marginBottom: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span style={liveBadgeStyle()}>
            <span style={livePulseStyle()} />
            LIVE
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 14,
              fontWeight: 800,
              color: D_INK,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              letterSpacing: -0.1,
            }}>
              Scheffler · Top 10
            </div>
            <div style={{
              fontSize: 11,
              color: D_MUTED,
              fontFamily: "var(--font-mono), monospace",
              marginTop: 2,
              letterSpacing: 0.4,
            }}>
              £{BET_STAKE} @ {BET_ODDS.toFixed(1)}
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{
            fontSize: 10,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: D_DIM,
            fontWeight: 800,
          }}>
            Win prob
          </div>
          <div style={{
            fontSize: 26,
            fontWeight: 800,
            color: EMERALD,
            fontFamily: "var(--font-mono), monospace",
            lineHeight: 1,
            marginTop: 3,
            textShadow: `0 0 12px ${EMERALD_GLOW}`,
            letterSpacing: -0.5,
          }}>
            {currentProb}%
          </div>
        </div>
      </div>

      {/* Chart — data-terminal readout */}
      <div style={{
        position: "relative",
        borderRadius: 12,
        background: D_PANEL,
        backgroundImage: `
          linear-gradient(180deg, oklch(0.24 0.02 155) 0%, ${D_PANEL} 100%),
          repeating-linear-gradient(0deg, transparent 0, transparent 15px, oklch(0.96 0.008 150 / 0.03) 15px, oklch(0.96 0.008 150 / 0.03) 16px),
          repeating-linear-gradient(90deg, transparent 0, transparent 23px, oklch(0.96 0.008 150 / 0.03) 23px, oklch(0.96 0.008 150 / 0.03) 24px)
        `,
        backgroundBlendMode: "normal, screen, screen",
        border: `1px solid ${D_LINE}`,
        padding: "12px 10px 8px",
        marginBottom: 12,
        boxShadow: `inset 0 0 24px oklch(0.10 0.01 155 / 0.6)`,
      }}>
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="none"
          style={{
            display: "block",
            width: "100%",
            height: svgH,
            filter: `drop-shadow(0 0 6px ${EMERALD_GLOW})`,
          }}
          aria-hidden
        >
          <defs>
            <linearGradient id="onboardAreaGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={EMERALD} stopOpacity={0.55} />
              <stop offset="100%" stopColor={EMERALD} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* Gridlines at 25 / 50 / 75 */}
          {[25, 50, 75].map((v) => {
            const y = padY + (1 - v / 100) * (svgH - padY * 2);
            return (
              <line
                key={v}
                x1={padX}
                x2={svgW - padX}
                y1={y}
                y2={y}
                stroke={D_LINE}
                strokeDasharray="2 4"
                opacity={0.9}
              />
            );
          })}
          {/* Area fill (glowing gradient) */}
          <path d={areaPath} fill="url(#onboardAreaGrad)" />
          {/* Line — bright emerald with drop-shadow glow */}
          <path
            d={chartPath}
            fill="none"
            stroke={EMERALD}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Current point marker — bloom halo + solid dot */}
          {currentPoint && (
            <>
              <circle
                cx={currentPoint.x}
                cy={currentPoint.y}
                r={10}
                fill={EMERALD}
                opacity={0.18}
              />
              <circle
                cx={currentPoint.x}
                cy={currentPoint.y}
                r={5}
                fill={EMERALD}
                opacity={0.4}
              />
              <circle
                cx={currentPoint.x}
                cy={currentPoint.y}
                r={2.6}
                fill={D_INK}
              />
            </>
          )}
        </svg>
        {/* Round labels */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          fontSize: 9.5,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: D_DIM,
          fontWeight: 800,
          marginTop: 4,
          fontFamily: "var(--font-mono), monospace",
        }}>
          <span style={{ textAlign: "left" }}>R1</span>
          <span style={{ textAlign: "left" }}>R2</span>
          <span style={{ textAlign: "left" }}>R3</span>
          <span style={{ textAlign: "left" }}>R4</span>
        </div>
      </div>

      {/* Event ticker */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 10,
        background: eventTick?.delta && eventTick.delta > 0
          ? EMERALD_TINT
          : eventTick?.delta && eventTick.delta < 0
            ? DOWN_TINT
            : D_PANEL,
        border: `1px solid ${
          eventTick?.delta && eventTick.delta > 0
            ? EMERALD_D
            : eventTick?.delta && eventTick.delta < 0
              ? "oklch(0.44 0.14 25)"
              : D_LINE
        }`,
        marginBottom: 12,
        minHeight: 40,
        transition: "background 220ms ease, border-color 220ms ease",
      }}>
        <span
          style={{
            fontSize: 14,
            filter:
              eventTick?.delta && eventTick.delta > 0
                ? `drop-shadow(0 0 6px ${EMERALD_GLOW})`
                : undefined,
          }}
          aria-hidden
        >
          {eventTick?.delta && eventTick.delta > 0
            ? "▲"
            : eventTick?.delta && eventTick.delta < 0
              ? "▼"
              : "•"}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: D_INK,
            lineHeight: 1.25,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontFamily: "var(--font-mono), monospace",
            letterSpacing: 0.1,
          }}>
            {eventTick?.event ?? "Live-tracking every shot on course…"}
          </div>
        </div>
        {typeof eventTick?.delta === "number" && eventTick.delta !== 0 && (
          <span style={{
            fontSize: 13,
            fontWeight: 800,
            fontFamily: "var(--font-mono), monospace",
            color: eventTick.delta > 0 ? EMERALD : DOWN,
            padding: "3px 8px",
            borderRadius: 6,
            background: "oklch(0.10 0.01 155 / 0.65)",
            border: `1px solid ${eventTick.delta > 0 ? EMERALD_D : "oklch(0.50 0.16 25)"}`,
            textShadow: `0 0 8px ${eventTick.delta > 0 ? EMERALD_GLOW : "oklch(0.74 0.20 25 / 0.5)"}`,
          }}>
            {eventTick.delta > 0 ? "+" : ""}{eventTick.delta}%
          </span>
        )}
      </div>

      {/* Expected return */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
      }}>
        <div style={statTileStyle()}>
          <div style={statLabelStyle()}>Expected return</div>
          <div style={{
            ...statValueStyle(),
            color: expectedReturn > 0 ? EMERALD : DOWN,
            textShadow: `0 0 10px ${expectedReturn > 0 ? EMERALD_GLOW : "oklch(0.74 0.20 25 / 0.4)"}`,
          }}>
            {expectedReturn > 0 ? "+" : ""}£{expectedReturn.toFixed(2)}
          </div>
        </div>
        <div style={statTileStyle()}>
          <div style={statLabelStyle()}>Round</div>
          <div style={statValueStyle()}>
            R{BET_SCRIPT[tick]?.round ?? 1}
          </div>
        </div>
      </div>

      {/* Replay control */}
      <button
        type="button"
        onClick={() => {
          setTick(0);
          setRunning(true);
        }}
        style={replayBtnStyle()}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
          stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 4v6h6" />
          <path d="M3.5 15a9 9 0 1 0 2.6-8.4L3 10" />
        </svg>
        Replay
      </button>
    </div>
  );
}

// ── LIVE SHOT FEED SIMULATION ─────────────────────────────────────

interface FeedItem {
  id: number;
  timeAgo: string;
  player: string;
  line: string;
  reactions: { fire: number; comment: number };
  accent: "emerald" | "tang" | "blue";
}

const FEED_SCRIPT: FeedItem[] = [
  {
    id: 1,
    timeAgo: "just now",
    player: "Rory McIlroy",
    line: "Drives 342 yds down the fairway on 18",
    reactions: { fire: 24, comment: 3 },
    accent: "tang",
  },
  {
    id: 2,
    timeAgo: "8s",
    player: "Scottie Scheffler",
    line: "Rolls in a 22-foot birdie putt on 14",
    reactions: { fire: 61, comment: 12 },
    accent: "emerald",
  },
  {
    id: 3,
    timeAgo: "42s",
    player: "Xander Schauffele",
    line: "Approach on 12 to 6 feet — birdie look",
    reactions: { fire: 18, comment: 2 },
    accent: "blue",
  },
  {
    id: 4,
    timeAgo: "1m",
    player: "Ludvig Åberg",
    line: "Holes out from the greenside bunker on 11",
    reactions: { fire: 94, comment: 21 },
    accent: "tang",
  },
];

export function LiveFeedSimulation() {
  const [count, setCount] = useState(1);
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setCount((c) => {
        if (c >= FEED_SCRIPT.length) {
          window.setTimeout(() => {
            setCount(1);
            setPulse((n) => n + 1);
          }, 2400);
          return c;
        }
        return c + 1;
      });
      setPulse((n) => n + 1);
    }, 1600);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div style={simCardStyle(TANG)}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 14,
      }}>
        <span style={liveBadgeStyle(TANG)}>
          <span style={livePulseStyle(TANG)} />
          LIVE
        </span>
        <div style={{
          fontSize: 10,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: D_DIM,
          fontWeight: 800,
          fontFamily: "var(--font-mono), monospace",
        }}>
          Shot tracker
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {FEED_SCRIPT.slice(0, count).map((item, i) => {
          const isNewest = i === count - 1;
          const accentC = item.accent === "emerald" ? EMERALD
            : item.accent === "tang" ? TANG : BLUE;
          const accentTint = item.accent === "emerald" ? EMERALD_TINT
            : item.accent === "tang" ? TANG_TINT : BLUE_TINT;
          const accentGlow = item.accent === "emerald" ? EMERALD_GLOW
            : item.accent === "tang" ? TANG_GLOW : BLUE_GLOW;
          return (
            <div
              key={`${pulse}-${item.id}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "11px 12px",
                background: D_PANEL,
                border: `1px solid ${isNewest ? accentC : D_LINE}`,
                borderRadius: 10,
                boxShadow: isNewest ? `0 0 24px ${accentGlow}` : undefined,
                animation: isNewest
                  ? "onboardSlideIn 260ms cubic-bezier(.2,.9,.3,1)"
                  : undefined,
                transition: "border-color 220ms ease, box-shadow 220ms ease",
              }}
            >
              <span style={{
                width: 30,
                height: 30,
                borderRadius: 999,
                background: accentTint,
                color: accentC,
                display: "grid",
                placeItems: "center",
                fontSize: 13,
                fontWeight: 800,
                flexShrink: 0,
                fontFamily: "var(--font-mono), monospace",
                letterSpacing: -0.3,
                border: `1px solid ${accentC}`,
                boxShadow: isNewest ? `0 0 10px ${accentGlow}` : undefined,
              }} aria-hidden>
                {item.player.split(" ").map(w => w[0]).join("")}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12.5,
                  fontWeight: 800,
                  color: D_INK,
                  display: "flex",
                  gap: 6,
                  alignItems: "baseline",
                  letterSpacing: -0.1,
                }}>
                  <span>{item.player}</span>
                  <span style={{
                    fontSize: 10,
                    color: D_DIM,
                    fontWeight: 600,
                    fontFamily: "var(--font-mono), monospace",
                    letterSpacing: 0.3,
                  }}>
                    · {item.timeAgo}
                  </span>
                </div>
                <div style={{
                  fontSize: 12.5,
                  color: D_MUTED,
                  marginTop: 2,
                  lineHeight: 1.35,
                }}>
                  {item.line}
                </div>
                <div style={{
                  display: "flex",
                  gap: 12,
                  marginTop: 6,
                  fontSize: 11,
                  color: D_DIM,
                  fontWeight: 700,
                  fontFamily: "var(--font-mono), monospace",
                }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <span aria-hidden>🔥</span>{item.reactions.fire}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <span aria-hidden>💬</span>{item.reactions.comment}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes onboardSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── PREDICTION TOOLS SIMULATION ───────────────────────────────────
//
// Step-by-step walkthrough of the three main prediction tools. The
// visual language matches the real Pardle UI (light warm-paper,
// emerald accents, Archivo type) so the reader recognises what
// they're being shown when they later land on the actual page —
// no mission-control aesthetic here, that's for the live-data
// sims only.

interface TourStep {
  key: "course-fit" | "round-forecast" | "tee-shots";
  tabLabel: string;
  caption: string;
  render: () => React.ReactNode;
}

const TOUR_STEPS: TourStep[] = [
  {
    key: "course-fit",
    tabLabel: "Course fit",
    caption:
      "Rank the field by predicted OTT edge vs each player's own baseline — cross-validated so the confidence is honest.",
    render: () => <CourseFitPreview />,
  },
  {
    key: "round-forecast",
    tabLabel: "Round score",
    caption:
      "Full round-score distribution — median, upside, downside — for any player at any course.",
    render: () => <RoundForecastPreview />,
  },
  {
    key: "tee-shots",
    tabLabel: "Ballstriking",
    caption:
      "Radar-tracked ball speed, apex and shot curve — the ingredients the course-fit model reads.",
    render: () => <TeeShotPreview />,
  },
];

const TOUR_STEP_MS = 4200;

export function ToolsSimulation() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion || paused) return;
    const id = window.setInterval(
      () => setStep((s) => (s + 1) % TOUR_STEPS.length),
      TOUR_STEP_MS,
    );
    return () => window.clearInterval(id);
  }, [reducedMotion, paused]);

  const current = TOUR_STEPS[step];

  return (
    <div style={walkthroughOuterStyle()}>
      {/* Header — small badge + step counter */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
      }}>
        <span style={walkthroughBadgeStyle()}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: L_BLUE,
          }} />
          Tools tour
        </span>
        <span style={{
          fontSize: 10,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: L_DIM,
          fontWeight: 800,
          fontFamily: "var(--font-mono), monospace",
        }}>
          Step {step + 1} of {TOUR_STEPS.length}
        </span>
      </div>

      {/* Tab strip */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${TOUR_STEPS.length}, 1fr)`,
        gap: 6,
        marginBottom: 12,
      }}>
        {TOUR_STEPS.map((t, i) => {
          const active = i === step;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setStep(i);
                setPaused(true);
              }}
              style={tabStyle(active)}
              aria-current={active ? "step" : undefined}
            >
              <span style={{
                fontSize: 9.5,
                letterSpacing: 0.7,
                color: active ? L_BLUE : L_DIM,
                fontFamily: "var(--font-mono), monospace",
                fontWeight: 800,
              }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{
                fontSize: 12.5,
                fontWeight: 800,
                color: active ? L_INK : L_MUTED,
                letterSpacing: -0.1,
                marginTop: 2,
              }}>
                {t.tabLabel}
              </span>
              {/* Progress underline — animates while auto-advancing */}
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: -1,
                  height: 2,
                  background: L_BLUE,
                  borderRadius: 999,
                  width: active ? "100%" : "0%",
                  transition: reducedMotion
                    ? undefined
                    : active && !paused
                      ? `width ${TOUR_STEP_MS - 100}ms linear`
                      : "width 200ms ease",
                }}
              />
            </button>
          );
        })}
      </div>

      {/* Preview slot — remount on step change so the inner CSS
          transitions replay for the new panel. */}
      <div
        key={step}
        className="pardle-tools-preview"
        style={{
          animation: reducedMotion
            ? undefined
            : "toolsPreviewIn 320ms cubic-bezier(.2,.9,.3,1) both",
        }}
      >
        {current.render()}
      </div>

      {/* Caption */}
      <p style={{
        margin: "12px 0 0",
        fontSize: 13,
        lineHeight: 1.45,
        color: L_MUTED,
        fontWeight: 500,
      }}>
        {current.caption}
      </p>

      <style>{`
        @keyframes toolsPreviewIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── Tools walkthrough — individual tool previews ──────────────────

function CourseFitPreview() {
  const rows = [
    { rank: 1, name: "Scottie Scheffler", edge: 1.46, dir: "up" as const },
    { rank: 2, name: "Rory McIlroy", edge: 1.28, dir: "up" as const },
    { rank: 3, name: "Xander Schauffele", edge: 0.62, dir: "up" as const },
    { rank: 4, name: "Wyndham Clark", edge: -0.72, dir: "down" as const },
  ];
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.edge)));
  return (
    <div style={previewCardStyle()}>
      <div style={previewHeaderStyle()}>
        <div>
          <div style={previewEyebrowStyle()}>Course-fit forecast</div>
          <div style={previewTitleStyle()}>Torrey Pines · this week</div>
        </div>
        <span style={trustedPillStyle()}>Trusted · CV R² 0.083</span>
      </div>
      <div style={{
        display: "grid",
        gap: 6,
        marginTop: 10,
      }}>
        {rows.map((row) => {
          const barPct = (Math.abs(row.edge) / maxAbs) * 42;
          const c = row.dir === "up" ? L_UP : L_DOWN;
          return (
            <div
              key={row.rank}
              style={{
                display: "grid",
                gridTemplateColumns: "18px 1fr 1fr 52px",
                gap: 10,
                alignItems: "center",
                padding: "7px 10px",
                background: L_SOFT,
                border: `1px solid ${L_LINE}`,
                borderRadius: 8,
              }}
            >
              <span style={{
                fontSize: 10,
                color: L_DIM,
                fontWeight: 800,
                fontFamily: "var(--font-mono), monospace",
              }}>
                {String(row.rank).padStart(2, "0")}
              </span>
              <span style={{
                fontSize: 12.5,
                fontWeight: 800,
                color: L_INK,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                letterSpacing: -0.1,
              }}>
                {row.name}
              </span>
              <div style={{
                position: "relative",
                height: 8,
                background: L_CARD,
                border: `1px solid ${L_LINE}`,
                borderRadius: 999,
                overflow: "hidden",
              }}>
                <div style={{
                  position: "absolute",
                  top: -1,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 1,
                  height: 12,
                  background: L_DIM,
                  opacity: 0.55,
                  zIndex: 2,
                }} />
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: row.edge >= 0 ? "50%" : `${50 - barPct}%`,
                  height: "100%",
                  width: `${barPct}%`,
                  background: c,
                  borderRadius: 999,
                }} />
              </div>
              <span style={{
                fontSize: 12,
                fontWeight: 800,
                color: c,
                fontFamily: "var(--font-mono), monospace",
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
              }}>
                {row.edge > 0 ? "+" : ""}{row.edge.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoundForecastPreview() {
  const bars = [
    { score: 65, pct: 6 },
    { score: 66, pct: 12 },
    { score: 67, pct: 22 },
    { score: 68, pct: 28 },
    { score: 69, pct: 18 },
    { score: 70, pct: 9 },
    { score: 71, pct: 4 },
    { score: 72, pct: 1 },
  ];
  const max = Math.max(...bars.map((b) => b.pct));
  const modeScore = 68;
  const chartH = 88;
  return (
    <div style={previewCardStyle()}>
      <div style={previewHeaderStyle()}>
        <div>
          <div style={previewEyebrowStyle()}>Round-score forecast</div>
          <div style={previewTitleStyle()}>Scheffler · Sunday R4</div>
        </div>
        <span style={{
          ...trustedPillStyle(),
          background: L_BLUE_TINT,
          color: L_BLUE,
        }}>
          Model
        </span>
      </div>

      <div style={{
        marginTop: 14,
        display: "grid",
        gridTemplateColumns: `repeat(${bars.length}, 1fr)`,
        gap: 4,
        alignItems: "end",
        height: chartH,
      }}>
        {bars.map((b) => {
          const isMode = b.score === modeScore;
          const h = (b.pct / max) * chartH;
          return (
            <div key={b.score} style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              height: "100%",
            }}>
              <div style={{
                width: "100%",
                height: `${h}px`,
                background: isMode ? L_UP : L_SOFT,
                border: isMode ? `1px solid ${L_UP}` : `1px solid ${L_LINE}`,
                borderRadius: 4,
              }} />
            </div>
          );
        })}
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${bars.length}, 1fr)`,
        gap: 4,
        marginTop: 4,
      }}>
        {bars.map((b) => (
          <div key={b.score} style={{
            fontSize: 9.5,
            color: b.score === modeScore ? L_INK : L_DIM,
            fontFamily: "var(--font-mono), monospace",
            fontWeight: b.score === modeScore ? 800 : 600,
            textAlign: "center",
          }}>
            {b.score}
          </div>
        ))}
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 8,
        marginTop: 12,
      }}>
        <StatTile label="Median" value="68" tone="ink" />
        <StatTile label="Best 5%" value="65" tone="emerald" />
        <StatTile label="Worst 5%" value="71" tone="ink" />
      </div>
    </div>
  );
}

function TeeShotPreview() {
  const stats = [
    { label: "Ball speed", value: "183 mph", pct: 96 },
    { label: "Apex height", value: "122 ft", pct: 82 },
    { label: "Curve", value: "3.4° draw", pct: 58 },
  ];
  return (
    <div style={previewCardStyle()}>
      <div style={previewHeaderStyle()}>
        <div>
          <div style={previewEyebrowStyle()}>Tee-shot profile</div>
          <div style={previewTitleStyle()}>Rory McIlroy · Driver</div>
        </div>
        <span style={{
          ...trustedPillStyle(),
          background: L_BLUE_TINT,
          color: L_BLUE,
        }}>
          Radar · 3 seasons
        </span>
      </div>
      <div style={{
        display: "grid",
        gap: 10,
        marginTop: 12,
      }}>
        {stats.map((s) => (
          <div key={s.label} style={{
            padding: "10px 12px",
            background: L_SOFT,
            border: `1px solid ${L_LINE}`,
            borderRadius: 8,
          }}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}>
              <span style={{
                fontSize: 12.5,
                fontWeight: 800,
                color: L_INK,
                letterSpacing: -0.1,
              }}>
                {s.label}
              </span>
              <span style={{
                fontSize: 13,
                fontWeight: 800,
                color: L_INK,
                fontFamily: "var(--font-mono), monospace",
                fontVariantNumeric: "tabular-nums",
              }}>
                {s.value}
              </span>
            </div>
            <div style={{
              marginTop: 6,
              height: 5,
              background: L_CARD,
              border: `1px solid ${L_LINE}`,
              borderRadius: 999,
              overflow: "hidden",
            }}>
              <div style={{
                width: `${s.pct}%`,
                height: "100%",
                background: L_UP,
                borderRadius: 999,
              }} />
            </div>
            <div style={{
              marginTop: 4,
              fontSize: 10.5,
              color: L_MUTED,
              fontWeight: 700,
              letterSpacing: 0.1,
            }}>
              {s.pct}th percentile · tour field
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ink" | "emerald";
}) {
  return (
    <div style={{
      padding: "8px 10px",
      background: L_SOFT,
      border: `1px solid ${L_LINE}`,
      borderRadius: 8,
    }}>
      <div style={{
        fontSize: 9.5,
        letterSpacing: 0.9,
        textTransform: "uppercase",
        color: L_DIM,
        fontWeight: 800,
      }}>
        {label}
      </div>
      <div style={{
        marginTop: 2,
        fontSize: 16,
        fontWeight: 800,
        color: tone === "emerald" ? L_UP : L_INK,
        fontFamily: "var(--font-mono), monospace",
        letterSpacing: -0.3,
      }}>
        {value}
      </div>
    </div>
  );
}

// ── Styles for the walkthrough shell ──────────────────────────────

function walkthroughOuterStyle(): React.CSSProperties {
  return {
    marginTop: 4,
    marginBottom: 18,
    padding: "16px 16px 18px",
    borderRadius: 16,
    background: L_CARD,
    border: `1px solid ${L_LINE}`,
    boxShadow: `inset 0 -3px 0 ${L_BLUE}, 0 6px 18px oklch(0.15 0.02 150 / 0.05)`,
    fontFamily: "var(--font-archivo), var(--font-sans), sans-serif",
  };
}

function walkthroughBadgeStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "4px 10px 4px 8px",
    borderRadius: 999,
    background: L_BLUE_TINT,
    color: L_BLUE,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    boxShadow: `inset 0 0 0 1px ${L_BLUE}`,
  };
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    padding: "8px 10px 10px",
    background: active ? L_BLUE_TINT : L_SOFT,
    border: `1px solid ${active ? L_BLUE : L_LINE}`,
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "left",
    transition: "background 160ms ease, border-color 160ms ease",
  };
}

function previewCardStyle(): React.CSSProperties {
  return {
    padding: "14px 14px 12px",
    background: L_CARD,
    border: `1px solid ${L_LINE}`,
    borderRadius: 12,
    boxShadow: "0 2px 8px oklch(0.15 0.02 150 / 0.03)",
  };
}

function previewHeaderStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  };
}

function previewEyebrowStyle(): React.CSSProperties {
  return {
    fontSize: 9.5,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: L_DIM,
    fontWeight: 800,
  };
}

function previewTitleStyle(): React.CSSProperties {
  return {
    marginTop: 2,
    fontSize: 14,
    fontWeight: 800,
    color: L_INK,
    letterSpacing: -0.2,
  };
}

function trustedPillStyle(): React.CSSProperties {
  return {
    fontSize: 9.5,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: L_UP,
    fontWeight: 800,
    padding: "3px 8px",
    background: L_EMERALD_TINT,
    borderRadius: 999,
    whiteSpace: "nowrap",
  };
}


/** Detects `prefers-reduced-motion: reduce`. Returns false during
 *  SSR / initial paint so we don't over-eagerly disable animation
 *  before we know the user's preference. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const listener = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", listener);
    return () => mq.removeEventListener?.("change", listener);
  }, []);
  return reduced;
}

// ── Shared styles ─────────────────────────────────────────────────

function simCardStyle(accent: string): React.CSSProperties {
  const glow =
    accent === EMERALD
      ? EMERALD_GLOW
      : accent === TANG
        ? TANG_GLOW
        : BLUE_GLOW;
  return {
    marginTop: 4,
    marginBottom: 18,
    padding: "18px 18px 16px",
    borderRadius: 16,
    background: `linear-gradient(155deg, ${D_BG} 0%, ${D_BG_LO} 100%)`,
    // Faint dot-grid so the panel reads like a data terminal.
    backgroundImage: `
      linear-gradient(155deg, ${D_BG} 0%, ${D_BG_LO} 100%),
      radial-gradient(oklch(0.96 0.008 150 / 0.045) 1px, transparent 1px)
    `,
    backgroundSize: "auto, 20px 20px",
    backgroundBlendMode: "normal, screen",
    border: `1px solid ${D_LINE}`,
    boxShadow: `
      inset 0 0 0 1px oklch(0.96 0.008 150 / 0.04),
      inset 0 -2px 0 ${accent},
      0 12px 32px ${glow.replace("/ 0.55", "/ 0.20")},
      0 0 0 1px oklch(0.15 0.02 150 / 0.04)
    `,
    fontFamily: "var(--font-archivo), var(--font-sans), sans-serif",
    color: D_INK,
    position: "relative",
    overflow: "hidden",
  };
}

function liveBadgeStyle(colour = EMERALD): React.CSSProperties {
  const tint =
    colour === EMERALD
      ? EMERALD_TINT
      : colour === TANG
        ? TANG_TINT
        : BLUE_TINT;
  const glow =
    colour === EMERALD
      ? EMERALD_GLOW
      : colour === TANG
        ? TANG_GLOW
        : BLUE_GLOW;
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 9px 3px 7px",
    borderRadius: 999,
    background: tint,
    color: colour,
    fontSize: 9.5,
    fontWeight: 800,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontFamily: "var(--font-archivo), var(--font-sans), sans-serif",
    boxShadow: `inset 0 0 0 1px ${colour}, 0 0 12px ${glow}`,
  };
}

function livePulseStyle(colour = EMERALD): React.CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: colour,
    color: colour,
    boxShadow: `0 0 0 0 ${colour}, 0 0 8px ${colour}`,
    animation: "onboardPulse 1.6s ease-out infinite",
  };
}

function statTileStyle(): React.CSSProperties {
  return {
    padding: "10px 12px",
    background: D_PANEL,
    border: `1px solid ${D_LINE}`,
    borderRadius: 10,
    textAlign: "left",
  };
}

function statLabelStyle(): React.CSSProperties {
  return {
    fontSize: 9.5,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: D_DIM,
    fontWeight: 800,
  };
}

function statValueStyle(): React.CSSProperties {
  return {
    fontSize: 16,
    fontWeight: 800,
    color: D_INK,
    fontFamily: "var(--font-mono), monospace",
    marginTop: 3,
    lineHeight: 1,
    letterSpacing: -0.2,
  };
}

function replayBtnStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    marginTop: 12,
    padding: "5px 10px",
    fontSize: 10.5,
    fontWeight: 800,
    letterSpacing: 0.9,
    textTransform: "uppercase",
    color: D_MUTED,
    background: "transparent",
    border: `1px solid ${D_LINE}`,
    borderRadius: 6,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
