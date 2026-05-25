"use client";

import { useEffect, useState } from "react";

/**
 * Each beat of the 13-second loop. `t` is the milliseconds offset
 * from the loop's start. Tuned so the H12 eagle + H15 44ft putt
 * both land on "round" timing landmarks for screenshot grabs.
 */
interface Beat {
  t: number;
  hole: number;
  result: "birdie" | "eagle";
  par: number;
  scoreToParAfter: string;
  action?: string;
  tag: string;
  delta: number;
  /** Visual punch level — 'pop' = scale+glow on entrance, used for
   *  eagle + 44ft putt + winner moments. */
  hero?: boolean;
}

const BEATS: Beat[] = [
  { t: 1200, hole: 6, result: "birdie", par: 4, scoreToParAfter: "−23", tag: "Extends the lead", delta: 50 },
  { t: 2600, hole: 11, result: "birdie", par: 4, scoreToParAfter: "−24", tag: "Pulling away", delta: 100 },
  { t: 4000, hole: 12, result: "eagle", par: 5, scoreToParAfter: "−26", tag: "Eagle on 12", delta: 750, hero: true },
  { t: 6000, hole: 14, result: "birdie", par: 4, scoreToParAfter: "−27", tag: "Field can't catch him", delta: 200 },
  {
    t: 7600,
    hole: 15,
    result: "birdie",
    par: 4,
    scoreToParAfter: "−28",
    action: "Drains a 44 ft 8 in. putt for birdie",
    tag: "Longest putt of week",
    delta: 350,
    hero: true,
  },
  { t: 9400, hole: 17, result: "birdie", par: 4, scoreToParAfter: "−29", tag: "Cruise control", delta: 150 },
  { t: 10800, hole: 18, result: "birdie", par: 4, scoreToParAfter: "−30", tag: "WINNER · £5,000 paid", delta: 100, hero: true },
];

const LOOP_MS = 13_000;
const VALUE_START = 1250; // bet value entering Sunday (£100 × 50 × 25%)
const VALUE_END = 5000;

const RESULT_LABEL: Record<Beat["result"], string> = {
  eagle: "EAGLE",
  birdie: "BIRDIE",
};
const RESULT_EMOJI: Record<Beat["result"], string> = {
  eagle: "🦅",
  birdie: "🐦",
};

function gbp(n: number): string {
  const sign = n >= 0 ? "+" : "−";
  const abs = Math.abs(n);
  if (abs >= 100) return `${sign}£${Math.round(abs)}`;
  return `${sign}£${Math.round(abs)}`;
}

function interp(t: number): number {
  // Map loop time to a 0..1 progress that hits the final value at
  // the last beat's t + 1 second, then holds.
  const ENDS_AT = BEATS[BEATS.length - 1].t + 1000;
  if (t <= 0) return 0;
  if (t >= ENDS_AT) return 1;
  return t / ENDS_AT;
}

