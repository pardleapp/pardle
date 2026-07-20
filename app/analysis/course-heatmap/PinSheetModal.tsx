"use client";

/**
 * Full-screen modal showing a single hole's green diagram with all
 * four rounds' pin positions layered on top as coloured dots.
 * Opened when the reader clicks a hole label ("H15") in the heatmap
 * row header.
 *
 * The green image is the PGA Tour's own overhead raster (same
 * Cloudinary asset the shot tracer uses). Pin coordinates are
 * normalised 0-1 on that image, so we position each dot with
 * percentage-based left/top.
 */

import { useEffect, useState } from "react";
import type { CoursePinHole } from "@/lib/golf-api/pgatour";

interface Props {
  hole: CoursePinHole | null;
  onClose: () => void;
}

const ROUND_COLOURS: Record<number, string> = {
  1: "oklch(0.55 0.18 250)", // R1 — blue
  2: "oklch(0.60 0.18 65)",  // R2 — gold
  3: "oklch(0.55 0.20 300)", // R3 — purple
  4: "oklch(0.55 0.20 25)",  // R4 — red
};

const ROUND_LABEL: Record<number, string> = {
  1: "R1",
  2: "R2",
  3: "R3",
  4: "R4",
};

/** Format a signed vs-par to a compact string. */
function formatVsPar(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.005) return "0";
  return v > 0 ? `+${v.toFixed(2)}` : `−${Math.abs(v).toFixed(2)}`;
}

/** Colour for the vs-par pill inside the tooltip — matches the
 *  heatmap's green/red polarity but softer since the pill is small. */
function scoringColour(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "oklch(0.5 0.02 150)";
  if (v > 0.05) return "oklch(0.45 0.17 28)";
  if (v < -0.05) return "oklch(0.4 0.15 150)";
  return "oklch(0.4 0.02 150)";
}

