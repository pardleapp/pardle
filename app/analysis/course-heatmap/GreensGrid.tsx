"use client";

/**
 * GreensGrid — landing view for the Course & Pin Guide. Renders every
 * hole as a small green card so the whole property is scannable at a
 * glance; clicking a card opens the full PinSheetModal with putt paths
 * and multi-season birdie history.
 *
 * Each card shows:
 *   - Hole label + par + this-week's yardage
 *   - Aerial green image with today's four (R1-R4) pin positions
 *     over it, coloured by round
 *   - PIN Δ chip — biggest cluster-vs-mean birdie-rate gap on the
 *     hole (cross-year signal)
 *   - TEE Δ chip — spread of yardage across the tournament's played
 *     rounds
 */

import type {
  CoursePinHole,
} from "@/lib/golf-api/pgatour";
import type { HoleBirdieData } from "@/lib/analysis/course-birdies";

interface PinFlag {
  delta: number;
  clusterLetter: string;
  clusterRate: number;
  meanRate: number;
}

interface TeeFlag {
  spread: number;
  minYards: number;
  maxYards: number;
  minRound: number;
  maxRound: number;
}

const PIN_VARIANCE_THRESHOLD = 0.1;
const TEE_MOVE_THRESHOLD_YARDS = 30;

function pinFlagFor(birdie: HoleBirdieData | undefined): PinFlag | null {
  if (!birdie || birdie.clusters.length < 2) return null;
  const rates = birdie.clusters
    .filter((c) => c.total > 0)
    .map((c) => c.rate);
  if (rates.length < 2) return null;
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  let best: PinFlag | null = null;
  let bestAbs = PIN_VARIANCE_THRESHOLD;
  birdie.clusters.forEach((c, i) => {
    if (c.total === 0) return;
    const delta = c.rate - mean;
    if (Math.abs(delta) > bestAbs) {
      bestAbs = Math.abs(delta);
      best = {
        delta,
        clusterLetter: String.fromCharCode(65 + i),
        clusterRate: c.rate,
        meanRate: mean,
      };
    }
  });
  return best;
}

function teeFlagFor(pin: CoursePinHole | undefined): TeeFlag | null {
  if (!pin || !pin.yardsByRound) return null;
  const entries = Object.entries(pin.yardsByRound)
    .map(([r, y]) => ({ round: Number(r), yards: y }))
    .filter((e) => Number.isFinite(e.round) && Number.isFinite(e.yards));
  if (entries.length < 2) return null;
  const sorted = [...entries].sort((a, b) => a.yards - b.yards);
  const minE = sorted[0];
  const maxE = sorted[sorted.length - 1];
  const spread = maxE.yards - minE.yards;
  if (spread <= TEE_MOVE_THRESHOLD_YARDS) return null;
  return {
    spread,
    minYards: minE.yards,
    maxYards: maxE.yards,
    minRound: minE.round,
    maxRound: maxE.round,
  };
}

const ROUND_COLOURS: Record<number, string> = {
  1: "oklch(0.55 0.18 250)", // R1 — blue
  2: "oklch(0.60 0.18 65)",  // R2 — gold
  3: "oklch(0.55 0.20 300)", // R3 — purple
  4: "oklch(0.55 0.20 25)",  // R4 — red
};

interface Props {
  pinsByHole?: Map<number, CoursePinHole>;
  birdieHistoryByHole?: Record<string, HoleBirdieData> | null;
  onHoleClick?: (hole: number) => void;
}

