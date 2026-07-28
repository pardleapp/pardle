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

import { useEffect, useMemo, useRef, useState } from "react";

// ── Palette ────────────────────────────────────────────────────────
//
// Sim cards use a dark "mission control" theme — deep near-black
// panel with saturated neon accents. The rest of the modal stays
// light warm-paper per CLAUDE.md's design-handoff rule; the dark
// panel is scoped to the sim itself so the app's main theme is
// untouched.
//
// Dark tokens (inside the sim card only):
const D_BG = "oklch(0.19 0.02 155)";
const D_BG_LO = "oklch(0.14 0.015 155)";
const D_PANEL = "oklch(0.22 0.02 155)";
const D_INK = "oklch(0.96 0.008 150)";
const D_MUTED = "oklch(0.72 0.02 150)";
const D_DIM = "oklch(0.55 0.02 150)";
const D_LINE = "oklch(0.36 0.02 150)";

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
  const lastEventIdxRef = useRef(0);

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

  // Latest event to display in the ticker — either this tick's, or
  // the most recent prior one if this tick has no event.
  useEffect(() => {
    if (BET_SCRIPT[tick]?.event) lastEventIdxRef.current = tick;
  }, [tick]);

  const currentProb = BET_SCRIPT[tick]?.p ?? BET_SCRIPT[0].p;
  const eventTick = BET_SCRIPT[lastEventIdxRef.current];

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
          lastEventIdxRef.current = 0;
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
          Shot-by-shot feed
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

interface RankRow {
  name: string;
  edge: number; // Event Δ, tenths of a stroke
  colour: "up" | "down" | "flat";
}

const RANK_TARGET: RankRow[] = [
  { name: "Scottie Scheffler", edge: 1.46, colour: "up" },
  { name: "Rory McIlroy", edge: 1.28, colour: "up" },
  { name: "Xander Schauffele", edge: 0.62, colour: "up" },
  { name: "Ludvig Åberg", edge: 0.14, colour: "flat" },
  { name: "Wyndham Clark", edge: -0.72, colour: "down" },
];

