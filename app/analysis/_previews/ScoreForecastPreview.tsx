/**
 * ScoreForecastPreview — abstract "field + player projection" hero
 * for the round score forecast tool card. A stylised bell curve with
 * the field mean marked and a player projection tick showing they'd
 * fall well below the mean. All SVG — no image fetches.
 */

export default function ScoreForecastPreview() {
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
        {/* Axis */}
        <line
          x1="20"
          x2="380"
          y1="150"
          y2="150"
          stroke="oklch(0.75 0.02 155)"
          strokeWidth="1"
        />
        {/* Score labels */}
        {[
          { x: 80, label: "62" },
          { x: 160, label: "66" },
          { x: 240, label: "70" },
          { x: 320, label: "74" },
        ].map((t) => (
          <text
            key={t.label}
            x={t.x}
            y={168}
            fontSize="10"
            textAnchor="middle"
            fill="oklch(0.5 0.02 155)"
            fontFamily="var(--font-mono, monospace)"
          >
            {t.label}
          </text>
        ))}
        {/* Field bell curve (approx normal) */}
        <path
          d="M 20 150 C 80 150, 130 148, 180 90, C 220 45, 260 45, 300 90, C 320 130, 340 150, 380 150"
          fill="oklch(0.55 0.14 155 / 0.15)"
          stroke="oklch(0.4 0.15 155)"
          strokeWidth="1.5"
        />
        {/* Field mean marker */}
        <line
          x1="220"
          x2="220"
          y1="55"
          y2="150"
          stroke="oklch(0.35 0.15 155)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <text
          x={220}
          y={45}
          fontSize="10"
          textAnchor="middle"
          fill="oklch(0.35 0.15 155)"
          fontWeight="700"
          fontFamily="var(--font-mono, monospace)"
        >
          Field mean
        </text>
        {/* Elite player projection tick */}
        <circle
          cx="145"
          cy="150"
          r="6"
          fill="oklch(0.42 0.19 28)"
          stroke="white"
          strokeWidth="2"
        />
        <line
          x1="145"
          x2="145"
          y1="150"
          y2="120"
          stroke="oklch(0.42 0.19 28)"
          strokeWidth="1.5"
        />
        <text
          x={145}
          y={112}
          fontSize="10"
          textAnchor="middle"
          fill="oklch(0.42 0.19 28)"
          fontWeight="700"
          fontFamily="var(--font-mono, monospace)"
        >
          Scheffler 65.6
        </text>
        {/* Below-avg player projection tick */}
        <circle
          cx="270"
          cy="150"
          r="5"
          fill="oklch(0.6 0.15 28 / 0.7)"
          stroke="white"
          strokeWidth="2"
        />
        <text
          x={280}
          y={148}
          fontSize="9"
          fill="oklch(0.6 0.15 28)"
          fontWeight="600"
          fontFamily="var(--font-mono, monospace)"
        >
          Lebioda 68.0
        </text>
      </svg>
    </div>
  );
}
