/**
 * CourseHistoryPreview — abstract "at-course vs baseline SG" bars
 * for the course history tool card. Two mini bar comparisons showing
 * a player over-performing and another under-performing their
 * SG:OTT+APP baseline at the same course.
 */

export default function CourseHistoryPreview() {
  return (
    <div
      aria-hidden
      style={{
        width: "100%",
        aspectRatio: "16/9",
        background:
          "linear-gradient(180deg, oklch(0.98 0.005 155) 0%, oklch(0.94 0.02 155) 100%)",
        borderRadius: "10px 10px 0 0",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "4% 6%",
      }}
    >
      <svg viewBox="0 0 400 180" width="100%" height="100%">
        {/* Axis (0 line) */}
        <line
          x1="200"
          x2="200"
          y1="20"
          y2="160"
          stroke="oklch(0.75 0.02 155)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        <text
          x={200}
          y={175}
          fontSize="10"
          textAnchor="middle"
          fill="oklch(0.5 0.02 155)"
          fontFamily="var(--font-mono, monospace)"
        >
          0
        </text>

        {/* Player A: over-performer */}
        <text
          x={20}
          y={38}
          fontSize="10"
          fill="oklch(0.3 0.03 155)"
          fontWeight="700"
          fontFamily="var(--font-archivo), Archivo, sans-serif"
        >
          Player A
        </text>
        {/* Baseline bar (muted) */}
        <rect
          x={200}
          y={44}
          width={45}
          height={10}
          fill="oklch(0.75 0.03 155)"
          rx="1"
        />
        <text
          x={252}
          y={52}
          fontSize="9"
          fill="oklch(0.5 0.02 150)"
          fontFamily="var(--font-mono, monospace)"
        >
          +1.5 baseline
        </text>
        {/* At-course bar (bigger, emerald) */}
        <rect
          x={200}
          y={58}
          width={78}
          height={14}
          fill="oklch(0.5 0.13 155)"
          rx="1.5"
        />
        <text
          x={285}
          y={68}
          fontSize="10"
          fill="oklch(0.42 0.13 155)"
          fontWeight="700"
          fontFamily="var(--font-mono, monospace)"
        >
          +2.6 at course
        </text>
        <text
          x={20}
          y={68}
          fontSize="11"
          fill="oklch(0.42 0.13 155)"
          fontWeight="800"
          fontFamily="var(--font-mono, monospace)"
        >
          Δ +1.1
        </text>

        {/* Player B: under-performer */}
        <text
          x={20}
          y={110}
          fontSize="10"
          fill="oklch(0.3 0.03 155)"
          fontWeight="700"
          fontFamily="var(--font-archivo), Archivo, sans-serif"
        >
          Player B
        </text>
        {/* Baseline bar (muted) */}
        <rect
          x={200}
          y={116}
          width={55}
          height={10}
          fill="oklch(0.75 0.03 155)"
          rx="1"
        />
        <text
          x={262}
          y={124}
          fontSize="9"
          fill="oklch(0.5 0.02 150)"
          fontFamily="var(--font-mono, monospace)"
        >
          +1.8 baseline
        </text>
        {/* At-course bar (smaller, tang) */}
        <rect
          x={200}
          y={130}
          width={25}
          height={14}
          fill="oklch(0.66 0.18 45)"
          rx="1.5"
        />
        <text
          x={232}
          y={140}
          fontSize="10"
          fill="oklch(0.55 0.17 40)"
          fontWeight="700"
          fontFamily="var(--font-mono, monospace)"
        >
          +0.8 at course
        </text>
        <text
          x={20}
          y={140}
          fontSize="11"
          fill="oklch(0.55 0.17 40)"
          fontWeight="800"
          fontFamily="var(--font-mono, monospace)"
        >
          Δ −1.0
        </text>
      </svg>
    </div>
  );
}
