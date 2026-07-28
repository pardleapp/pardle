"use client";

/**
 * Interactive walkthroughs for the onboarding modal's second step.
 * All three intent paths (bets / live / tools) render the same
 * Walkthrough shell — a tabbed step-by-step tour whose preview
 * panels mirror the actual Pardle UI so a first-time user
 * recognises what they're being shown when they later land on
 * the real page.
 *
 * Every preview is clickable → navigates to the linked page and
 * dismisses the modal (via the onNavigate callback). Tabs switch
 * the preview in place and pause the 4.2s auto-advance so a user
 * can dwell on one panel.
 *
 * All three sims share the light warm-paper aesthetic. No dark
 * "mission control" panels — the modal chrome is light and the
 * previews match the app.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

// ── Palette ────────────────────────────────────────────────────────

const CARD = "oklch(0.995 0.004 95)";
const SOFT = "oklch(0.945 0.012 95)";
const LINE = "oklch(0.90 0.013 95)";
const INK = "oklch(0.26 0.04 155)";
const MUTED = "oklch(0.50 0.02 150)";
const DIM = "oklch(0.62 0.018 150)";
const UP = "oklch(0.50 0.13 155)";
const UP_D = "oklch(0.40 0.12 156)";
const UP_TINT = "oklch(0.96 0.04 155)";
const DOWN = "oklch(0.60 0.19 30)";
const TANG = "oklch(0.66 0.18 45)";
const TANG_TINT = "oklch(0.965 0.045 60)";
const BLUE = "oklch(0.55 0.14 245)";
const BLUE_TINT = "oklch(0.965 0.04 240)";

const STEP_MS = 4200;

// ── Shared walkthrough shell ──────────────────────────────────────

interface WalkthroughStep {
  key: string;
  tabLabel: string;
  href: string;
  /** One-line explainer under the preview. */
  caption: string;
  render: () => React.ReactNode;
}

interface WalkthroughProps {
  badgeLabel: string;
  accent: string;
  accentTint: string;
  steps: WalkthroughStep[];
  onNavigate: () => void;
}

