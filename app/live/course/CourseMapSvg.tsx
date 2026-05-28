"use client";

/**
 * Visual course map. Renders OpenStreetMap-derived course geometry
 * as a stylised top-down SVG in the Pardle v4 palette, with player
 * dots positioned on the hole each player is currently playing.
 *
 * Source data: scripts/extract-courses.mjs writes per-course JSON
 * to lib/data/courses/{slug}.json (license: ODbL, attribution
 * rendered in the footer of this component).
 *
 * Player positioning approximates location-on-hole from
 * holesPlayed / holesRemaining since the orchestrator only exposes
 * "which hole" granularity, not lat/lng of the player. Players
 * stacking on the same hole are fanned around the position with
 * small offsets so they don't overlap.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  CourseFeature,
  CourseGeo,
  CourseHole,
  CourseHolePath,
  LngLat,
} from "@/lib/data/courses/types";

export interface CourseMapPlayer {
  playerId: string;
  displayName: string;
  /** Hole the player is currently on (1..18) — null if pre-round
   *  or off the course. */
  currentHole: number | null;
  /** Stroke total to-par; drives the dot colour (under = green,
   *  over = red, even = neutral). */
  toPar: number;
  position: string;
  thru: string;
  isFollowed?: boolean;
  state?: "hot" | "cold" | null;
}

interface Props {
  course: CourseGeo;
  players: CourseMapPlayer[];
}

const SVG_W = 1200;
const SVG_H = 1200;

/** Equirectangular projection. Acceptable distortion for a ~1km×1km
 *  golf course; we never zoom out far enough for Mercator to matter. */
function makeProject(
  bbox: [number, number, number, number],
  width: number,
  height: number,
) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;
  // Preserve aspect ratio so the course doesn't squash on
  // non-square viewports. We scale to the more constraining axis
  // and centre the other.
  const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const lngScale = width / (lngSpan * cosLat);
  const latScale = height / latSpan;
  const scale = Math.min(lngScale, latScale);
  const drawW = lngSpan * cosLat * scale;
  const drawH = latSpan * scale;
  const offsetX = (width - drawW) / 2;
  const offsetY = (height - drawH) / 2;
  return (lng: number, lat: number): [number, number] => {
    const x = offsetX + (lng - minLng) * cosLat * scale;
    const y = offsetY + (maxLat - lat) * scale; // flip Y (SVG origin top-left)
    return [x, y];
  };
}

