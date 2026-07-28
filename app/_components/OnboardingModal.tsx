"use client";

/**
 * First-visit onboarding modal. Segments the user by intent
 * (bets / live shots / prediction tools) and points them at the
 * two or three pages that matter most for that intent — so a
 * first-timer lands on their thing in one tap, instead of scanning
 * the whole nav.
 *
 * Localstorage-gated: shows once, marks-seen on any dismiss
 * (X click, backdrop click, or "Take me there" CTA).
 *
 * Bump SEEN_KEY suffix when the modal content meaningfully changes
 * so returning users get the refreshed experience once.
 *
 * Delivered as a bottom sheet on mobile (matches iOS action-sheet
 * ergonomics) and a centered dialog on desktop. Mounted at layout
 * root so it can fire on any landing page.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BetSimulation,
  LiveFeedSimulation,
  ToolsSimulation,
} from "./OnboardingSims";

const SEEN_KEY = "pardle.onboarding.v1";

type Intent = "bets" | "live" | "tools";

interface IntentOption {
  id: Intent;
  label: string;
  blurb: string;
  icon: React.ReactNode;
  accent: string;
}

interface Recommendation {
  href: string;
  label: string;
  blurb: string;
  /** Simple emoji glyph shown in a small tile at the left of the row.
   *  Keeps the visual weight of the recommendation cards up without
   *  pulling in SVG icons per link. */
  icon: string;
}

interface ExplainerCard {
  title: string;
  /** One-line promise shown above the interactive sim. Kept short
   *  and high-contrast — this is the reader's whole reason to
   *  read on. */
  lede: string;
  primaryHref: string;
  primaryLabel: string;
  primaryHint: string;
  secondaries: Recommendation[];
  accent: string;
  simulation: "bets" | "live" | "tools";
}

// Palette lifted from social-v2 tokens so the modal reads as part
// of the app, not a bolted-on lightbox.
const EMERALD = "oklch(0.50 0.13 155)";
const EMERALD_D = "oklch(0.40 0.12 156)";
const EMERALD_TINT = "oklch(0.96 0.04 155)";
const TANG = "oklch(0.66 0.18 45)";
// Third intent uses a blue accent so the three choice cards are
// visually distinguishable at a glance.
const BLUE = "oklch(0.55 0.14 245)";
const INK = "oklch(0.26 0.04 155)";
const MUTED = "oklch(0.50 0.02 150)";
const DIM = "oklch(0.62 0.018 150)";
const LINE = "oklch(0.90 0.013 95)";
const CARD = "oklch(0.995 0.004 95)";
const SOFT = "oklch(0.945 0.012 95)";

const INTENTS: IntentOption[] = [
  {
    id: "bets",
    label: "Track my bets",
    blurb: "Log wagers placed elsewhere and watch each one move live.",
    accent: EMERALD,
    icon: (
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
        stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 4h11l3 3v13H5z" />
        <path d="M9 9h6M9 13h6M9 17h3" />
      </svg>
    ),
  },
  {
    id: "live",
    label: "Watch live shots",
    blurb: "Follow the tournament shot-by-shot as it plays out.",
    accent: TANG,
    icon: (
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
        stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        <path d="M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      </svg>
    ),
  },
  {
    id: "tools",
    label: "Predict with data",
    blurb: "Course-fit, round-score forecasts, ballstriking scans.",
    accent: BLUE,
    icon: (
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none"
        stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 20V4M4 20h16" />
        <path d="M8 16v-4M12 16V9M16 16v-6" />
      </svg>
    ),
  },
];

