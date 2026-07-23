"use client";

/**
 * TeeShotPreview — animated fan of driver ball flights sweeping out
 * from a common tee point. Each line traces a slightly different
 * arc + landing position (draw / fade / straight variations). Lines
 * animate in staggered via CSS keyframes on stroke-dashoffset, then
 * the whole set fades and restarts — creates a "watching every drive
 * this weekend at once" impression.
 *
 * Client component only for the CSS-keyframe declaration; nothing
 * needs JS state, so no hydration overhead beyond the style tag.
 */

const SHOTS: Array<{
  path: string;
  colour: string;
  delay: number;
}> = [
  // Origin: bottom-center (tee). All paths end above the horizon.
  { path: "M 150 122 Q 130 60 90 42", colour: "oklch(0.55 0.18 250)", delay: 0.0 },
  { path: "M 150 122 Q 145 55 115 32", colour: "oklch(0.60 0.18 65)", delay: 0.35 },
  { path: "M 150 122 Q 158 50 148 26", colour: "oklch(0.55 0.20 300)", delay: 0.7 },
  { path: "M 150 122 Q 170 55 185 30", colour: "oklch(0.55 0.20 25)", delay: 1.05 },
  { path: "M 150 122 Q 195 62 220 40", colour: "oklch(0.50 0.13 155)", delay: 1.4 },
  { path: "M 150 122 Q 220 78 260 55", colour: "oklch(0.57 0.19 28)", delay: 1.75 },
];

const PATH_LENGTH = 130; // approximate — enough for the dasharray trick

export default function TeeShotPreview() {
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16/9",
        overflow: "hidden",
        borderRadius: "10px 10px 0 0",
        // Fairway gradient — warm brown teebox at the bottom, deep
        // fairway green rolling forward, sky above.
        background:
          "linear-gradient(180deg, oklch(0.86 0.05 90) 0%, oklch(0.75 0.08 145) 42%, oklch(0.55 0.09 145) 100%)",
      }}
    >
      <style>{`
        @keyframes tee-shot-draw {
          0%   { stroke-dashoffset: ${PATH_LENGTH}; opacity: 0; }
          10%  { opacity: 1; }
          55%  { stroke-dashoffset: 0; opacity: 1; }
          92%  { opacity: 1; }
          100% { stroke-dashoffset: 0; opacity: 0; }
        }
        .tee-shot-path {
          stroke-dasharray: ${PATH_LENGTH};
          stroke-dashoffset: ${PATH_LENGTH};
          animation: tee-shot-draw 4.8s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .tee-shot-path {
            animation: none;
            stroke-dashoffset: 0;
            opacity: 0.55;
          }
        }
      `}</style>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 300 168"
        preserveAspectRatio="xMidYMid slice"
      >
        {/* Tee marker */}
        <circle
          cx={150}
          cy={122}
          r={4}
          fill="oklch(0.28 0.04 155)"
          opacity={0.8}
        />
        <circle
          cx={150}
          cy={122}
          r={9}
          fill="none"
          stroke="oklch(0.28 0.04 155 / 0.35)"
          strokeWidth={0.8}
        />
        {SHOTS.map((s, i) => (
          <g key={i}>
            {/* Trail — subtle shadow behind the ball line */}
            <path
              d={s.path}
              stroke={s.colour}
              strokeOpacity={0.25}
              strokeWidth={5.5}
              fill="none"
              strokeLinecap="round"
              className="tee-shot-path"
              style={{ animationDelay: `${s.delay}s` }}
            />
            {/* Main ball path */}
            <path
              d={s.path}
              stroke={s.colour}
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              className="tee-shot-path"
              style={{ animationDelay: `${s.delay}s` }}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
