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
}

interface ExplainerCard {
  title: string;
  lede: string;
  primaryHref: string;
  primaryLabel: string;
  primaryHint: string;
  secondaries: Recommendation[];
  accent: string;
}

// Palette lifted from social-v2 tokens so the modal reads as part
// of the app, not a bolted-on lightbox.
const EMERALD = "oklch(0.50 0.13 155)";
const EMERALD_D = "oklch(0.40 0.12 156)";
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
    title: "Your bet tracker",
    lede: "Log the bets you placed with your bookmaker and Pardle keeps them alive — PnL, win probability and settlement all update as shots land.",
    primaryHref: "/bets",
    primaryLabel: "Go to My bets",
    primaryHint: "Add your first bet — takes 20 seconds",
    accent: EMERALD,
    secondaries: [
      {
        href: "/groups",
        label: "Groups",
        blurb: "Race a P&L leaderboard against your mates.",
      },
      {
        href: "/",
        label: "The feed",
        blurb: "Reactions and running commentary on every notable bet in play.",
      },
    ],
  },
  live: {
    title: "Live shot tracker",
    lede: "The tournament as it happens — every notable shot, hole-out, birdie and bogey lands in your feed the moment it happens.",
    primaryHref: "/live",
    primaryLabel: "Open the shot tracker",
    primaryHint: "See the current tournament right now",
    accent: TANG,
    secondaries: [
      {
        href: "/",
        label: "Insights",
        blurb: "Editorial reads, quick takes and pre-tournament briefings.",
      },
      {
        href: "/analysis/tee-time-scoring",
        label: "Tee-time scoring",
        blurb: "See how the field is scoring wave-by-wave through the day.",
      },
    ],
  },
  tools: {
    title: "Prediction tools",
    lede: "Data-driven research tools for pre-tournament reads and in-play adjustments — same model layer that our forecast articles run on.",
    primaryHref: "/analysis",
    primaryLabel: "Browse the tools",
    primaryHint: "Course-fit, round forecast, tee-shot profiles",
    accent: BLUE,
    secondaries: [
      {
        href: "/analysis/course-history",
        label: "Course-fit forecast",
        blurb: "Which players are built for this course, ranked by predicted OTT edge.",
      },
      {
        href: "/analysis/score-forecast",
        label: "Round-score forecast",
        blurb: "Predicted round distribution for any player at any course.",
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
      if (window.localStorage.getItem(SEEN_KEY) !== "1") {
        setOpen(true);
      }
    } catch {
      setOpen(true);
    }
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
          maxWidth: 520,
          background: CARD,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          padding: "24px 22px 28px",
          transform: entered ? "translateY(0)" : "translateY(24px)",
          opacity: entered ? 1 : 0,
          transition:
            "transform 220ms cubic-bezier(.2,.9,.3,1), opacity 200ms ease",
          boxShadow: "0 -12px 40px oklch(0.15 0.02 150 / 0.18)",
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

      {/* Desktop shift: centered card instead of bottom-sheet on
          screens ≥ 640px. Kept in one file with @media in a
          <style> tag so the component ships without touching
          globals.css. */}
      <style>{`
        @media (min-width: 640px) {
          .pardle-onboard-card {
            border-radius: 18px !important;
            margin-bottom: auto !important;
            margin-top: auto !important;
            max-width: 480px !important;
          }
        }
      `}</style>
    </div>
  );
}

function IntentStep({ onPick }: { onPick: (i: Intent) => void }) {
  return (
    <>
      <div style={eyebrowStyle()}>Welcome to Pardle</div>
      <h2 id="onboarding-title" style={titleStyle()}>
        What brings you here?
      </h2>
      <p style={ledeStyle()}>
        One tap and we&apos;ll point you at the pages built for your
        thing.
      </p>
      <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
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
                width: 44,
                height: 44,
                borderRadius: 12,
                background: SOFT,
                color: intent.accent,
                flexShrink: 0,
              }}
              aria-hidden
            >
              {intent.icon}
            </span>
            <span style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
              <span style={{
                display: "block",
                fontSize: 15.5,
                fontWeight: 800,
                color: INK,
                letterSpacing: -0.1,
              }}>
                {intent.label}
              </span>
              <span style={{
                display: "block",
                fontSize: 12.5,
                color: MUTED,
                marginTop: 2,
                lineHeight: 1.4,
              }}>
                {intent.blurb}
              </span>
            </span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
              stroke={DIM} strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        ))}
      </div>
      <p style={{
        marginTop: 18,
        fontSize: 11,
        color: DIM,
        textAlign: "center",
        letterSpacing: 0.2,
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
        aria-label="Back to interest picker"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
          stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Something else
      </button>
      <div style={{ ...eyebrowStyle(), color: explainer.accent }}>
        Your starter kit
      </div>
      <h2 id="onboarding-title" style={titleStyle()}>
        {explainer.title}
      </h2>
      <p style={ledeStyle()}>{explainer.lede}</p>

      <Link
        href={explainer.primaryHref}
        onClick={onGo}
        style={primaryCtaStyle(explainer.accent)}
        className="pardle-onboard-cta"
      >
        <span style={{ display: "block" }}>{explainer.primaryLabel}</span>
        <span style={{
          display: "block",
          fontSize: 11.5,
          fontWeight: 600,
          marginTop: 2,
          opacity: 0.85,
          letterSpacing: 0.1,
        }}>
          {explainer.primaryHint}
        </span>
      </Link>

      <div style={{
        marginTop: 18,
        fontSize: 10.5,
        letterSpacing: 1.2,
        textTransform: "uppercase",
        color: DIM,
        fontWeight: 800,
      }}>
        Also useful
      </div>
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {explainer.secondaries.map((sec) => (
          <Link
            key={sec.href}
            href={sec.href}
            onClick={onGo}
            style={secondaryLinkStyle()}
            className="pardle-onboard-secondary"
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                display: "block",
                fontSize: 13.5,
                fontWeight: 800,
                color: INK,
              }}>
                {sec.label}
              </span>
              <span style={{
                display: "block",
                fontSize: 12,
                color: MUTED,
                marginTop: 1,
                lineHeight: 1.4,
              }}>
                {sec.blurb}
              </span>
            </span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
              stroke={DIM} strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
    gap: 14,
    width: "100%",
    padding: "14px 14px",
    background: CARD,
    border: `1px solid ${LINE}`,
    borderRadius: 14,
    cursor: "pointer",
    fontFamily: "inherit",
    minHeight: 72,
    // Layered box-shadow: subtle depth + accent underline that
    // brightens on hover/focus.
    boxShadow: `0 1px 0 ${LINE}, inset 0 -2px 0 ${accent}`,
    transition: "transform 140ms ease, box-shadow 140ms ease",
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