export default function GreensGrid({
  pinsByHole,
  birdieHistoryByHole,
  onHoleClick,
}: Props) {
  const holes = Array.from({ length: 18 }, (_, i) => i + 1);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
        gap: 14,
        marginTop: 16,
      }}
    >
      {holes.map((h) => {
        const pin = pinsByHole?.get(h);
        const birdie = birdieHistoryByHole?.[String(h)];
        const pinFlag = pinFlagFor(birdie);
        const teeFlag = teeFlagFor(pin);
        const clickable = pin != null && onHoleClick != null;
        return (
          <button
            key={h}
            type="button"
            onClick={() => clickable && onHoleClick!(h)}
            disabled={!clickable}
            title={
              clickable
                ? `Open pin sheet for hole ${h}`
                : `Hole ${h} — pin sheet loading…`
            }
            style={{
              background: "white",
              border: "1px solid oklch(0.9 0.008 95)",
              borderRadius: 12,
              padding: 12,
              cursor: clickable ? "pointer" : "default",
              textAlign: "left",
              font: "inherit",
              color: "inherit",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              transition: "border-color 0.14s ease, box-shadow 0.14s ease",
            }}
            onMouseEnter={(e) => {
              if (!clickable) return;
              e.currentTarget.style.borderColor = "oklch(0.55 0.15 250)";
              e.currentTarget.style.boxShadow =
                "0 4px 12px oklch(0.4 0.06 145 / 0.12)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "oklch(0.9 0.008 95)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 8,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily:
                      "var(--font-archivo), 'Archivo', system-ui, sans-serif",
                    fontSize: 15,
                    fontWeight: 800,
                    color: "oklch(0.2 0.02 150)",
                  }}
                >
                  H{h}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "oklch(0.5 0.02 150)",
                    fontFamily:
                      "'IBM Plex Mono', ui-monospace, monospace",
                  }}
                >
                  {pin?.par ? `Par ${pin.par}` : "Par ?"}
                  {pin?.yards ? ` · ${pin.yards} yd` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {pinFlag && (
                  <span
                    title={`Cluster ${pinFlag.clusterLetter} birdie rate ${(pinFlag.clusterRate * 100).toFixed(1)}% vs hole mean ${(pinFlag.meanRate * 100).toFixed(1)}%`}
                    style={{
                      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                      fontSize: 11,
                      fontWeight: 800,
                      padding: "3px 7px",
                      borderRadius: 999,
                      background:
                        pinFlag.delta > 0
                          ? "oklch(0.94 0.06 155)"
                          : "oklch(0.94 0.07 28)",
                      color:
                        pinFlag.delta > 0
                          ? "oklch(0.32 0.13 155)"
                          : "oklch(0.38 0.15 28)",
                    }}
                  >
                    {pinFlag.delta > 0 ? "+" : "−"}
                    {Math.round(Math.abs(pinFlag.delta) * 100)}% {pinFlag.clusterLetter}
                  </span>
                )}
                {teeFlag && (
                  <span
                    title={`Yards moved from ${teeFlag.minYards} yd (R${teeFlag.minRound}) to ${teeFlag.maxYards} yd (R${teeFlag.maxRound})`}
                    style={{
                      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                      fontSize: 11,
                      fontWeight: 800,
                      padding: "3px 7px",
                      borderRadius: 999,
                      background: "oklch(0.9 0.05 260 / 0.55)",
                      color: "oklch(0.3 0.13 260)",
                    }}
                  >
                    ±{teeFlag.spread} yd
                  </span>
                )}
              </div>
            </div>
            {pin?.greenImageUrl ? (
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "16/9",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "oklch(0.94 0.008 95)",
                  border: "1px solid oklch(0.92 0.008 95)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pin.greenImageUrl}
                  alt=""
                  loading="lazy"
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "block",
                    objectFit: "cover",
                  }}
                />
                {Object.entries(pin.pinByRound ?? {}).map(([r, p]) => {
                  if (!p || p.x == null || p.y == null) return null;
                  const round = Number(r);
                  const colour = ROUND_COLOURS[round] ?? "oklch(0.4 0.02 150)";
                  const isEstimated = (p as { estimated?: boolean }).estimated === true;
                  return (
                    <span
                      key={r}
                      aria-hidden
                      title={
                        isEstimated
                          ? `R${r} — estimated from the SHOTLINK sheet (cluster centroid; API coord pending)`
                          : `R${r} pin`
                      }
                      style={{
                        position: "absolute",
                        left: `${p.x * 100}%`,
                        top: `${p.y * 100}%`,
                        width: 10,
                        height: 10,
                        marginLeft: -5,
                        marginTop: -5,
                        borderRadius: "50%",
                        background: isEstimated ? "transparent" : colour,
                        border: isEstimated
                          ? `2px dashed ${colour}`
                          : "1.5px solid white",
                        boxShadow: isEstimated
                          ? "none"
                          : "0 1px 3px oklch(0 0 0 / 0.4)",
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  width: "100%",
                  aspectRatio: "16/9",
                  borderRadius: 8,
                  background: "oklch(0.96 0.006 95)",
                  border: "1px dashed oklch(0.9 0.008 95)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "oklch(0.6 0.02 150)",
                  fontSize: 11,
                }}
              >
                Green image loading…
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