function Walkthrough({
  badgeLabel,
  accent,
  accentTint,
  steps,
  onNavigate,
}: WalkthroughProps) {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion || paused) return;
    const id = window.setInterval(
      () => setStep((s) => (s + 1) % steps.length),
      STEP_MS,
    );
    return () => window.clearInterval(id);
  }, [reducedMotion, paused, steps.length]);

  const current = steps[step];

  return (
    <div style={{
      marginTop: 4,
      marginBottom: 18,
      padding: "16px 16px 18px",
      borderRadius: 16,
      background: CARD,
      border: `1px solid ${LINE}`,
      boxShadow: `inset 0 -3px 0 ${accent}, 0 6px 18px oklch(0.15 0.02 150 / 0.05)`,
      fontFamily: "var(--font-archivo), var(--font-sans), sans-serif",
    }}>
      {/* Header: badge + step counter */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 12,
      }}>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "4px 10px 4px 8px",
          borderRadius: 999,
          background: accentTint,
          color: accent,
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 1.3,
          textTransform: "uppercase",
          boxShadow: `inset 0 0 0 1px ${accent}`,
        }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: accent,
          }} />
          {badgeLabel}
        </span>
        <span style={{
          fontSize: 10,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: DIM,
          fontWeight: 800,
          fontFamily: "var(--font-mono), monospace",
        }}>
          Step {step + 1} of {steps.length}
        </span>
      </div>

      {/* Tab strip */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${steps.length}, 1fr)`,
        gap: 6,
        marginBottom: 12,
      }}>
        {steps.map((s, i) => {
          const active = i === step;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setStep(i);
                setPaused(true);
              }}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                padding: "8px 10px 10px",
                background: active ? accentTint : SOFT,
                border: `1px solid ${active ? accent : LINE}`,
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                transition: "background 160ms ease, border-color 160ms ease",
              }}
              aria-current={active ? "step" : undefined}
            >
              <span style={{
                fontSize: 9.5,
                letterSpacing: 0.7,
                color: active ? accent : DIM,
                fontFamily: "var(--font-mono), monospace",
                fontWeight: 800,
              }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{
                fontSize: 12.5,
                fontWeight: 800,
                color: active ? INK : MUTED,
                letterSpacing: -0.1,
                marginTop: 2,
              }}>
                {s.tabLabel}
              </span>
              <span style={{
                position: "absolute",
                left: 0,
                bottom: -1,
                height: 2,
                background: accent,
                borderRadius: 999,
                width: active ? "100%" : "0%",
                transition: reducedMotion
                  ? undefined
                  : active && !paused
                    ? `width ${STEP_MS - 100}ms linear`
                    : "width 200ms ease",
              }} />
            </button>
          );
        })}
      </div>

      {/* Clickable preview slot */}
      <Link
        key={step}
        href={current.href}
        onClick={onNavigate}
        className="pardle-tools-preview-link"
        style={{
          display: "block",
          textDecoration: "none",
          color: "inherit",
          animation: reducedMotion
            ? undefined
            : "toolsPreviewIn 320ms cubic-bezier(.2,.9,.3,1) both",
        }}
      >
        {current.render()}
      </Link>

      {/* Caption */}
      <p style={{
        margin: "12px 0 0",
        fontSize: 13,
        lineHeight: 1.45,
        color: MUTED,
        fontWeight: 500,
      }}>
        {current.caption}
      </p>

      <style>{`
        @keyframes toolsPreviewIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .pardle-tools-preview-link {
          transition: transform 160ms cubic-bezier(.2,.9,.3,1),
                      filter 160ms ease;
        }
        .pardle-tools-preview-link:hover,
        .pardle-tools-preview-link:focus-visible {
          transform: translateY(-2px);
          filter: brightness(1.02);
          outline: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .pardle-tools-preview-link:hover,
          .pardle-tools-preview-link:focus-visible {
            transform: none !important;
          }
        }
      `}</style>
    </div>
  );
}

// ── Preview building blocks ───────────────────────────────────────

interface PreviewShellProps {
  eyebrow: string;
  title: string;
  pill?: { label: string; tone: "emerald" | "blue" | "tang" };
  openLabel: string;
  accent: string;
  children: React.ReactNode;
}

function PreviewShell({
  eyebrow,
  title,
  pill,
  openLabel,
  accent,
  children,
}: PreviewShellProps) {
  const pillBg = pill?.tone === "blue" ? BLUE_TINT
    : pill?.tone === "tang" ? TANG_TINT : UP_TINT;
  const pillColor = pill?.tone === "blue" ? BLUE
    : pill?.tone === "tang" ? TANG : UP;
  return (
    <div style={{
      padding: "14px 14px 12px",
      background: CARD,
      border: `1px solid ${LINE}`,
      borderRadius: 12,
      boxShadow: "0 2px 8px oklch(0.15 0.02 150 / 0.03)",
    }}>
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 9.5,
            letterSpacing: 1.1,
            textTransform: "uppercase",
            color: DIM,
            fontWeight: 800,
          }}>
            {eyebrow}
          </div>
          <div style={{
            marginTop: 2,
            fontSize: 14,
            fontWeight: 800,
            color: INK,
            letterSpacing: -0.2,
          }}>
            {title}
          </div>
        </div>
        {pill && (
          <span style={{
            fontSize: 9.5,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            color: pillColor,
            fontWeight: 800,
            padding: "3px 8px",
            background: pillBg,
            borderRadius: 999,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}>
            {pill.label}
          </span>
        )}
      </div>
      {children}
      {/* Open affordance — matches on hover from Walkthrough */}
      <div style={{
        marginTop: 12,
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 4,
        fontSize: 10.5,
        letterSpacing: 0.9,
        textTransform: "uppercase",
        color: accent,
        fontWeight: 800,
      }}>
        {openLabel}
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
          stroke={accent} strokeWidth="2.4"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 6l6 6-6 6" />
        </svg>
      </div>
    </div>
  );
}

// ── BETS PATH — walkthrough steps ─────────────────────────────────

function BetSlipPreview() {
  return (
    <PreviewShell
      eyebrow="Add a bet"
      title="Scheffler · Top 10"
      pill={{ label: "Live tracked", tone: "emerald" }}
      openLabel="Open my bets"
      accent={UP}
    >
      <div style={{
        marginTop: 12,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8,
      }}>
        {[
          { label: "Player", value: "Scottie Scheffler" },
          { label: "Market", value: "Top 10 finish" },
          { label: "Stake", value: "£10.00" },
          { label: "Odds", value: "3.5" },
        ].map((f) => (
          <div key={f.label} style={{
            padding: "8px 10px",
            background: SOFT,
            border: `1px solid ${LINE}`,
            borderRadius: 8,
          }}>
            <div style={{
              fontSize: 9.5,
              letterSpacing: 0.9,
              textTransform: "uppercase",
              color: DIM,
              fontWeight: 800,
            }}>
              {f.label}
            </div>
            <div style={{
              marginTop: 2,
              fontSize: 13,
              fontWeight: 800,
              color: INK,
              fontFamily: f.label === "Stake" || f.label === "Odds"
                ? "var(--font-mono), monospace"
                : undefined,
              letterSpacing: -0.1,
            }}>
              {f.value}
            </div>
          </div>
        ))}
      </div>
    </PreviewShell>
  );
}

function BetLivePreview() {
  // Simple SVG chart of a rising win-probability trajectory.
  const points = [
    45, 48, 47, 52, 55, 54, 58, 62, 60, 66, 68, 65, 72, 74, 78,
  ];
  const w = 320;
  const h = 88;
  const padX = 6;
  const padY = 8;
  const pts = points.map((p, i) => ({
    x: padX + (i / (points.length - 1)) * (w - padX * 2),
    y: padY + (1 - p / 100) * (h - padY * 2),
  }));
  const path = pts.map((p, i) =>
    `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
  ).join(" ");
  const areaPath =
    `M ${pts[0].x} ${h - padY} ` +
    pts.map(p => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ") +
    ` L ${pts[pts.length - 1].x} ${h - padY} Z`;
  const last = pts[pts.length - 1];

  return (
    <PreviewShell
      eyebrow="Live win probability"
      title="Scheffler · Top 10 · R4 thru 15"
      pill={{ label: "78% win", tone: "emerald" }}
      openLabel="Open my bets"
      accent={UP}
    >
      <div style={{
        marginTop: 12,
        padding: "10px 8px 6px",
        background: SOFT,
        border: `1px solid ${LINE}`,
        borderRadius: 8,
      }}>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
          style={{ display: "block", width: "100%", height: h }}
          aria-hidden>
          <defs>
            <linearGradient id="betAreaGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={UP} stopOpacity={0.28} />
              <stop offset="100%" stopColor={UP} stopOpacity={0} />
            </linearGradient>
          </defs>
          {[25, 50, 75].map((v) => {
            const y = padY + (1 - v / 100) * (h - padY * 2);
            return (
              <line key={v}
                x1={padX} x2={w - padX} y1={y} y2={y}
                stroke={LINE} strokeDasharray="2 3" />
            );
          })}
          <path d={areaPath} fill="url(#betAreaGrad)" />
          <path d={path} fill="none" stroke={UP} strokeWidth={2.2}
            strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={last.x} cy={last.y} r={7} fill={UP} opacity={0.2} />
          <circle cx={last.x} cy={last.y} r={3} fill="white"
            stroke={UP} strokeWidth={2} />
        </svg>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          fontSize: 9.5,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          color: DIM,
          fontWeight: 800,
          marginTop: 4,
          fontFamily: "var(--font-mono), monospace",
        }}>
          <span>R1</span><span>R2</span><span>R3</span><span>R4</span>
        </div>
      </div>
      <div style={{
        marginTop: 10,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8,
      }}>
        {[
          { label: "Expected return", value: "+£18.20", tone: "emerald" },
          { label: "PnL if wins", value: "+£25.00", tone: "ink" },
        ].map((t) => (
          <div key={t.label} style={{
            padding: "8px 10px",
            background: SOFT,
            border: `1px solid ${LINE}`,
            borderRadius: 8,
          }}>
            <div style={{
              fontSize: 9.5,
              letterSpacing: 0.9,
              textTransform: "uppercase",
              color: DIM,
              fontWeight: 800,
            }}>
              {t.label}
            </div>
            <div style={{
              marginTop: 2,
              fontSize: 15,
              fontWeight: 800,
              color: t.tone === "emerald" ? UP : INK,
              fontFamily: "var(--font-mono), monospace",
              letterSpacing: -0.3,
              lineHeight: 1,
            }}>
              {t.value}
            </div>
          </div>
        ))}
      </div>
    </PreviewShell>
  );
}