export default function CjCupWatchClient() {
  const [now, setNow] = useState(0);

  useEffect(() => {
    let raf = 0;
    let start = performance.now();
    const tick = (ts: number) => {
      const elapsed = (ts - start) % LOOP_MS;
      setNow(elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Compute the smooth running value. Each beat contributes its
  // delta when its `t` is reached; between beats the value
  // interpolates so the ticker never sits still.
  const beatsLanded = BEATS.filter((b) => now >= b.t);
  const sumLanded = beatsLanded.reduce((s, b) => s + b.delta, 0);
  const lastT = beatsLanded.length > 0 ? beatsLanded[beatsLanded.length - 1].t : 0;
  const nextBeat = BEATS.find((b) => b.t > now);
  const nextT = nextBeat?.t ?? LOOP_MS;
  const nextDelta = nextBeat?.delta ?? 0;
  const phase = (now - lastT) / Math.max(1, nextT - lastT);
  const smoothing = nextDelta * Math.max(0, Math.min(1, phase * 0.4));
  const runningValue = VALUE_START + sumLanded + smoothing;
  const displayValue = Math.min(VALUE_END, Math.round(runningValue));

  return (
    <main
      style={{
        minHeight: "100dvh",
        background:
          "radial-gradient(circle at 20% 0%, #15171b 0%, #0a0d12 70%)",
        color: "#f5f5f7",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        display: "flex",
        flexDirection: "column",
        padding: "20px 16px 24px",
        gap: 14,
      }}
    >
      {/* Top eyebrow */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "#ff9d2e",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#00d96e",
            boxShadow: "0 0 10px rgba(0,217,110,0.9)",
            animation: "pardle-pulse 1.4s ease-in-out infinite",
          }}
        />
        Live · CJ Cup Byron Nelson · Final round
      </div>

      {/* Big ticker */}
      <div
        style={{
          background: "linear-gradient(160deg, rgba(0,217,110,0.10), rgba(0,217,110,0.02))",
          border: "1px solid rgba(0,217,110,0.25)",
          borderRadius: 14,
          padding: "16px 18px",
          boxShadow: "0 0 40px rgba(0,217,110,0.10)",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#9aa0a8",
          }}
        >
          Your Wyndham Clark outright · £100 @ +4900
        </div>
        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            color: "#00d96e",
            letterSpacing: "-0.04em",
            lineHeight: 1,
            marginTop: 4,
            fontVariantNumeric: "tabular-nums",
            textShadow: "0 0 30px rgba(0,217,110,0.5)",
          }}
        >
          £{displayValue.toLocaleString()}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#9aa0a8",
            letterSpacing: "0.02em",
            marginTop: 2,
          }}
        >
          {interp(now) >= 1 ? "Settled · £5,000 paid" : "Live · ticking with every shot"}
        </div>
      </div>

      {/* Feed rows — fade in on cue */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {BEATS.map((b) => {
          const visible = now >= b.t;
          const justLanded = now >= b.t && now < b.t + 600;
          const popScale = b.hero && justLanded ? 1.04 : 1;
          return (
            <div
              key={b.hole}
              style={{
                opacity: visible ? 1 : 0,
                transform: `translateY(${visible ? 0 : 10}px) scale(${popScale})`,
                transition:
                  "opacity 320ms ease, transform 320ms cubic-bezier(0.2,0.9,0.3,1.4)",
                background: b.hero
                  ? "rgba(0,217,110,0.08)"
                  : "rgba(255,255,255,0.04)",
                border: `1px solid ${b.hero ? "rgba(0,217,110,0.4)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 10,
                padding: "10px 12px",
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                boxShadow: b.hero && justLanded ? "0 0 36px rgba(0,217,110,0.4)" : "none",
              }}
            >
              <span style={{ fontSize: 22, lineHeight: 1 }}>
                {RESULT_EMOJI[b.result]}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 800,
                      letterSpacing: "-0.01em",
                      color: "#f5f5f7",
                    }}
                  >
                    W. Clark
                  </span>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 800,
                      letterSpacing: "0.05em",
                    }}
                  >
                    <span
                      style={{
                        background: b.result === "eagle" ? "rgba(255,157,46,0.18)" : "rgba(0,217,110,0.18)",
                        color: b.result === "eagle" ? "#ff9d2e" : "#00d96e",
                        padding: "2px 8px",
                        borderRadius: 6,
                        textTransform: "uppercase",
                      }}
                    >
                      {RESULT_LABEL[b.result]}
                    </span>
                    <span style={{ color: "#9aa0a8" }}>H{b.hole}</span>
                    <span
                      style={{
                        color: "#00d96e",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {b.scoreToParAfter}
                    </span>
                  </span>
                </div>
                {b.action && (
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: 12,
                      color: "#c5cad3",
                      fontWeight: 600,
                    }}
                  >
                    {b.action}
                  </p>
                )}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginTop: 6,
                  }}
                >
                  <span
                    style={{
                      background: "rgba(0,217,110,0.14)",
                      color: "#00d96e",
                      border: "1px solid rgba(0,217,110,0.32)",
                      padding: "3px 9px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: "0.01em",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    🚀 {gbp(b.delta)} on your outright
                  </span>
                  <span
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      color: "#c5cad3",
                      border: "1px solid rgba(255,255,255,0.10)",
                      padding: "3px 9px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.01em",
                    }}
                  >
                    {b.tag}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          marginTop: "auto",
          paddingTop: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "#5a606a",
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span style={{ color: "#f5f5f7" }}>Pardle</span>
        <span>Real shot data · pardle.app</span>
      </div>

      <style
        // eslint-disable-next-line react/no-unknown-property
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes pardle-pulse {
              0%, 100% { box-shadow: 0 0 10px rgba(0,217,110,0.9); }
              50% { box-shadow: 0 0 24px rgba(0,217,110,1); }
            }
          `,
        }}
      />
    </main>
  );
}
