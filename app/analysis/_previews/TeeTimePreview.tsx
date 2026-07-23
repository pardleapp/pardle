/**
 * TeeTimePreview — mini scatter of skill-adjusted round score
 * (y-axis) plotted against tee time (x-axis), with a fitted
 * trend line. Static SVG, deterministic dot positions so it
 * renders identically across viewports and never shifts
 * viewer-to-viewer. Illustrates the "morning wave got it easier"
 * signal — a mild downward-then-flat curve of dots below zero
 * on the left, pulling above zero on the right.
 */

// Deterministic pseudo-random points along the day. Each entry is
// [minutes-since-first-tee, adjusted-score]. Range roughly 0-360
// minutes, score −4..+4 with a downward-then-slightly-upward drift.
const POINTS: Array<[number, number]> = [
  [8, -2.4],   [24, -3.1], [36, -1.6], [51, -2.8], [64, -2.1],
  [78, -1.8],  [92, -3.6], [104, -1.2], [118, -2.5], [131, -0.6],
  [144, -2.2], [159, -0.9], [172, -1.5], [186, -0.4], [199, +0.6],
  [212, -1.1], [226, +0.3], [238, +1.7], [252, +0.9], [267, +2.2],
  [280, +1.2], [292, +2.6], [307, +1.5], [321, +3.1], [334, +2.4],
  [348, +2.8], [360, +3.6],
];

const W = 300;
const H = 130;
const PAD = { top: 12, right: 12, bottom: 22, left: 22 };

// Fit line: hard-code slope so it visibly rises from left to right
// (matching the dots' trend).
function fitLine(): { m: number; b: number } {
  const n = POINTS.length;
  const xs = POINTS.map((p) => p[0]);
  const ys = POINTS.map((p) => p[1]);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const m = num / den;
  return { m, b: meanY - m * meanX };
}

export default function TeeTimePreview() {
  const xMin = 0;
  const xMax = 360;
  const yMin = -4;
  const yMax = 4;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const xToPx = (x: number) =>
    PAD.left + ((x - xMin) / (xMax - xMin)) * innerW;
  const yToPx = (y: number) =>
    PAD.top + ((yMax - y) / (yMax - yMin)) * innerH;
  const zeroY = yToPx(0);
  const { m, b } = fitLine();
  const linePath = `M ${xToPx(xMin).toFixed(1)},${yToPx(m * xMin + b).toFixed(1)} L ${xToPx(xMax).toFixed(1)},${yToPx(m * xMax + b).toFixed(1)}`;
  return (
    <div
      aria-hidden
      style={{
        width: "100%",
        aspectRatio: "16/9",
        background:
          "linear-gradient(180deg, oklch(0.98 0.005 95) 0%, oklch(0.96 0.008 155) 100%)",
        borderRadius: "10px 10px 0 0",
        overflow: "hidden",
        padding: 0,
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Zero baseline */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={zeroY}
          y2={zeroY}
          stroke="oklch(0.75 0.02 155)"
          strokeWidth={0.6}
          strokeDasharray="3,3"
        />
        {/* Fill under fit line to make the trend read */}
        <path
          d={`M ${xToPx(xMin).toFixed(1)},${zeroY.toFixed(1)} L ${xToPx(xMin).toFixed(1)},${yToPx(m * xMin + b).toFixed(1)} L ${xToPx(xMax).toFixed(1)},${yToPx(m * xMax + b).toFixed(1)} L ${xToPx(xMax).toFixed(1)},${zeroY.toFixed(1)} Z`}
          fill="oklch(0.85 0.13 155 / 0.15)"
        />
        {/* Dots */}
        {POINTS.map(([x, y], i) => (
          <circle
            key={i}
            cx={xToPx(x)}
            cy={yToPx(y)}
            r={2.6}
            fill={y < 0 ? "oklch(0.50 0.13 155)" : "oklch(0.57 0.19 28)"}
            opacity={0.85}
          />
        ))}
        {/* Fit line */}
        <path
          d={linePath}
          stroke="oklch(0.36 0.08 155)"
          strokeWidth={1.6}
          fill="none"
          strokeLinecap="round"
        />
        {/* Axis stubs */}
        <text
          x={PAD.left - 4}
          y={yToPx(2)}
          fontSize={7}
          fill="oklch(0.55 0.02 155)"
          textAnchor="end"
        >
          +2
        </text>
        <text
          x={PAD.left - 4}
          y={yToPx(-2)}
          fontSize={7}
          fill="oklch(0.55 0.02 155)"
          textAnchor="end"
        >
          −2
        </text>
        <text
          x={xToPx(0)}
          y={H - 6}
          fontSize={7}
          fill="oklch(0.55 0.02 155)"
        >
          AM
        </text>
        <text
          x={xToPx(xMax)}
          y={H - 6}
          fontSize={7}
          fill="oklch(0.55 0.02 155)"
          textAnchor="end"
        >
          PM
        </text>
      </svg>
    </div>
  );
}