const EXPLAINERS: Record<Intent, ExplainerCard> = {
  bets: {
    title: "Your bet, live on every shot",
    lede: "Log a bet and watch it move — win probability, expected return, and settlement all reprice on every shot on course.",
    primaryHref: "/bets",
    primaryLabel: "Add my first bet",
    primaryHint: "20 seconds — no bookmaker link required",
    accent: EMERALD,
    simulation: "bets",
    secondaries: [
      {
        href: "/groups",
        label: "Groups",
        blurb: "Race a P&L leaderboard against your mates.",
        icon: "🏆",
      },
      {
        href: "/",
        label: "Insights",
        blurb: "Editorial reads and running commentary on every notable bet in play.",
        icon: "💬",
      },
    ],
  },
  live: {
    title: "The tournament, live",
    lede: "Every birdie, hole-out and playoff putt lands on the shot tracker the moment it happens — react, comment, share.",
    primaryHref: "/live",
    primaryLabel: "Open the shot tracker",
    primaryHint: "Watch the current tournament right now",
    accent: TANG,
    simulation: "live",
    secondaries: [
      {
        href: "/",
        label: "Insights",
        blurb: "Editorial reads, quick takes, pre-tournament briefings.",
        icon: "📰",
      },
      {
        href: "/analysis/tee-time-scoring",
        label: "Tee-time scoring",
        blurb: "How the field is scoring wave-by-wave through the day.",
        icon: "⏱️",
      },
    ],
  },
  tools: {
    title: "Predictions you can trust",
    lede: "Tap through the three tools — course fit, round-score forecasts, ballstriking — all cross-validated.",
    primaryHref: "/analysis",
    primaryLabel: "Browse the tools",
    primaryHint: "Course-fit, round forecast, tee-shot profiles",
    accent: BLUE,
    simulation: "tools",
    secondaries: [
      {
        href: "/analysis/course-history",
        label: "Course-fit forecast",
        blurb: "Ranked list of who's built for the course — with honest CV R².",
        icon: "🎯",
      },
      {
        href: "/analysis/score-forecast",
        label: "Round-score forecast",
        blurb: "Full round-score distribution for any player, any course.",
        icon: "📊",
      },
    ],
  },
};

