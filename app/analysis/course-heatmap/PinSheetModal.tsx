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

import { useEffect, useMemo, useState } from "react";
import type { CoursePinHole, HolePutt } from "@/lib/golf-api/pgatour";
import type { HoleBirdieData } from "@/lib/analysis/course-birdies";
import { fmtRate, rateColor } from "@/lib/analysis/course-birdies";
import SlopeOverlay from "./SlopeOverlay";

interface Props {
  hole: CoursePinHole | null;
  /** All putts on this hole across the field × rounds. Empty when
   *  data hasn't loaded / no coverage. */
  puttsForHole?: HolePutt[];
  /** Alternate green diagram URL from the shot-detail feed. Putt
   *  coords normalise against THIS image, so we prefer it over the
   *  pin sheet's asset when it's present (they're often the same
   *  Cloudinary render, but not always). */
  puttsGreenImageUrl?: string | null;
  /** True while the putt fetch is still in flight (first-open,
   *  cold cache). */
  puttsLoading?: boolean;
  /** Multi-season birdie-or-better data for this hole. Present only
   *  when the API has data for the tournament's family (currently
   *  3M Open only). Toggling the "History" mode below renders these
   *  pins in place of the round-labelled ones. */
  birdieHistory?: HoleBirdieData | null;
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

/** Colour for the vs-par value inside the tooltip. Tuned bright
 *  (~0.78 lightness) so it reads clearly on the dark near-black
 *  tooltip background — the previous 0.4-lightness green was
 *  invisible against black. */
function scoringColour(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "oklch(0.85 0.02 150)";
  if (v > 0.05) return "oklch(0.78 0.18 28)";
  if (v < -0.05) return "oklch(0.82 0.19 150)";
  return "oklch(0.85 0.02 150)";
}

export default function PinSheetModal({
  hole,
  puttsForHole,
  puttsGreenImageUrl,
  puttsLoading,
  birdieHistory,
  onClose,
}: Props) {
  /** eventId of the pin currently being hovered — null when not
   *  hovering. Renders a small tooltip anchored to that pin with
   *  the round's field scoring average. */
  const [hoverRound, setHoverRound] = useState<number | null>(null);
  /** Index into birdieHistory.pins for the historical pin being
   *  hovered. Null = none. */
  const [hoverHistIdx, setHoverHistIdx] = useState<number | null>(null);
  /** Which round(s) of putts to draw. `null` = all rounds. Filter
   *  chip below the diagram flips this. */
  const [puttRoundFilter, setPuttRoundFilter] = useState<number | null>(null);
  /** True → overlay putt arcs on the green. Default on. */
  const [showPutts, setShowPutts] = useState(true);
  /** True → only show made putts. Default off (all). */
  const [madeOnly, setMadeOnly] = useState(false);
  /** True → overlay inferred slope arrows on the green. */
  const [showSlope, setShowSlope] = useState(false);
  /** True → replace the round-labelled pins with multi-season
   *  birdie-or-better pins colored by rate, and paint quadrant
   *  overlays. Only meaningful when `birdieHistory` is present. */
  const [showHistory, setShowHistory] = useState(false);
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
  // Filter putts to the currently-selected round + made/missed pref.
  const filteredPutts = useMemo(() => {
    const list = puttsForHole ?? [];
    return list.filter((p) => {
      if (puttRoundFilter != null && p.round !== puttRoundFilter) return false;
      if (madeOnly && !p.made) return false;
      return true;
    });
  }, [puttsForHole, puttRoundFilter, madeOnly]);

  // Counts per round for the filter chips (so users see coverage).
  const puttCountsByRound = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of puttsForHole ?? []) {
      map.set(p.round, (map.get(p.round) ?? 0) + 1);
    }
    return map;
  }, [puttsForHole]);

  // Fall back to the birdie-history image when the current
  // tournament's pin sheet has no diagram of its own (e.g. 2023
  // 3M Open — PGA Tour's older payloads don't include the enhanced
  // hole-pickle asset). The birdie-history image is pulled from a
  // more recent year of the same course, so the greens shape reads
  // the same even if this year's pin dots can't be plotted on it.
  const diagramImageUrl =
    puttsGreenImageUrl ||
    hole?.greenImageUrl ||
    birdieHistory?.greenImageUrl ||
    "";
  const usingHistoryFallbackImage =
    !puttsGreenImageUrl &&
    !hole?.greenImageUrl &&
    Boolean(birdieHistory?.greenImageUrl);
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
          // Desktop-first sizing — ~75% of viewport as the primary
          // canvas so the green diagram + quadrant panel have room
          // to breathe, capped at 1400 px on very wide screens.
          // On phones the min() lets it shrink to 96vw before hitting
          // the 720 baseline.
          width: "min(1400px, 75vw)",
          minWidth: "min(720px, 96vw)",
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

        {/* History mode toggle — visible whenever we have multi-season
            birdie data for this hole. Off = current 4-round pins;
            on = every pin across all seasons colored by birdie rate,
            plus quadrant overlays. */}
        {birdieHistory && birdieHistory.pins.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "8px 10px",
              marginBottom: 10,
              border: "1px solid oklch(0.94 0.008 95)",
              borderRadius: 8,
              background: "oklch(0.99 0.005 95)",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "oklch(0.4 0.02 150)",
                fontFamily: "inherit",
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <strong
                style={{
                  fontSize: 11,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  color: "oklch(0.3 0.02 150)",
                }}
              >
                Birdie history
              </strong>
              <span
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 11,
                  color: "oklch(0.5 0.02 150)",
                }}
              >
                {birdieHistory.pins.length} pins ·{" "}
                {birdieHistory.yearsCovered.length} season
                {birdieHistory.yearsCovered.length === 1 ? "" : "s"} (
                {birdieHistory.yearsCovered.join(", ")}) · overall{" "}
                <span
                  style={{
                    color: "oklch(0.28 0.02 150)",
                    fontWeight: 700,
                  }}
                >
                  {fmtRate(birdieHistory.overall.rate)}
                </span>{" "}
                birdies
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              aria-pressed={showHistory}
              style={{
                padding: "5px 12px",
                fontSize: 11,
                fontFamily: "inherit",
                fontWeight: 700,
                borderRadius: 999,
                border: "1px solid oklch(0.85 0.013 95)",
                background: showHistory
                  ? "oklch(0.25 0.02 150)"
                  : "white",
                color: showHistory ? "white" : "oklch(0.3 0.02 150)",
                cursor: "pointer",
                letterSpacing: 0.3,
              }}
            >
              {showHistory ? "Showing all seasons" : "Show all seasons"}
            </button>
          </div>
        )}

        {diagramImageUrl ? (
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
              src={diagramImageUrl}
              alt={`Green diagram, hole ${hole.holeNumber}`}
              style={{
                display: "block",
                width: "100%",
                height: "auto",
              }}
            />
            {/* Putt overlay — arcs from each putt's start to end.
                Stacking hundreds of putts reveals the green's break
                pattern (approximate contours). SVG uses percentage-
                unit coords so it scales with the responsive image
                exactly. */}
            {showPutts && filteredPutts.length > 0 && (
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                }}
                aria-hidden="true"
              >
                {filteredPutts.map((p, i) => {
                  const x1 = p.x1 * 100;
                  const y1 = p.y1 * 100;
                  const x2 = p.x2 * 100;
                  const y2 = p.y2 * 100;
                  // Curl each stroke into a subtle quadratic curve —
                  // real putts break; drawing them as a slight arc
                  // instead of a straight line reads more like a
                  // contour indicator when 100+ are stacked.
                  const midX = (x1 + x2) / 2;
                  const midY = (y1 + y2) / 2;
                  // Perpendicular unit vector for the curve control
                  // point offset. Deterministic per-putt so re-renders
                  // don't jitter.
                  const dx = x2 - x1;
                  const dy = y2 - y1;
                  const len = Math.max(0.001, Math.hypot(dx, dy));
                  const nx = -dy / len;
                  const ny = dx / len;
                  // Curl magnitude: scale with putt length so long
                  // putts arc more than tap-ins. Sign alternates by
                  // stroke index for visual density; when broadcasts
                  // publish true line/lag we'd swap this for the real
                  // sign.
                  const curl = Math.min(3.5, len * 0.12) * (i % 2 === 0 ? 1 : -1);
                  const cx = midX + nx * curl;
                  const cy = midY + ny * curl;
                  const stroke = p.made
                    ? "oklch(0.7 0.19 150 / 0.35)"
                    : "oklch(0.55 0.20 28 / 0.28)";
                  return (
                    <path
                      key={`p${i}`}
                      d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                      stroke={stroke}
                      strokeWidth={0.35}
                      fill="none"
                      strokeLinecap="round"
                    />
                  );
                })}
                {/* Endpoint dots — where the ball actually came to
                    rest. Made putts are the CUP so they cluster on
                    the pin; missed putts scatter around the pin and
                    the shape of that scatter reads as the fall line
                    (balls settle on the low side of the hole).
                    Missed dots get more visual weight than made
                    dots — they carry the slope signal. */}
                {filteredPutts.map((p, i) => (
                  <circle
                    key={`d${i}`}
                    cx={p.x2 * 100}
                    cy={p.y2 * 100}
                    r={p.made ? 0.5 : 0.85}
                    fill={
                      p.made
                        ? "oklch(0.55 0.2 150 / 0.55)"
                        : "oklch(0.55 0.22 28 / 0.75)"
                    }
                    stroke={p.made ? "none" : "oklch(0.25 0.15 28 / 0.5)"}
                    strokeWidth={p.made ? 0 : 0.2}
                  />
                ))}
              </svg>
            )}
            {showSlope && (puttsForHole?.length ?? 0) > 0 && (
              <SlopeOverlay
                putts={puttsForHole ?? []}
                pinByRound={hole.pinByRound}
              />
            )}
            {/* History mode: cluster colour overlays + historical
                pin dots. Cluster discs sit UNDER the pin dots via
                z-index. Each cluster is a soft circle around the
                mean position of the pins it contains, tinted by the
                aggregate birdie rate — so nearby pins across years
                read as one "location". */}
            {showHistory && birdieHistory && (
              <>
                {birdieHistory.clusters.map((cluster) => {
                  const cx = cluster.centroid.x * 100;
                  const cy = cluster.centroid.y * 100;
                  // Pixel-space disc; use both axes' viewport-relative
                  // size so the disc scales with the rendered image.
                  // Add a small buffer so single pins still have a
                  // visible halo, then clamp so massive clusters don't
                  // dominate.
                  const r = Math.max(0.06, Math.min(0.25, cluster.radius + 0.05));
                  return (
                    <div
                      key={`cluster-${cluster.clusterId}`}
                      aria-hidden
                      style={{
                        position: "absolute",
                        left: `${cx - r * 100}%`,
                        top: `${cy - r * 100}%`,
                        width: `${r * 200}%`,
                        height: `${r * 200}%`,
                        borderRadius: "50%",
                        background:
                          cluster.total > 0
                            ? rateColor(cluster.rate, 0.32)
                            : "transparent",
                        border:
                          cluster.total > 0
                            ? `1.5px dashed ${rateColor(cluster.rate, 0.7)}`
                            : "none",
                        pointerEvents: "none",
                        zIndex: 1,
                        boxSizing: "border-box",
                      }}
                    />
                  );
                })}
                {birdieHistory.pins.map((pin, i) => {
                  const active = hoverHistIdx === i;
                  const dotColour = rateColor(pin.rate, 1);
                  // Position tooltip flipped when the pin sits in the
                  // bottom third so it doesn't fall off the diagram.
                  const flipUp = pin.y > 0.62;
                  return (
                    <div
                      key={`hp-${i}`}
                      style={{
                        position: "absolute",
                        left: `${pin.x * 100}%`,
                        top: `${pin.y * 100}%`,
                        transform: "translate(-50%, -50%)",
                        lineHeight: 1,
                        zIndex: 2,
                      }}
                    >
                      <button
                        type="button"
                        onMouseEnter={() => setHoverHistIdx(i)}
                        onMouseLeave={() =>
                          setHoverHistIdx((cur) => (cur === i ? null : cur))
                        }
                        onFocus={() => setHoverHistIdx(i)}
                        onBlur={() =>
                          setHoverHistIdx((cur) => (cur === i ? null : cur))
                        }
                        aria-label={`${pin.year} R${pin.round} pin — ${fmtRate(pin.rate)} birdie rate`}
                        style={{
                          width: active ? 20 : 14,
                          height: active ? 20 : 14,
                          borderRadius: "50%",
                          background: dotColour,
                          border: "2px solid white",
                          boxShadow: active
                            ? `0 0 0 2px ${dotColour}, 0 4px 10px rgba(0,0,0,0.4)`
                            : `0 0 0 1px oklch(0.2 0.02 150 / 0.5), 0 2px 5px rgba(0,0,0,0.3)`,
                          cursor: "pointer",
                          padding: 0,
                          transition: "width 120ms ease, height 120ms ease",
                        }}
                      />
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
                              fontFamily:
                                "var(--font-mono, monospace)",
                              fontWeight: 800,
                              color: dotColour,
                              fontSize: 10,
                              letterSpacing: 0.4,
                            }}
                          >
                            {pin.year} R{pin.round}
                          </span>
                          <span
                            style={{
                              fontFamily:
                                "var(--font-mono, monospace)",
                              fontWeight: 800,
                              fontSize: 13,
                            }}
                          >
                            {fmtRate(pin.rate)}
                          </span>
                          <span
                            style={{
                              fontFamily:
                                "var(--font-mono, monospace)",
                              fontSize: 10,
                              color: "oklch(0.72 0.02 150)",
                            }}
                          >
                            {pin.birdies}/{pin.total}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            {/* Solo mode — round-labelled pins for the current
                tournament only. Hidden while showing history. */}
            {!showHistory && roundsWithPin.map((round) => {
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
                              fontSize: 13,
                            }}
                          >
                            {scoring.avg != null ? scoring.avg.toFixed(2) : "—"}
                          </span>
                          {scoring.vsPar != null && (
                            <span
                              style={{
                                fontFamily: "var(--font-mono, monospace)",
                                fontWeight: 800,
                                color: scoringColour(scoring.vsPar),
                                fontSize: 12,
                                letterSpacing: 0.2,
                              }}
                            >
                              {formatVsPar(scoring.vsPar)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span
                          style={{
                            color: "oklch(0.72 0.02 150)",
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

        {/* Putt overlay controls — round filter + made/missed toggle
            + coverage summary. Only renders once we have any putt
            data at all. */}
        {(puttsForHole?.length ?? 0) > 0 && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 10px",
              border: "1px solid oklch(0.94 0.008 95)",
              borderRadius: 8,
              background: "oklch(0.99 0.005 95)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              fontFamily:
                "var(--font-archivo), 'Archivo', system-ui, sans-serif",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                fontSize: 11,
                color: "oklch(0.5 0.02 150)",
                letterSpacing: 0.3,
              }}
            >
              <span
                style={{
                  fontWeight: 800,
                  color: "oklch(0.3 0.02 150)",
                  fontFamily: "var(--font-mono, monospace)",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  fontSize: 10,
                }}
              >
                PUTT PATHS
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 10,
                }}
              >
                {filteredPutts.length} shown ·{" "}
                {filteredPutts.filter((p) => p.made).length} made
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {(
                [
                  { id: null, label: "All rounds" },
                  { id: 1, label: "R1" },
                  { id: 2, label: "R2" },
                  { id: 3, label: "R3" },
                  { id: 4, label: "R4" },
                ] as Array<{ id: number | null; label: string }>
              ).map((r) => {
                const active = puttRoundFilter === r.id;
                const count =
                  r.id == null
                    ? (puttsForHole?.length ?? 0)
                    : puttCountsByRound.get(r.id) ?? 0;
                const disabled = r.id != null && count === 0;
                return (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => setPuttRoundFilter(r.id)}
                    disabled={disabled}
                    style={{
                      padding: "3px 10px",
                      fontSize: 11,
                      fontFamily: "inherit",
                      fontWeight: 700,
                      borderRadius: 999,
                      border: "1px solid oklch(0.9 0.008 95)",
                      background: active
                        ? "oklch(0.22 0.03 150)"
                        : "white",
                      color: active
                        ? "white"
                        : disabled
                          ? "oklch(0.75 0.008 95)"
                          : "oklch(0.3 0.02 150)",
                      cursor: disabled ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {r.label}
                    <span
                      style={{
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: 9,
                        opacity: 0.7,
                      }}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setMadeOnly((v) => !v)}
                title={
                  madeOnly ? "Showing MADE putts only" : "Showing all putts"
                }
                style={{
                  padding: "3px 10px",
                  fontSize: 11,
                  fontFamily: "inherit",
                  fontWeight: 700,
                  borderRadius: 999,
                  border: "1px solid oklch(0.9 0.008 95)",
                  background: madeOnly ? "oklch(0.22 0.03 150)" : "white",
                  color: madeOnly ? "white" : "oklch(0.3 0.02 150)",
                  cursor: "pointer",
                }}
              >
                Made only
              </button>
              <button
                type="button"
                onClick={() => setShowPutts((v) => !v)}
                style={{
                  padding: "3px 10px",
                  fontSize: 11,
                  fontFamily: "inherit",
                  fontWeight: 700,
                  borderRadius: 999,
                  border: "1px solid oklch(0.9 0.008 95)",
                  background: showPutts ? "white" : "oklch(0.22 0.03 150)",
                  color: showPutts ? "oklch(0.3 0.02 150)" : "white",
                  cursor: "pointer",
                }}
              >
                Hide overlay
              </button>
              <button
                type="button"
                onClick={() => setShowSlope((v) => !v)}
                title="Infer local downhill from missed-putt deflection patterns"
                style={{
                  padding: "3px 10px",
                  fontSize: 11,
                  fontFamily: "inherit",
                  fontWeight: 700,
                  borderRadius: 999,
                  border: "1px solid oklch(0.9 0.008 95)",
                  background: showSlope ? "oklch(0.22 0.03 150)" : "white",
                  color: showSlope ? "white" : "oklch(0.3 0.02 150)",
                  cursor: "pointer",
                }}
              >
                Slope arrows (β)
              </button>
            </div>
            {showSlope && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 10,
                  color: "oklch(0.5 0.02 150)",
                  fontStyle: "italic",
                }}
              >
                Slope arrows INFERRED from missed-putt deflection —
                each arrow is the mean roll-deflection of ≥4 putts
                anchored in that cell. Rough downhill signal, not a
                surveyed contour; sparse cells get dropped rather than
                guessed.
              </div>
            )}
            <div
              style={{
                display: "flex",
                gap: 14,
                fontSize: 10,
                color: "oklch(0.5 0.02 150)",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 14,
                    height: 3,
                    background: "oklch(0.7 0.19 150)",
                    borderRadius: 2,
                  }}
                />
                MADE
              </span>
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 14,
                    height: 3,
                    background: "oklch(0.55 0.2 28)",
                    borderRadius: 2,
                  }}
                />
                MISSED
              </span>
              <span style={{ opacity: 0.7 }}>
                Missed-putt endpoints (larger red dots) cluster on the
                LOW side of the pin — that scatter direction is the
                fall line for that round&apos;s pin position.
              </span>
            </div>
          </div>
        )}
        {puttsLoading && (puttsForHole?.length ?? 0) === 0 && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              border: "1px dashed oklch(0.88 0.013 95)",
              borderRadius: 8,
              fontSize: 11,
              color: "oklch(0.5 0.02 150)",
              textAlign: "center",
              fontFamily:
                "var(--font-archivo), 'Archivo', system-ui, sans-serif",
            }}
          >
            Loading putt-path overlay… (first open of a tournament can
            take ~30 s; cached after that.)
          </div>
        )}

        {/* Round legend — hidden in history mode; pins there are
            keyed by rate, not by round. */}
        {!showHistory && (
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
        )}

        {/* Cluster summary panel — replaces the round legend in
            history mode. One card per proximity cluster (pins the
            course-setup crew put in the same spot year to year).
            Larger sample = the trustworthy pin location; the small
            single-pin "clusters" are noisy neighbourhood outliers. */}
        {showHistory && birdieHistory && (
          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
            }}
          >
            {birdieHistory.clusters.map((cluster, i) => {
              const has = cluster.total > 0;
              // Rough anatomical label from the centroid so the
              // reader can find the cluster on the diagram — TPC
              // Twin Cities greens read with the tee at the bottom
              // of the frame, so y-large = closer to the tee (front).
              const cx = cluster.centroid.x;
              const cy = cluster.centroid.y;
              const horiz = cx < 0.4 ? "Left" : cx > 0.6 ? "Right" : "Centre";
              const vert = cy < 0.4 ? "Back" : cy > 0.6 ? "Front" : "Middle";
              const location = `${vert} ${horiz.toLowerCase()}`;
              return (
                <div
                  key={cluster.clusterId}
                  style={{
                    padding: "10px 12px",
                    border: "1px solid oklch(0.94 0.008 95)",
                    borderRadius: 8,
                    background: has ? rateColor(cluster.rate, 0.14) : "white",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                      color: "oklch(0.42 0.02 150)",
                      fontWeight: 700,
                    }}
                  >
                    Cluster {String.fromCharCode(65 + i)} · {location}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 22,
                      fontWeight: 800,
                      color: has ? "oklch(0.2 0.02 150)" : "oklch(0.6 0.02 150)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {has ? fmtRate(cluster.rate) : "—"}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 11,
                      color: "oklch(0.55 0.02 150)",
                    }}
                  >
                    {cluster.pinCount} pin
                    {cluster.pinCount === 1 ? "" : "s"} ·{" "}
                    {cluster.birdies}/{cluster.total}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Rate colour scale — only meaningful in history mode. */}
        {showHistory && birdieHistory && (
          <div
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 10,
              color: "oklch(0.5 0.02 150)",
              fontFamily: "var(--font-mono, monospace)",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <span>Rate scale</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 14,
                  height: 8,
                  background: rateColor(0.05),
                  borderRadius: 2,
                }}
              />
              5%
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 14,
                  height: 8,
                  background: rateColor(0.15),
                  borderRadius: 2,
                }}
              />
              15%
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 14,
                  height: 8,
                  background: rateColor(0.25),
                  borderRadius: 2,
                }}
              />
              25%
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 14,
                  height: 8,
                  background: rateColor(0.35),
                  borderRadius: 2,
                }}
              />
              35%+
            </span>
          </div>
        )}

        {usingHistoryFallbackImage && !showHistory && (
          <p
            style={{
              marginTop: 10,
              fontSize: 11,
              color: "oklch(0.55 0.02 150)",
              textAlign: "center",
              padding: "8px 12px",
              border: "1px dashed oklch(0.88 0.013 95)",
              borderRadius: 8,
              background: "oklch(0.99 0.005 95)",
            }}
          >
            This year&apos;s pin sheet uses an older coordinate frame that
            doesn&apos;t overlay on the green diagram — hit{" "}
            <strong>Show all seasons</strong> above for the multi-season
            history that does.
          </p>
        )}
        <p
          style={{
            marginTop: 14,
            fontSize: 11,
            color: "oklch(0.55 0.02 150)",
            textAlign: "center",
          }}
        >
          {showHistory
            ? "Every pin position from every stored round of this hole, coloured by that round's birdie-or-better rate. Dashed circles mark proximity clusters — pins the course-setup crew puts in the same spot year to year get merged into one tile in the panel below. Bigger pin counts = more trustworthy."
            : "Hover any pin to see the field's scoring average for that round. Pin coordinates + green diagram from PGA Tour's own broadcast feed. Rounds without a coloured dot haven't been posted yet (or the round hasn't been played)."}
        </p>
      </div>
    </div>
  );
}