export default function PinSheetModal({ hole, onClose }: Props) {
  /** eventId of the pin currently being hovered — null when not
   *  hovering. Renders a small tooltip anchored to that pin with
   *  the round's field scoring average. */
  const [hoverRound, setHoverRound] = useState<number | null>(null);
  useEffect(() => {
    if (!hole) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [hole, onClose]);

  if (!hole) return null;
  const roundsWithPin = Object.keys(hole.pinByRound)
    .map((k) => Number(k))
    .filter((r) => Number.isFinite(r))
    .sort((a, b) => a - b);
  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Pin positions for hole ${hole.holeNumber}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.78)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 12,
          padding: 20,
          width: "100%",
          maxWidth: 720,
          maxHeight: "92vh",
          overflowY: "auto",
          boxSizing: "border-box",
          fontFamily:
            "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
          color: "oklch(0.2 0.02 150)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 12,
            gap: 12,
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "baseline", gap: 10 }}>
            <span
              style={{
                fontSize: 24,
                fontWeight: 900,
                fontFamily: "var(--font-mono, monospace)",
                letterSpacing: -0.5,
              }}
            >
              H{hole.holeNumber}
            </span>
            <span
              style={{
                fontSize: 13,
                color: "oklch(0.5 0.02 150)",
                fontFamily: "var(--font-mono, monospace)",
                letterSpacing: 0.3,
              }}
            >
              {hole.par != null ? `Par ${hole.par}` : ""}
              {hole.par != null && hole.yards != null ? " · " : ""}
              {hole.yards != null ? `${hole.yards} yds` : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: "1px solid oklch(0.85 0.013 95)",
              borderRadius: 6,
              padding: "6px 12px",
              background: "white",
              color: "oklch(0.3 0.02 150)",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "inherit",
              fontWeight: 700,
            }}
          >
            Close (Esc)
          </button>
        </header>

        {hole.greenImageUrl ? (
          // Container's height is driven by the <img> (width:100%, height
          // auto) so pin dot percentages resolve against the image's
          // actual painted area — no letterbox, no dots floating in
          // empty padding. `display:block` on the img kills the inline
          // baseline gap that would otherwise leave a 4px sliver at
          // the bottom.
          <div
            style={{
              position: "relative",
              width: "100%",
              background: "oklch(0.94 0.008 95)",
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid oklch(0.9 0.008 95)",
              lineHeight: 0,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={hole.greenImageUrl}
              alt={`Green diagram, hole ${hole.holeNumber}`}
              style={{
                display: "block",
                width: "100%",
                height: "auto",
              }}
            />
            {roundsWithPin.map((round) => {
              const pin = hole.pinByRound[round];
              if (!pin) return null;
              const colour = ROUND_COLOURS[round] ?? "oklch(0.4 0.02 150)";
              const scoring = hole.scoringByRound?.[round];
              const active = hoverRound === round;
              // Position the tooltip below the pin unless the pin is
              // in the bottom third of the image, then flip above.
              const flipUp = pin.y > 0.62;
              return (
                <div
                  key={round}
                  style={{
                    position: "absolute",
                    left: `${pin.x * 100}%`,
                    top: `${pin.y * 100}%`,
                    transform: "translate(-50%, -50%)",
                    lineHeight: 1,
                  }}
                >
                  <button
                    type="button"
                    onMouseEnter={() => setHoverRound(round)}
                    onMouseLeave={() =>
                      setHoverRound((cur) => (cur === round ? null : cur))
                    }
                    onFocus={() => setHoverRound(round)}
                    onBlur={() =>
                      setHoverRound((cur) => (cur === round ? null : cur))
                    }
                    aria-label={`Round ${round} pin — ${scoring?.vsPar != null ? `hole averaged ${formatVsPar(scoring.vsPar)} vs par` : "no scoring data"}`}
                    style={{
                      width: active ? 22 : 18,
                      height: active ? 22 : 18,
                      borderRadius: "50%",
                      background: colour,
                      border: "2px solid white",
                      boxShadow: active
                        ? `0 0 0 2px ${colour}, 0 4px 10px rgba(0,0,0,0.4)`
                        : `0 0 0 1px ${colour}, 0 2px 6px rgba(0,0,0,0.35)`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: active ? 10 : 9,
                      fontWeight: 900,
                      color: "white",
                      fontFamily: "var(--font-mono, monospace)",
                      letterSpacing: 0.2,
                      lineHeight: 1,
                      cursor: "pointer",
                      padding: 0,
                      transition: "width 120ms ease, height 120ms ease",
                    }}
                  >
                    {round}
                  </button>
                  {active && (
                    <div
                      role="tooltip"
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: flipUp ? "auto" : "calc(100% + 8px)",
                        bottom: flipUp ? "calc(100% + 8px)" : "auto",
                        transform: "translateX(-50%)",
                        background: "oklch(0.18 0.02 150)",
                        color: "white",
                        padding: "6px 10px",
                        borderRadius: 6,
                        fontSize: 11,
                        fontFamily:
                          "var(--font-archivo), 'Archivo', system-ui, sans-serif",
                        whiteSpace: "nowrap",
                        boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
                        pointerEvents: "none",
                        zIndex: 5,
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-mono, monospace)",
                          fontWeight: 800,
                          color: colour,
                          letterSpacing: 0.4,
                          fontSize: 10,
                          textTransform: "uppercase",
                        }}
                      >
                        R{round}
                      </span>
                      {scoring && (scoring.avg != null || scoring.vsPar != null) ? (
                        <>
                          <span
                            style={{
                              fontFamily: "var(--font-mono, monospace)",
                              fontWeight: 800,
                              color: "white",
                            }}
                          >
                            {scoring.avg != null ? scoring.avg.toFixed(2) : "—"}
                          </span>
                          {scoring.vsPar != null && (
                            <span
                              style={{
                                fontFamily: "var(--font-mono, monospace)",
                                fontWeight: 700,
                                color: scoringColour(scoring.vsPar),
                                background: "rgba(255,255,255,0.08)",
                                padding: "1px 5px",
                                borderRadius: 3,
                                fontSize: 10,
                              }}
                            >
                              {formatVsPar(scoring.vsPar)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span
                          style={{
                            color: "oklch(0.65 0.02 150)",
                            fontStyle: "italic",
                          }}
                        >
                          no scoring yet
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              color: "oklch(0.5 0.02 150)",
              fontSize: 13,
              border: "1px dashed oklch(0.88 0.013 95)",
              borderRadius: 10,
            }}
          >
            No green diagram available for this hole.
          </div>
        )}

        <div
          style={{
            marginTop: 14,
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {[1, 2, 3, 4].map((r) => {
            const has = hole.pinByRound[r] != null;
            const colour = ROUND_COLOURS[r];
            return (
              <span
                key={r}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  color: has ? "oklch(0.25 0.02 150)" : "oklch(0.65 0.008 95)",
                  fontFamily: "var(--font-mono, monospace)",
                  letterSpacing: 0.3,
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: has ? colour : "transparent",
                    border: `2px solid ${has ? colour : "oklch(0.85 0.013 95)"}`,
                  }}
                />
                {ROUND_LABEL[r]}
                {!has ? " · —" : ""}
              </span>
            );
          })}
        </div>

        <p
          style={{
            marginTop: 14,
            fontSize: 11,
            color: "oklch(0.55 0.02 150)",
            textAlign: "center",
          }}
        >
          Hover any pin to see the field&apos;s scoring average for that
          round. Pin coordinates + green diagram from PGA Tour&apos;s
          own broadcast feed. Rounds without a coloured dot
          haven&apos;t been posted yet (or the round hasn&apos;t been
          played).
        </p>
      </div>
    </div>
  );
}