export function OnboardingModal() {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Intent | null>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN_KEY) === "1") return;
    } catch {
      // localStorage blocked — proceed with the delay anyway; if
      // localStorage is unavailable at write-time we'll just show
      // again next session.
    }
    // Let the user actually see the site before we interrupt.
    // Anything under ~3s feels like a hijack; anything over ~8s
    // and half the audience has already navigated on.
    const OPEN_DELAY_MS = 5000;
    const t = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  // Snappy in-transition: one frame after mount, flip `entered` so
  // the CSS transition fires from the initial off-state.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function dismiss() {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // ignore
    }
    setEntered(false);
    // Give the exit transition a beat, then unmount.
    window.setTimeout(() => setOpen(false), 180);
  }

  if (!open) return null;

  const explainer = choice ? EXPLAINERS[choice] : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      onClick={dismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: entered ? "oklch(0.15 0.02 150 / 0.55)" : "oklch(0.15 0.02 150 / 0)",
        transition: "background 220ms ease",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        fontFamily: "var(--font-archivo), var(--font-sans), sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 560,
          background: CARD,
          backgroundImage: "radial-gradient(120% 80% at 50% 0%, oklch(0.99 0.02 155) 0%, transparent 60%)",
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          padding: "26px 22px 30px",
          transform: entered
            ? "translateY(0) scale(1)"
            : "translateY(24px) scale(0.985)",
          transformOrigin: "50% 100%",
          opacity: entered ? 1 : 0,
          transition:
            "transform 260ms cubic-bezier(.22,.9,.3,1.05), opacity 200ms ease",
          boxShadow:
            "0 -12px 40px oklch(0.15 0.02 150 / 0.18), 0 0 0 1px oklch(0.15 0.02 150 / 0.06)",
          maxHeight: "92vh",
          overflowY: "auto",
        }}
        className="pardle-onboard-card"
      >
        <button
          type="button"
          aria-label="Close onboarding"
          onClick={dismiss}
          style={closeBtnStyle()}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
            stroke="currentColor" strokeWidth="2"
            strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {!choice ? (
          <IntentStep onPick={setChoice} />
        ) : (
          <ExplainerStep
            explainer={explainer!}
            onBack={() => setChoice(null)}
            onGo={dismiss}
          />
        )}
      </div>

      {/* Desktop shift + motion + hover states. Kept in one file
          via inline <style> so the modal ships without touching
          globals.css. Modal grows to ~75% viewport on desktop —
          the sim panels earn the real estate. */}
      <style>{`
        @media (min-width: 640px) {
          .pardle-onboard-card {
            border-radius: 20px !important;
            margin-bottom: auto !important;
            margin-top: auto !important;
            width: 75vw !important;
            max-width: 900px !important;
            padding: 32px 40px 34px !important;
          }
        }
        @media (min-width: 1080px) {
          .pardle-onboard-card {
            max-width: 1000px !important;
          }
        }
        @keyframes onboardPulse {
          0%   { box-shadow: 0 0 0 0 currentColor; opacity: 1; }
          70%  { box-shadow: 0 0 0 8px transparent; opacity: 0.55; }
          100% { box-shadow: 0 0 0 0 transparent; opacity: 1; }
        }
        @keyframes onboardStagger {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        /* Staggered entrance for the second step's content.
           Elements each set their own animation-delay inline. */
        .pardle-onboard-title,
        .pardle-onboard-lede,
        .pardle-onboard-sim,
        .pardle-onboard-secondary {
          animation: onboardStagger 380ms cubic-bezier(.2,.9,.3,1) both;
        }
        /* Primary CTA — hover lift + brighter shadow. */
        .pardle-onboard-cta {
          transition: transform 160ms cubic-bezier(.2,.9,.3,1),
                      box-shadow 160ms ease,
                      filter 160ms ease;
        }
        .pardle-onboard-cta:hover,
        .pardle-onboard-cta:focus-visible {
          transform: translateY(-1px);
          filter: brightness(1.03);
          outline: none;
        }
        .pardle-onboard-cta:active {
          transform: translateY(0);
        }
        /* Secondary link rows — background + border shift + chevron
           advance on hover so they feel tappable. */
        .pardle-onboard-secondary {
          transition: background 160ms ease, border-color 160ms ease,
                      transform 160ms ease;
        }
        .pardle-onboard-secondary:hover,
        .pardle-onboard-secondary:focus-visible {
          background: oklch(0.985 0.014 95) !important;
          border-color: oklch(0.82 0.02 150) !important;
          outline: none;
        }
        .pardle-onboard-secondary:hover .pardle-onboard-chevron,
        .pardle-onboard-secondary:focus-visible .pardle-onboard-chevron {
          transform: translateX(2px);
          transition: transform 160ms cubic-bezier(.2,.9,.3,1);
        }
        .pardle-onboard-chevron {
          transition: transform 160ms cubic-bezier(.2,.9,.3,1);
        }
        /* Back button — subtle hover swatch. */
        .pardle-onboard-back {
          transition: background 140ms ease, color 140ms ease;
        }
        .pardle-onboard-back:hover,
        .pardle-onboard-back:focus-visible {
          background: oklch(0.955 0.012 95) !important;
          color: oklch(0.32 0.03 155) !important;
          outline: none;
        }
        /* Step-1 intent cards — bigger hover state so they read as
           obviously clickable. Chevron slides + card lifts. */
        .pardle-onboard-choice:hover,
        .pardle-onboard-choice:focus-visible {
          transform: translateY(-2px);
          border-color: oklch(0.78 0.02 150) !important;
          outline: none;
        }
        .pardle-onboard-choice:hover .pardle-onboard-choice-chevron,
        .pardle-onboard-choice:focus-visible .pardle-onboard-choice-chevron {
          transform: translateX(3px);
          transition: transform 160ms cubic-bezier(.2,.9,.3,1);
        }
        .pardle-onboard-choice-chevron {
          transition: transform 160ms cubic-bezier(.2,.9,.3,1);
        }
        .pardle-onboard-choice:active {
          transform: translateY(0);
        }
        /* Step-1 hero title — a touch larger on desktop where we
           have the real estate for it. */
        @media (min-width: 640px) {
          .pardle-onboard-hero {
            font-size: 42px !important;
            letter-spacing: -1.2px !important;
          }
        }
        /* Respect reduced-motion — kill entrance stagger + hover
           translations so nothing moves for users who ask. */
        @media (prefers-reduced-motion: reduce) {
          .pardle-onboard-title,
          .pardle-onboard-lede,
          .pardle-onboard-sim,
          .pardle-onboard-secondary {
            animation: none !important;
          }
          .pardle-onboard-cta:hover,
          .pardle-onboard-secondary:hover .pardle-onboard-chevron,
          .pardle-onboard-choice:hover,
          .pardle-onboard-choice:focus-visible,
          .pardle-onboard-choice:hover .pardle-onboard-choice-chevron,
          .pardle-onboard-choice:focus-visible .pardle-onboard-choice-chevron {
            transform: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function IntentStep({ onPick }: { onPick: (i: Intent) => void }) {
  return (
    <>
      <div style={{
        ...eyebrowStyle(),
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px 5px 8px",
        borderRadius: 999,
        background: EMERALD_TINT,
        color: EMERALD_D,
        marginBottom: 12,
      }}>
        <span style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: EMERALD,
        }} />
        Welcome to Pardle
      </div>
      <h2
        id="onboarding-title"
        className="pardle-onboard-hero"
        style={{
          margin: 0,
          fontSize: 34,
          lineHeight: 1.02,
          letterSpacing: -0.9,
          fontWeight: 900,
          color: INK,
          textWrap: "balance" as React.CSSProperties["textWrap"],
        }}
      >
        What brings you here?
      </h2>
      <p style={{
        margin: "12px 0 22px",
        fontSize: 17,
        lineHeight: 1.45,
        color: INK,
        fontWeight: 500,
        maxWidth: 540,
      }}>
        Pick one — we&apos;ll show you exactly what Pardle does for you.
      </p>
      <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
        {INTENTS.map((intent) => (
          <button
            key={intent.id}
            type="button"
            onClick={() => onPick(intent.id)}
            style={intentBtnStyle(intent.accent)}
            className="pardle-onboard-choice"
          >
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: 54,
                height: 54,
                borderRadius: 14,
                background: intent.accent === EMERALD
                  ? EMERALD_TINT
                  : intent.accent === TANG
                    ? "oklch(0.965 0.045 60)"
                    : "oklch(0.965 0.04 240)",
                color: intent.accent,
                flexShrink: 0,
                boxShadow: `inset 0 0 0 1px ${intent.accent}`,
              }}
              aria-hidden
            >
              {intent.icon}
            </span>
            <span style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
              <span style={{
                display: "block",
                fontSize: 18,
                fontWeight: 900,
                color: INK,
                letterSpacing: -0.3,
                lineHeight: 1.15,
              }}>
                {intent.label}
              </span>
              <span style={{
                display: "block",
                fontSize: 13.5,
                color: INK,
                marginTop: 3,
                lineHeight: 1.4,
                fontWeight: 500,
                opacity: 0.72,
              }}>
                {intent.blurb}
              </span>
            </span>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
              stroke={intent.accent} strokeWidth="2.4"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden
              className="pardle-onboard-choice-chevron">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        ))}
      </div>
      <p style={{
        marginTop: 20,
        fontSize: 11.5,
        color: DIM,
        textAlign: "center",
        letterSpacing: 0.3,
        fontWeight: 700,
      }}>
        Pardle is a bet tracker, not a bookmaker. 18+.
      </p>
    </>
  );
}

function ExplainerStep({
  explainer,
  onBack,
  onGo,
}: {
  explainer: ExplainerCard;
  onBack: () => void;
  onGo: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        style={backBtnStyle()}
        aria-label="Change interest"
        className="pardle-onboard-back"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
          stroke="currentColor" strokeWidth="2.4"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Change interest
      </button>
      <div style={{ ...eyebrowStyle(), color: explainer.accent }}>
        How it works
      </div>
      <h2
        id="onboarding-title"
        className="pardle-onboard-title"
        style={{
          ...titleStyle(),
          fontSize: 28,
          letterSpacing: -0.5,
          marginTop: 4,
          animationDelay: "40ms",
        }}
      >
        {explainer.title}
      </h2>
      <p
        className="pardle-onboard-lede"
        style={{
          margin: "10px 0 16px",
          fontSize: 15,
          lineHeight: 1.5,
          color: INK,
          maxWidth: 560,
          fontWeight: 500,
          animationDelay: "120ms",
        }}
      >
        {explainer.lede}
      </p>

      {/* Interactive simulation — the star of the second step. */}
      <div
        className="pardle-onboard-sim"
        style={{ animationDelay: "200ms" }}
      >
        {explainer.simulation === "bets" && <BetSimulation />}
        {explainer.simulation === "live" && <LiveFeedSimulation />}
        {explainer.simulation === "tools" && <ToolsSimulation />}
      </div>

      <Link
        href={explainer.primaryHref}
        onClick={onGo}
        style={primaryCtaStyle(explainer.accent)}
        className="pardle-onboard-cta"
      >
        <span style={{ display: "block", fontSize: 16 }}>
          {explainer.primaryLabel}
        </span>
        <span style={{
          display: "block",
          fontSize: 11.5,
          fontWeight: 600,
          marginTop: 3,
          opacity: 0.88,
          letterSpacing: 0.15,
        }}>
          {explainer.primaryHint}
        </span>
      </Link>

      <div style={{
        marginTop: 20,
        fontSize: 10.5,
        letterSpacing: 1.4,
        textTransform: "uppercase",
        color: DIM,
        fontWeight: 800,
      }}>
        Also useful
      </div>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {explainer.secondaries.map((sec, i) => (
          <Link
            key={sec.href}
            href={sec.href}
            onClick={onGo}
            style={{
              ...secondaryLinkStyle(),
              animationDelay: `${320 + i * 90}ms`,
            }}
            className="pardle-onboard-secondary"
          >
            <span
              aria-hidden
              style={{
                display: "grid",
                placeItems: "center",
                width: 38,
                height: 38,
                borderRadius: 10,
                background: "white",
                border: `1px solid ${LINE}`,
                fontSize: 18,
                flexShrink: 0,
              }}
            >
              {sec.icon}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                display: "block",
                fontSize: 14,
                fontWeight: 800,
                color: INK,
                letterSpacing: -0.1,
              }}>
                {sec.label}
              </span>
              <span style={{
                display: "block",
                fontSize: 12.5,
                color: MUTED,
                marginTop: 2,
                lineHeight: 1.4,
              }}>
                {sec.blurb}
              </span>
            </span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
              stroke={DIM} strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden
              className="pardle-onboard-chevron">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        ))}
      </div>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────

function eyebrowStyle(): React.CSSProperties {
  return {
    fontSize: 11,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: EMERALD_D,
    fontWeight: 800,
    marginBottom: 6,
  };
}

function titleStyle(): React.CSSProperties {
  return {
    margin: 0,
    fontSize: 22,
    fontWeight: 800,
    color: INK,
    letterSpacing: -0.3,
    lineHeight: 1.15,
    textWrap: "balance" as React.CSSProperties["textWrap"],
  };
}

function ledeStyle(): React.CSSProperties {
  return {
    margin: "8px 0 18px",
    fontSize: 14,
    lineHeight: 1.5,
    color: MUTED,
  };
}

function closeBtnStyle(): React.CSSProperties {
  return {
    position: "absolute",
    top: 12,
    right: 12,
    display: "grid",
    placeItems: "center",
    width: 34,
    height: 34,
    borderRadius: 999,
    background: SOFT,
    border: "none",
    color: MUTED,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
  };
}

function backBtnStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 8px 4px 4px",
    marginBottom: 12,
    marginLeft: -4,
    fontSize: 11.5,
    fontWeight: 800,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: MUTED,
    background: "transparent",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

function intentBtnStyle(accent: string): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 16,
    width: "100%",
    padding: "16px 16px",
    background: CARD,
    border: `1px solid ${LINE}`,
    borderRadius: 16,
    cursor: "pointer",
    fontFamily: "inherit",
    minHeight: 86,
    // Layered depth: subtle drop shadow + prominent accent bottom
    // stroke that reads as a colour-coded intent tab.
    boxShadow: `
      0 1px 0 ${LINE},
      inset 0 -3px 0 ${accent},
      0 6px 16px oklch(0.15 0.02 150 / 0.05)
    `,
    transition:
      "transform 160ms cubic-bezier(.2,.9,.3,1), box-shadow 160ms ease, border-color 160ms ease",
    textAlign: "left",
  };
}

function primaryCtaStyle(accent: string): React.CSSProperties {
  return {
    display: "block",
    marginTop: 6,
    padding: "14px 18px",
    borderRadius: 12,
    background: accent,
    color: "white",
    fontSize: 15,
    fontWeight: 800,
    letterSpacing: -0.1,
    textAlign: "center",
    textDecoration: "none",
    boxShadow: `0 6px 20px ${accent === EMERALD ? "oklch(0.50 0.13 155 / 0.32)" :
      accent === TANG ? "oklch(0.66 0.18 45 / 0.28)" :
      "oklch(0.55 0.14 245 / 0.28)"}`,
    transition: "transform 140ms ease, box-shadow 140ms ease",
  };
}

function secondaryLinkStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    background: SOFT,
    border: `1px solid ${LINE}`,
    borderRadius: 10,
    textDecoration: "none",
    transition: "background 140ms ease, border-color 140ms ease",
  };
}