export function ToolsSimulation() {
  const [pass, setPass] = useState(0); // bumped to restart the animation
  const [counter, setCounter] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  // Restart the demo periodically so a lingering user sees it twice.
  useEffect(() => {
    const id = window.setInterval(() => setPass((n) => n + 1), 7000);
    return () => window.clearInterval(id);
  }, []);

  // Reset + animate on every pass.
  useEffect(() => {
    if (reducedMotion) {
      setCounter(100);
      setRevealed(true);
      return;
    }
    setCounter(0);
    setRevealed(false);
    const revealRaf = requestAnimationFrame(() => setRevealed(true));
    const start = performance.now();
    let rafId = 0;
    function tick(now: number) {
      const t = Math.min((now - start) / 1200, 1);
      // Ease-out cubic — snaps in fast, settles gently.
      const eased = 1 - Math.pow(1 - t, 3);
      setCounter(Math.round(eased * 100));
      if (t < 1) rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(revealRaf);
    };
  }, [pass, reducedMotion]);

  // Scale bars to fill nicely: |maxEdge| maps to ~48% of the bar
  // slot (so ±48% around the zero midpoint).
  const maxAbs = Math.max(
    ...RANK_TARGET.map((r) => Math.abs(r.edge)),
  );
  const scale = 48 / maxAbs;

  return (
    <div style={simCardStyle(BLUE)}>
      {/* Header row — small, everything meaningful is in the hero */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 4,
        gap: 12,
      }}>
        <div style={monoEyebrowStyle()}>
          Course-fit forecast · Torrey Pines
        </div>
        <div style={{
          ...monoEyebrowStyle(),
          color: BLUE,
          opacity: 0.75,
        }}>
          Live model
        </div>
      </div>

      {/* HERO — count-up, glowing */}
      <div style={{
        position: "relative",
        padding: "24px 16px 22px",
        margin: "10px 0 20px",
        background: `radial-gradient(120% 90% at 50% 40%, oklch(0.34 0.13 240 / 0.28) 0%, transparent 60%), ${D_PANEL}`,
        border: `1px solid ${D_LINE}`,
        borderRadius: 14,
        textAlign: "center",
        overflow: "hidden",
      }}>
        {/* Faint horizontal scan line for the mission-control feel */}
        <div style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent 0, transparent 8px, oklch(0.96 0.008 150 / 0.03) 8px, oklch(0.96 0.008 150 / 0.03) 9px)",
          pointerEvents: "none",
        }} />
        <div style={{ ...monoEyebrowStyle(), color: D_MUTED, position: "relative" }}>
          Model confidence
        </div>
        <div
          style={{
            position: "relative",
            marginTop: 8,
            fontFamily: "var(--font-mono), monospace",
            fontWeight: 800,
            fontSize: 68,
            lineHeight: 1,
            color: BLUE,
            textShadow: `0 0 22px ${BLUE_GLOW}, 0 0 40px ${BLUE_GLOW}`,
            letterSpacing: -2,
            fontVariantNumeric: "tabular-nums",
          }}
          aria-label={`Model confidence ${counter} percent`}
        >
          {counter}
          <span style={{
            fontSize: 32,
            marginLeft: 4,
            opacity: 0.7,
            letterSpacing: -1,
          }}>%</span>
        </div>
        <div style={{
          position: "relative",
          marginTop: 8,
          fontSize: 11.5,
          color: D_MUTED,
          fontWeight: 700,
          lineHeight: 1.4,
        }}>
          Cross-validated on 176 hold-out players · trusted signal
        </div>
        {/* Progress ring under the number */}
        <div style={{
          position: "relative",
          marginTop: 14,
          height: 4,
          background: D_BG_LO,
          borderRadius: 999,
          overflow: "hidden",
        }}>
          <div style={{
            width: `${counter}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${BLUE_D} 0%, ${BLUE} 100%)`,
            borderRadius: 999,
            boxShadow: `0 0 10px ${BLUE_GLOW}`,
            transition: reducedMotion ? undefined : "width 60ms linear",
          }} />
        </div>
      </div>

      {/* Bar race */}
      <div style={{
        ...monoEyebrowStyle(),
        marginBottom: 10,
      }}>
        Predicted Event Δ (SG:OTT / 4 rds)
      </div>
      <div style={{ display: "grid", gap: 7 }}>
        {RANK_TARGET.map((row, i) => {
          const c = row.colour === "up" ? EMERALD
            : row.colour === "down" ? DOWN : D_MUTED;
          const glow = row.colour === "up" ? EMERALD_GLOW
            : row.colour === "down" ? "oklch(0.74 0.20 25 / 0.5)"
              : "transparent";
          const barPct = Math.abs(row.edge) * scale;
          const leftPct = row.edge >= 0 ? 50 : 50 - barPct;
          const delay = reducedMotion ? 0 : 350 + i * 140;
          return (
            <div
              key={`${pass}-${row.name}`}
              style={{
                display: "grid",
                gridTemplateColumns: "22px 1fr 1fr 62px",
                gap: 10,
                alignItems: "center",
                padding: "9px 12px",
                background: D_PANEL,
                border: `1px solid ${D_LINE}`,
                borderRadius: 9,
                opacity: revealed ? 1 : 0,
                transform: revealed ? "translateY(0)" : "translateY(6px)",
                transition: reducedMotion
                  ? undefined
                  : `opacity 320ms ease ${delay}ms, transform 320ms cubic-bezier(.2,.9,.3,1) ${delay}ms`,
              }}
            >
              <span style={{
                fontSize: 10,
                color: D_DIM,
                fontWeight: 800,
                fontFamily: "var(--font-mono), monospace",
                letterSpacing: 0.5,
              }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{
                fontSize: 13,
                fontWeight: 800,
                color: D_INK,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                letterSpacing: -0.1,
              }}>
                {row.name}
              </span>
              {/* Bar */}
              <div style={{
                position: "relative",
                height: 9,
                background: D_BG_LO,
                border: `1px solid ${D_LINE}`,
                borderRadius: 999,
                overflow: "hidden",
              }}>
                {/* Zero marker */}
                <div style={{
                  position: "absolute",
                  top: -2,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 1,
                  height: 13,
                  background: D_MUTED,
                  opacity: 0.6,
                  zIndex: 2,
                }} />
                {/* Bar fill — CSS-transitioned width, guaranteed to
                     land at its target even if animation misses. */}
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: `${leftPct}%`,
                  height: "100%",
                  width: revealed ? `${barPct}%` : "0%",
                  background: `linear-gradient(90deg, ${c} 0%, ${c} 100%)`,
                  borderRadius: 999,
                  boxShadow: `0 0 8px ${glow}`,
                  transition: reducedMotion
                    ? undefined
                    : `width 620ms cubic-bezier(.2,.9,.3,1) ${delay + 120}ms`,
                }} />
              </div>
              <span style={{
                fontSize: 13,
                fontWeight: 800,
                color: c,
                fontFamily: "var(--font-mono), monospace",
                textAlign: "right",
                textShadow: glow !== "transparent" ? `0 0 8px ${glow}` : undefined,
                letterSpacing: -0.3,
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

/** Mono uppercase eyebrow — shared inside dark sim panels. */
function monoEyebrowStyle(): React.CSSProperties {
  return {
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: D_DIM,
    fontWeight: 800,
    fontFamily: "var(--font-mono), monospace",
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