function pathFromCoords(
  coords: LngLat[],
  project: (lng: number, lat: number) => [number, number],
  close: boolean,
): string {
  if (coords.length === 0) return "";
  const parts: string[] = [];
  for (let i = 0; i < coords.length; i++) {
    const [x, y] = project(coords[i][0], coords[i][1]);
    parts.push(i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`);
  }
  if (close) parts.push("Z");
  return parts.join(" ");
}

function centroidOf(coords: LngLat[]): LngLat | null {
  if (!coords || coords.length === 0) return null;
  let lng = 0;
  let lat = 0;
  for (const [x, y] of coords) {
    lng += x;
    lat += y;
  }
  return [lng / coords.length, lat / coords.length];
}

function holeDotColour(toPar: number, hot?: "hot" | "cold" | null): string {
  if (hot === "hot") return "#ff9d2e"; // amber
  if (hot === "cold") return "#9aa0a8"; // muted
  if (toPar < 0) return "#00d96e"; // green
  if (toPar > 0) return "#ff4b6b"; // red
  return "#ffffff"; // even
}

/** Position the player's dot somewhere between tee and green based
 *  on intuition: a player early on the hole sits near the tee, a
 *  player further along sits near the green. We don't have a real
 *  shot count per hole, so default to ~75% along (where most
 *  approach shots land). Cluster offsets handle multi-player. */
function positionOnHole(
  hole: CourseHole,
  index: number,
  total: number,
): LngLat | null {
  if (!hole.tee || !hole.green) {
    return hole.green ?? hole.tee ?? null;
  }
  // Centre point along the hole, biased toward the green.
  const t = 0.7;
  const mid: LngLat = [
    hole.tee[0] + (hole.green[0] - hole.tee[0]) * t,
    hole.tee[1] + (hole.green[1] - hole.tee[1]) * t,
  ];
  if (total <= 1) return mid;
  // Fan multiple players around the mid-point. Offset is in
  // degrees — tiny, scaled to roughly the hole's length so it
  // looks like a cluster on the green rather than a starburst.
  const span = Math.hypot(
    hole.green[0] - hole.tee[0],
    hole.green[1] - hole.tee[1],
  );
  const radius = span * 0.15;
  const angle = (index / total) * Math.PI * 2;
  return [mid[0] + radius * Math.cos(angle), mid[1] + radius * Math.sin(angle)];
}

export default function CourseMapSvg({ course, players }: Props) {
  const [selectedHole, setSelectedHole] = useState<number | null>(null);

  const project = useMemo(
    () => makeProject(course.bbox, SVG_W, SVG_H),
    [course.bbox],
  );

  // Group players by hole so we can fan-cluster them.
  const byHole = useMemo(() => {
    const m = new Map<number, CourseMapPlayer[]>();
    for (const p of players) {
      if (p.currentHole == null) continue;
      if (!m.has(p.currentHole)) m.set(p.currentHole, []);
      m.get(p.currentHole)!.push(p);
    }
    return m;
  }, [players]);

  const holeByNum = useMemo(() => {
    const m = new Map<number, CourseHole>();
    for (const h of course.holes) m.set(h.number, h);
    return m;
  }, [course.holes]);

  // Hole-label positions — prefer the green centroid; fall back to
  // the green polygon's centroid or the hole.green field.
  const labelPositions = useMemo(() => {
    const m = new Map<number, LngLat>();
    for (const g of course.greens) {
      if (g.holeNum == null) continue;
      if (!m.has(g.holeNum)) {
        const c = centroidOf(g.coords);
        if (c) m.set(g.holeNum, c);
      }
    }
    for (const h of course.holes) {
      if (!m.has(h.number) && h.green) m.set(h.number, h.green);
    }
    return m;
  }, [course.greens, course.holes]);

  const selectedPlayers = selectedHole != null ? byHole.get(selectedHole) ?? [] : [];
  const selectedHoleMeta = selectedHole != null ? holeByNum.get(selectedHole) : null;

  return (
    <div className="cmap-wrap">
      <svg
        className="cmap-svg"
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Course map of ${course.name}`}
      >
        {/* Background tint over the playing area */}
        <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="#0a0d12" />

        {/* Water — lowest z, painted first */}
        <g className="cmap-water">
          {course.water.map((f) => (
            <path
              key={`w-${f.id}`}
              d={pathFromCoords(f.coords, project, true)}
              fill="#1d3a6e"
              fillOpacity={0.85}
            />
          ))}
        </g>

        {/* Rough — covers the course property in subtle olive */}
        <g className="cmap-rough">
          {course.rough.map((f) => (
            <path
              key={`r-${f.id}`}
              d={pathFromCoords(f.coords, project, true)}
              fill="#1c2a16"
              fillOpacity={0.9}
            />
          ))}
        </g>

        {/* Fairways — primary playable surface, neon-leaning green */}
        <g className="cmap-fairways">
          {course.fairways.map((f) => (
            <path
              key={`f-${f.id}`}
              d={pathFromCoords(f.coords, project, true)}
              fill="#3a6a3a"
              fillOpacity={0.92}
            />
          ))}
        </g>

        {/* Bunkers — warm sand */}
        <g className="cmap-bunkers">
          {course.bunkers.map((f) => (
            <path
              key={`b-${f.id}`}
              d={pathFromCoords(f.coords, project, true)}
              fill="#d9b16a"
              fillOpacity={0.88}
            />
          ))}
        </g>

        {/* Greens — brightest, most-saturated surface so the eye
            tracks where each hole ends */}
        <g className="cmap-greens">
          {course.greens.map((f) => (
            <path
              key={`g-${f.id}`}
              d={pathFromCoords(f.coords, project, true)}
              fill="#5fc97a"
              fillOpacity={0.95}
            />
          ))}
        </g>

        {/* Hole-path centerlines — subtle dashed lines tee→green */}
        <g className="cmap-holepaths">
          {course.holePaths.map((h: CourseHolePath) => (
            <path
              key={`hp-${h.id}`}
              d={pathFromCoords(h.coords, project, false)}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={2}
              strokeDasharray="4 6"
              strokeLinecap="round"
            />
          ))}
        </g>

        {/* Hole numbers — anchored at the green centroid */}
        <g className="cmap-holelabels">
          {Array.from(labelPositions.entries()).map(([n, ll]) => {
            const [x, y] = project(ll[0], ll[1]);
            return (
              <g key={`hl-${n}`}>
                <circle
                  cx={x}
                  cy={y}
                  r={14}
                  fill="rgba(10,13,18,0.78)"
                  stroke="#5fc97a"
                  strokeWidth={1.5}
                />
                <text
                  x={x}
                  y={y + 1}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={14}
                  fontWeight={900}
                  fill="#ffffff"
                  fontFamily="-apple-system, BlinkMacSystemFont, system-ui, sans-serif"
                  pointerEvents="none"
                >
                  {n}
                </text>
              </g>
            );
          })}
        </g>

        {/* Player dots — topmost. Tap a dot or its hole to open the
            slide-up panel listing every player on that hole. */}
        <g className="cmap-players">
          {Array.from(byHole.entries()).map(([holeNum, ps]) => {
            const hole = holeByNum.get(holeNum);
            if (!hole) return null;
            return ps.map((p, i) => {
              const pos = positionOnHole(hole, i, ps.length);
              if (!pos) return null;
              const [x, y] = project(pos[0], pos[1]);
              return (
                <g
                  key={`p-${p.playerId}-${i}`}
                  className="cmap-player"
                  onClick={() => setSelectedHole(holeNum)}
                  style={{ cursor: "pointer" }}
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={9}
                    fill={holeDotColour(p.toPar, p.state)}
                    stroke="#0a0d12"
                    strokeWidth={2.5}
                  />
                  {p.isFollowed && (
                    <circle
                      cx={x}
                      cy={y}
                      r={13}
                      fill="none"
                      stroke="#00d96e"
                      strokeWidth={1.6}
                      strokeDasharray="2 3"
                    />
                  )}
                </g>
              );
            });
          })}
        </g>

        {/* Invisible tap-anywhere zones for each hole. Sized to the
            full hole region so phones tap reliably even between
            dots. The label circles + dots also handle taps but
            these zones make empty-hole taps work too. */}
        <g className="cmap-hitzones">
          {course.holes.map((h) => {
            if (!h.tee || !h.green) return null;
            const [tx, ty] = project(h.tee[0], h.tee[1]);
            const [gx, gy] = project(h.green[0], h.green[1]);
            const mx = (tx + gx) / 2;
            const my = (ty + gy) / 2;
            return (
              <circle
                key={`hz-${h.number}`}
                cx={mx}
                cy={my}
                r={28}
                fill="transparent"
                onClick={() => setSelectedHole(h.number)}
                style={{ cursor: "pointer" }}
              >
                <title>{`Hole ${h.number}${h.par ? ` · Par ${h.par}` : ""}`}</title>
              </circle>
            );
          })}
        </g>
      </svg>

      {selectedHole != null && selectedHoleMeta && (
        <div className="cmap-sheet" role="dialog" aria-modal="true">
          <div className="cmap-sheet-head">
            <div>
              <p className="cmap-sheet-eyebrow">
                Hole {selectedHoleMeta.number}
                {selectedHoleMeta.par ? ` · Par ${selectedHoleMeta.par}` : ""}
                {selectedHoleMeta.yardage ? ` · ${selectedHoleMeta.yardage}y` : ""}
              </p>
              <p className="cmap-sheet-title">
                {selectedPlayers.length === 0
                  ? "No players on this hole right now"
                  : `${selectedPlayers.length} ${selectedPlayers.length === 1 ? "player" : "players"} on this hole`}
              </p>
            </div>
            <button
              type="button"
              className="cmap-sheet-close"
              onClick={() => setSelectedHole(null)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          {selectedPlayers.length > 0 && (
            <ul className="cmap-sheet-list">
              {selectedPlayers.map((p) => (
                <li key={p.playerId} className="cmap-sheet-row">
                  <Link
                    href={`/live/player/${encodeURIComponent(p.playerId)}`}
                    className="cmap-sheet-link"
                  >
                    <span className="cmap-sheet-pos">{p.position}</span>
                    <span className="cmap-sheet-name">{p.displayName}</span>
                    <span
                      className={`cmap-sheet-topar ${
                        p.toPar < 0
                          ? "cmap-sheet-topar-under"
                          : p.toPar > 0
                            ? "cmap-sheet-topar-over"
                            : ""
                      }`}
                    >
                      {p.toPar === 0
                        ? "E"
                        : p.toPar > 0
                          ? `+${p.toPar}`
                          : p.toPar}
                    </span>
                    <span className="cmap-sheet-thru">{p.thru}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="cmap-attr">© OpenStreetMap contributors</p>
    </div>
  );
}