function GroupsPreview() {
  const rows = [
    { rank: 1, name: "Alex", pnl: 145.20, you: false },
    { rank: 2, name: "You", pnl: 82.50, you: true },
    { rank: 3, name: "Ben", pnl: 41.10, you: false },
    { rank: 4, name: "Chris", pnl: -28.75, you: false },
  ];
  return (
    <PreviewShell
      eyebrow="Group P&L race"
      title="The Wolves · this week"
      pill={{ label: "4 members", tone: "emerald" }}
      openLabel="Open groups"
      accent={UP}
    >
      <div style={{
        marginTop: 12,
        display: "grid",
        gap: 6,
      }}>
        {rows.map((r) => (
          <div key={r.name} style={{
            display: "grid",
            gridTemplateColumns: "22px 1fr auto",
            gap: 12,
            alignItems: "center",
            padding: "9px 12px",
            background: r.you ? UP_TINT : SOFT,
            border: `1px solid ${r.you ? UP : LINE}`,
            borderRadius: 8,
          }}>
            <span style={{
              fontSize: 10.5,
              color: r.you ? UP_D : DIM,
              fontWeight: 800,
              fontFamily: "var(--font-mono), monospace",
            }}>
              {String(r.rank).padStart(2, "0")}
            </span>
            <span style={{
              fontSize: 13,
              fontWeight: 800,
              color: INK,
              letterSpacing: -0.1,
            }}>
              {r.name}
              {r.you && <span style={{
                marginLeft: 6,
                fontSize: 10,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                color: UP,
                fontWeight: 800,
              }}>You</span>}
            </span>
            <span style={{
              fontSize: 14,
              fontWeight: 800,
              color: r.pnl >= 0 ? UP : DOWN,
              fontFamily: "var(--font-mono), monospace",
              letterSpacing: -0.3,
              fontVariantNumeric: "tabular-nums",
            }}>
              {r.pnl >= 0 ? "+" : ""}£{r.pnl.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </PreviewShell>
  );
}

// ── LIVE PATH — walkthrough steps ─────────────────────────────────

/** Step 1 — the tracker's headline differentiator: shot alerts that
 *  only fire when the shot actually moves one of your bets, with the
 *  size of the impact quantified inline. */
function BetImpactPreview() {
  return (
    <PreviewShell
      eyebrow="Bet-impact alert"
      title="Scheffler · birdie on 14"
      pill={{ label: "+6% win prob", tone: "emerald" }}
      openLabel="Open shot tracker"
      accent={TANG}
    >
      {/* Shot line + monogram */}
      <div style={{
        marginTop: 12,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        background: SOFT,
        border: `1px solid ${LINE}`,
        borderRadius: 8,
      }}>
        <span style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          background: CARD,
          color: TANG,
          border: `1px solid ${TANG}`,
          display: "grid",
          placeItems: "center",
          fontSize: 11,
          fontWeight: 800,
          flexShrink: 0,
          fontFamily: "var(--font-mono), monospace",
          letterSpacing: -0.2,
        }} aria-hidden>
          SS
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12.5,
            fontWeight: 800,
            color: INK,
            letterSpacing: -0.1,
          }}>
            Scottie Scheffler <span style={{
              fontSize: 10,
              color: DIM,
              fontWeight: 600,
              fontFamily: "var(--font-mono), monospace",
            }}>· just now</span>
          </div>
          <div style={{
            fontSize: 12,
            color: MUTED,
            marginTop: 1,
            lineHeight: 1.35,
          }}>
            Rolls in a 22-foot birdie on 14
          </div>
        </div>
      </div>

      {/* Bet-impact panel — the differentiator */}
      <div style={{
        marginTop: 8,
        padding: "10px 12px",
        background: UP_TINT,
        border: `1px solid ${UP}`,
        borderRadius: 8,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}>
          <span style={{
            fontSize: 9.5,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: UP_D,
            fontWeight: 800,
          }}>
            Your bet · £10 @ 3.5
          </span>
          <span style={{
            fontSize: 10.5,
            fontWeight: 800,
            color: UP_D,
            fontFamily: "var(--font-mono), monospace",
            padding: "2px 7px",
            background: CARD,
            border: `1px solid ${UP}`,
            borderRadius: 999,
          }}>
            ↑ +6%
          </span>
        </div>
        <div style={{
          marginTop: 4,
          fontSize: 13,
          fontWeight: 800,
          color: INK,
          letterSpacing: -0.1,
        }}>
          Scheffler top 10 finish
        </div>
        <div style={{
          marginTop: 8,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}>
          {[
            { label: "Win prob", was: "68%", now: "74%" },
            { label: "Expected", was: "+£15.20", now: "+£18.40" },
          ].map((r) => (
            <div key={r.label} style={{
              padding: "6px 10px",
              background: CARD,
              border: `1px solid ${LINE}`,
              borderRadius: 6,
            }}>
              <div style={{
                fontSize: 9.5,
                letterSpacing: 0.9,
                textTransform: "uppercase",
                color: DIM,
                fontWeight: 800,
              }}>
                {r.label}
              </div>
              <div style={{
                marginTop: 2,
                display: "flex",
                alignItems: "baseline",
                gap: 6,
              }}>
                <span style={{
                  fontSize: 11,
                  color: DIM,
                  fontFamily: "var(--font-mono), monospace",
                  textDecoration: "line-through",
                }}>
                  {r.was}
                </span>
                <span style={{
                  fontSize: 13,
                  color: UP,
                  fontFamily: "var(--font-mono), monospace",
                  fontWeight: 800,
                  letterSpacing: -0.2,
                }}>
                  {r.now}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PreviewShell>
  );
}

/** Step 2 — customisable filters. The tracker only surfaces the
 *  shots the user has told it to care about. */
function CustomFiltersPreview() {
  const filters = [
    {
      label: "My players",
      value: "12 followed",
      body: "Scheffler · McIlroy · Åberg · Rahm · Clark · Schauffele +6",
      on: true,
    },
    {
      label: "Bet-relevant only",
      value: "3 active bets",
      body: "Only alerts on shots that move a bet you've logged.",
      on: true,
    },
    {
      label: "Birdies & better",
      value: "Skip pars, bogeys",
      body: "Cut the noise — the shot tracker keeps only the moments that matter.",
      on: true,
    },
    {
      label: "Every shot",
      value: "Off",
      body: "Firehose mode — everything the field hits, wave by wave.",
      on: false,
    },
  ];
  return (
    <PreviewShell
      eyebrow="Custom shot filters"
      title="Only what matters to you"
      pill={{ label: "3 on", tone: "tang" }}
      openLabel="Open shot tracker"
      accent={TANG}
    >
      <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
        {filters.map((f) => (
          <div key={f.label} style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "9px 11px",
            background: f.on ? TANG_TINT : SOFT,
            border: `1px solid ${f.on ? TANG : LINE}`,
            borderRadius: 8,
          }}>
            {/* Toggle */}
            <span style={{
              flexShrink: 0,
              width: 28,
              height: 16,
              borderRadius: 999,
              background: f.on ? TANG : "oklch(0.85 0.01 150)",
              position: "relative",
              marginTop: 2,
            }} aria-hidden>
              <span style={{
                position: "absolute",
                top: 2,
                left: f.on ? 14 : 2,
                width: 12,
                height: 12,
                borderRadius: 999,
                background: CARD,
              }} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                justifyContent: "space-between",
              }}>
                <span style={{
                  fontSize: 12.5,
                  fontWeight: 800,
                  color: INK,
                  letterSpacing: -0.1,
                }}>
                  {f.label}
                </span>
                <span style={{
                  fontSize: 10,
                  color: f.on ? TANG : DIM,
                  fontWeight: 800,
                  fontFamily: "var(--font-mono), monospace",
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                }}>
                  {f.value}
                </span>
              </div>
              <div style={{
                fontSize: 11.5,
                color: MUTED,
                marginTop: 1,
                lineHeight: 1.35,
              }}>
                {f.body}
              </div>
            </div>
          </div>
        ))}
      </div>
    </PreviewShell>
  );
}

/** Step 3 — speed. Big pulsing LIVE indicator, a shot that JUST
 *  landed on top, then two more in the shot stream underneath.
 *  No latency numbers, per the copy guardrail — "Live" and "Real-
 *  time" only. */
function LiveStreamPreview() {
  const older = [
    { name: "Ludvig Åberg", initials: "LA", line: "Holes out from the greenside bunker on 11" },
    { name: "Rory McIlroy", initials: "RM", line: "Approach on 12 to 6 feet — birdie look" },
  ];
  return (
    <PreviewShell
      eyebrow="Live shot-by-shot"
      title="Torrey Pines · Round 4"
      pill={{ label: "Live", tone: "tang" }}
      openLabel="Open shot tracker"
      accent={TANG}
    >
      {/* Hero: just-landed shot with a pulsing live indicator */}
      <div style={{
        marginTop: 12,
        padding: "12px 14px",
        background: TANG_TINT,
        border: `2px solid ${TANG}`,
        borderRadius: 10,
        position: "relative",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
        }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 9px 3px 7px",
            borderRadius: 999,
            background: CARD,
            color: TANG,
            fontSize: 9.5,
            fontWeight: 800,
            letterSpacing: 1.3,
            textTransform: "uppercase",
            boxShadow: `inset 0 0 0 1px ${TANG}`,
          }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: TANG,
                animation: "liveDotPulse 1.4s ease-out infinite",
              }}
              aria-hidden
            />
            Just landed
          </span>
          <span style={{
            fontSize: 10,
            color: TANG,
            fontWeight: 800,
            fontFamily: "var(--font-mono), monospace",
            letterSpacing: 0.5,
          }}>
            REAL-TIME
          </span>
        </div>
        <div style={{
          fontSize: 15,
          fontWeight: 800,
          color: INK,
          letterSpacing: -0.2,
        }}>
          Scottie Scheffler
        </div>
        <div style={{
          fontSize: 13,
          color: INK,
          marginTop: 2,
          lineHeight: 1.35,
          fontWeight: 500,
        }}>
          Rolls in a 22-foot birdie on 14
        </div>
      </div>

      {/* Older shots */}
      <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
        {older.map((s) => (
          <div key={s.name} style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "8px 10px",
            background: SOFT,
            border: `1px solid ${LINE}`,
            borderRadius: 8,
          }}>
            <span style={{
              width: 24,
              height: 24,
              borderRadius: 999,
              background: CARD,
              color: TANG,
              border: `1px solid ${TANG}`,
              display: "grid",
              placeItems: "center",
              fontSize: 10,
              fontWeight: 800,
              flexShrink: 0,
              fontFamily: "var(--font-mono), monospace",
              letterSpacing: -0.2,
            }} aria-hidden>
              {s.initials}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12,
                fontWeight: 800,
                color: INK,
                letterSpacing: -0.1,
              }}>
                {s.name}
              </div>
              <div style={{
                fontSize: 11.5,
                color: MUTED,
                marginTop: 1,
                lineHeight: 1.3,
              }}>
                {s.line}
              </div>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes liveDotPulse {
          0%, 100% { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
          70%      { box-shadow: 0 0 0 5px transparent; opacity: 0.6; }
        }
      `}</style>
    </PreviewShell>
  );
}

// ── TOOLS PATH — walkthrough steps ────────────────────────────────

function CourseFitPreview() {
  const rows = [
    { rank: 1, name: "Scottie Scheffler", edge: 1.46, dir: "up" as const },
    { rank: 2, name: "Rory McIlroy", edge: 1.28, dir: "up" as const },
    { rank: 3, name: "Xander Schauffele", edge: 0.62, dir: "up" as const },
    { rank: 4, name: "Wyndham Clark", edge: -0.72, dir: "down" as const },
  ];
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.edge)));
  return (
    <PreviewShell
      eyebrow="Course-fit forecast"
      title="Torrey Pines · this week"
      pill={{ label: "Trusted · CV R² 0.083", tone: "emerald" }}
      openLabel="Open course fit"
      accent={BLUE}
    >
      <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
        {rows.map((row) => {
          const barPct = (Math.abs(row.edge) / maxAbs) * 42;
          const c = row.dir === "up" ? UP : DOWN;
          return (
            <div key={row.rank} style={{
              display: "grid",
              gridTemplateColumns: "18px 1fr 1fr 52px",
              gap: 10,
              alignItems: "center",
              padding: "7px 10px",
              background: SOFT,
              border: `1px solid ${LINE}`,
              borderRadius: 8,
            }}>
              <span style={{
                fontSize: 10,
                color: DIM,
                fontWeight: 800,
                fontFamily: "var(--font-mono), monospace",
              }}>
                {String(row.rank).padStart(2, "0")}
              </span>
              <span style={{
                fontSize: 12.5,
                fontWeight: 800,
                color: INK,
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
                background: CARD,
                border: `1px solid ${LINE}`,
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
                  background: DIM,
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
    </PreviewShell>
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
    <PreviewShell
      eyebrow="Round-score forecast"
      title="Scheffler · Sunday R4"
      pill={{ label: "Model", tone: "blue" }}
      openLabel="Open round forecast"
      accent={BLUE}
    >
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
                background: isMode ? UP : SOFT,
                border: isMode ? `1px solid ${UP}` : `1px solid ${LINE}`,
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
            color: b.score === modeScore ? INK : DIM,
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
        {[
          { label: "Median", value: "68", tone: "ink" as const },
          { label: "Best 5%", value: "65", tone: "emerald" as const },
          { label: "Worst 5%", value: "71", tone: "ink" as const },
        ].map((t) => (
          <div key={t.label} style={{
            padding: "8px 10px",
            background: SOFT,
            border: `1px solid ${LINE}`,
            borderRadius: 8,
          }}>
            <div style={{
              fontSize: 9.5,
              letterSpacing: 0.9,
              textTransform: "uppercase",
              color: DIM,
              fontWeight: 800,
            }}>
              {t.label}
            </div>
            <div style={{
              marginTop: 2,
              fontSize: 16,
              fontWeight: 800,
              color: t.tone === "emerald" ? UP : INK,
              fontFamily: "var(--font-mono), monospace",
              letterSpacing: -0.3,
            }}>
              {t.value}
            </div>
          </div>
        ))}
      </div>
    </PreviewShell>
  );
}

function TeeShotPreview() {
  const stats = [
    { label: "Ball speed", value: "183 mph", pct: 96 },
    { label: "Apex height", value: "122 ft", pct: 82 },
    { label: "Curve", value: "3.4° draw", pct: 58 },
  ];
  return (
    <PreviewShell
      eyebrow="Tee-shot profile"
      title="Rory McIlroy · Driver"
      pill={{ label: "Radar · 3 seasons", tone: "blue" }}
      openLabel="Open tee-shots"
      accent={BLUE}
    >
      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        {stats.map((s) => (
          <div key={s.label} style={{
            padding: "10px 12px",
            background: SOFT,
            border: `1px solid ${LINE}`,
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
                color: INK,
                letterSpacing: -0.1,
              }}>
                {s.label}
              </span>
              <span style={{
                fontSize: 13,
                fontWeight: 800,
                color: INK,
                fontFamily: "var(--font-mono), monospace",
                fontVariantNumeric: "tabular-nums",
              }}>
                {s.value}
              </span>
            </div>
            <div style={{
              marginTop: 6,
              height: 5,
              background: CARD,
              border: `1px solid ${LINE}`,
              borderRadius: 999,
              overflow: "hidden",
            }}>
              <div style={{
                width: `${s.pct}%`,
                height: "100%",
                background: UP,
                borderRadius: 999,
              }} />
            </div>
            <div style={{
              marginTop: 4,
              fontSize: 10.5,
              color: MUTED,
              fontWeight: 700,
            }}>
              {s.pct}th percentile · tour field
            </div>
          </div>
        ))}
      </div>
    </PreviewShell>
  );
}

// ── Exported sims ─────────────────────────────────────────────────

const BET_STEPS: WalkthroughStep[] = [
  {
    key: "log",
    tabLabel: "Log a bet",
    href: "/bets",
    caption: "Punch in the player, market, stake and odds. Takes 20 seconds — no bookmaker link required.",
    render: () => <BetSlipPreview />,
  },
  {
    key: "live",
    tabLabel: "Live tracking",
    href: "/bets",
    caption: "Every shot on course repricess win probability, expected return and settlement in real time.",
    render: () => <BetLivePreview />,
  },
  {
    key: "groups",
    tabLabel: "Groups",
    href: "/groups",
    caption: "Race a P&L leaderboard against your mates — every bet everyone lands, side-by-side.",
    render: () => <GroupsPreview />,
  },
];

const LIVE_STEPS: WalkthroughStep[] = [
  {
    key: "bet-impact",
    tabLabel: "Bet-impact alerts",
    href: "/live",
    caption:
      "Every shot that measurably moves one of your bets — the swing quantified inline, no hunting for the ripple.",
    render: () => <BetImpactPreview />,
  },
  {
    key: "custom",
    tabLabel: "Customisable",
    href: "/live",
    caption:
      "You set the filters — players you follow, bet-relevant only, birdies and better. The tracker keeps the noise out.",
    render: () => <CustomFiltersPreview />,
  },
  {
    key: "fast",
    tabLabel: "Real-time",
    href: "/live",
    caption:
      "Live shot-by-shot — every shot appears the moment it lands, no reload, no waiting on the broadcast.",
    render: () => <LiveStreamPreview />,
  },
];

const TOOL_STEPS: WalkthroughStep[] = [
  {
    key: "course-fit",
    tabLabel: "Course fit",
    href: "/analysis/course-history",
    caption: "Rank the field by predicted OTT edge vs each player's own baseline — cross-validated so the confidence is honest.",
    render: () => <CourseFitPreview />,
  },
  {
    key: "round-forecast",
    tabLabel: "Round score",
    href: "/analysis/score-forecast",
    caption: "Full round-score distribution — median, upside, downside — for any player at any course.",
    render: () => <RoundForecastPreview />,
  },
  {
    key: "tee-shots",
    tabLabel: "Ballstriking",
    href: "/analysis/tee-shots",
    caption: "Radar-tracked ball speed, apex and shot curve — the ingredients the course-fit model reads.",
    render: () => <TeeShotPreview />,
  },
];

export function BetSimulation({ onNavigate }: { onNavigate: () => void }) {
  return (
    <Walkthrough
      badgeLabel="Bets tour"
      accent={UP}
      accentTint={UP_TINT}
      steps={BET_STEPS}
      onNavigate={onNavigate}
    />
  );
}

export function LiveFeedSimulation({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  return (
    <Walkthrough
      badgeLabel="Live tour"
      accent={TANG}
      accentTint={TANG_TINT}
      steps={LIVE_STEPS}
      onNavigate={onNavigate}
    />
  );
}

export function ToolsSimulation({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  return (
    <Walkthrough
      badgeLabel="Tools tour"
      accent={BLUE}
      accentTint={BLUE_TINT}
      steps={TOOL_STEPS}
      onNavigate={onNavigate}
    />
  );
}

// ── Reduced-motion detection ──────────────────────────────────────

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
