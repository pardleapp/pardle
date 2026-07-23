"use client";

/**
 * TeeShotPreview — mini SIDE-view ball-flight card matching the
 * real ProfileVisuals.BallFlightCard used on /analysis/tee-shots.
 * Four dashed arcs sweep from a tee at bottom-left up to their apex
 * markers, then land on the ground line — same design language as
 * the surface it previews. One arc draws at a time on a loop; the
 * full set stays visible between passes so a static viewer still
 * gets the story.
 *
 * Honours prefers-reduced-motion by disabling the draw-in animation.
 */

const W = 300;
const H = 168;
const PAD = { top: 12, right: 12, bottom: 22, left: 22 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

// Four representative flights. Each has (carry_x, apex_x, apex_y),
// with y measured up from ground. Player-1 = tour-average (dimmer,
// grey-ish); player-2 is the highlighted profile (brighter emerald).
interface Shot {
  colour: string;
  carry: number;    // fraction of PLOT_W where the ball lands
  apexAt: number;   // fraction of PLOT_W at apex
  apexHeight: number; // fraction of PLOT_H at apex
  primary?: boolean;
  delay: number;
}

const SHOTS: Shot[] = [
  { colour: "oklch(0.50 0.13 155)", carry: 0.86, apexAt: 0.55, apexHeight: 0.72, primary: true, delay: 0.2 },
  { colour: "oklch(0.55 0.15 250)", carry: 0.74, apexAt: 0.50, apexHeight: 0.62, delay: 0.55 },
  { colour: "oklch(0.55 0.20 25)",  carry: 0.68, apexAt: 0.44, apexHeight: 0.55, delay: 0.90 },
  { colour: "oklch(0.60 0.18 65)",  carry: 0.80, apexAt: 0.52, apexHeight: 0.68, delay: 1.25 },
];

function xToPx(fx: number): number {
  return PAD.left + fx * PLOT_W;
}
function yToPx(fy: number): number {
  return PAD.top + (1 - fy) * PLOT_H;
}

function arcPath(shot: Shot): { d: string; length: number; apex: { x: number; y: number } } {
  const startX = xToPx(0);
  const startY = yToPx(0);
  const landX = xToPx(shot.carry);
  const landY = yToPx(0);
  const apexX = xToPx(shot.apexAt);
  const apexY = yToPx(shot.apexHeight);
  // Quadratic through start/land with control lifted above apex so
  // the curve peaks at the intended apex point (control ~2× apex).
  const cx = apexX * 2 - (startX + landX) / 2;
  const cy = apexY * 2 - (startY + landY) / 2;
  const d = `M ${startX},${startY} Q ${cx.toFixed(1)},${cy.toFixed(1)} ${landX},${landY}`;
  // Approximate arc length for the dashoffset animation. Quadratic
  // bezier length approximation via Simpson's rule; a straight-line
  // fallback is close enough for the visual effect.
  const straight = Math.hypot(landX - startX, landY - startY);
  const via = Math.hypot(cx - startX, cy - startY) + Math.hypot(landX - cx, landY - cy);
  const length = (straight + via) / 2;
  return { d, length, apex: { x: apexX, y: apexY } };
}

export default function TeeShotPreview() {
  const arcs = SHOTS.map((s) => ({ shot: s, ...arcPath(s) }));
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16/9",
        overflow: "hidden",
        borderRadius: "10px 10px 0 0",
        background: "oklch(0.98 0.005 95)",
      }}
    >
      <style>{`
        @keyframes tee-arc-draw {
          0%    { stroke-dashoffset: var(--len); opacity: 0.15; }
          8%    { opacity: 0.9; }
          55%   { stroke-dashoffset: 0; opacity: 0.9; }
          85%   { stroke-dashoffset: 0; opacity: 0.9; }
          100%  { stroke-dashoffset: 0; opacity: 0.55; }
        }
        .tee-arc {
          animation: tee-arc-draw 4.6s ease-out infinite;
        }
        .tee-apex {
          animation: tee-apex-pulse 4.6s ease-out infinite;
          opacity: 0;
        }
        @keyframes tee-apex-pulse {
          0%, 50%   { opacity: 0; }
          58%       { opacity: 1; }
          100%      { opacity: 0.85; }
        }
        @media (prefers-reduced-motion: reduce) {
          .tee-arc {
            animation: none;
            stroke-dashoffset: 0;
            opacity: 0.7;
          }
          .tee-apex {
            animation: none;
            opacity: 0.85;
          }
        }
      `}</style>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Ground line + y axis stubs, mirroring BallFlightCard side view */}
        <line
          x1={PAD.left}
          y1={PAD.top + PLOT_H}
          x2={PAD.left + PLOT_W}
          y2={PAD.top + PLOT_H}
          stroke="oklch(0.85 0.013 95)"
          strokeWidth={1}
        />
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={PAD.top + PLOT_H}
          stroke="oklch(0.85 0.013 95)"
          strokeWidth={1}
        />
        {/* Axis labels — small, unobtrusive */}
        <text
          x={PAD.left}
          y={H - 6}
          fontSize={8}
          fill="oklch(0.5 0.02 150)"
        >
          0
        </text>
        <text
          x={PAD.left + PLOT_W}
          y={H - 6}
          fontSize={8}
          fill="oklch(0.5 0.02 150)"
          textAnchor="end"
        >
          320 yd
        </text>
        <text
          x={PAD.left - 4}
          y={PAD.top + 6}
          fontSize={8}
          fill="oklch(0.5 0.02 150)"
          textAnchor="end"
        >
          130 ft
        </text>

        {/* Arcs — dashed like the real card, staggered draw-in */}
        {arcs.map(({ shot, d, length }, i) => (
          <path
            key={`arc-${i}`}
            d={d}
            fill="none"
            stroke={shot.colour}
            strokeWidth={shot.primary ? 1.9 : 1.4}
            strokeLinecap="round"
            strokeDasharray="3 4"
            opacity={shot.primary ? 0.9 : 0.75}
            className="tee-arc"
            style={{
              // custom prop feeds the keyframe so each path animates
              // its own length correctly
              // @ts-expect-error CSS custom property
              "--len": length.toFixed(1),
              strokeDashoffset: length.toFixed(1),
              animationDelay: `${shot.delay}s`,
            }}
          />
        ))}

        {/* Apex markers — small filled circles, appear as arc completes */}
        {arcs.map(({ shot, apex }, i) => (
          <circle
            key={`apex-${i}`}
            cx={apex.x}
            cy={apex.y}
            r={shot.primary ? 3.4 : 2.8}
            fill={shot.colour}
            className="tee-apex"
            style={{ animationDelay: `${shot.delay}s` }}
          />
        ))}

        {/* Tee marker — small dot at origin */}
        <circle
          cx={xToPx(0)}
          cy={yToPx(0)}
          r={2.5}
          fill="oklch(0.28 0.04 155)"
        />
      </svg>
      {/* Corner label, matches the real card's "SIDE" eyebrow */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 10,
          fontSize: 10,
          letterSpacing: 0.7,
          fontWeight: 800,
          color: "oklch(0.42 0.02 150)",
          textTransform: "uppercase",
          fontFamily: "var(--font-archivo), 'Archivo', system-ui, sans-serif",
        }}
      >
        Side
      </div>
    </div>
  );
}
