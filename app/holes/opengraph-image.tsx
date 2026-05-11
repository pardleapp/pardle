import { ImageResponse } from "next/og";

// Per-game OG card for pardle.app/holes. Stylised yardage-book hole
// graphic to match the in-game illustrated silhouettes.

export const runtime = "edge";
export const revalidate = 1800;
export const alt = "Pardle: Holes — today's mystery course";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const HOLES_LAUNCH_UTC = Date.UTC(2026, 4, 10);
const ACCENT = "#5BA0E0";

function dayNumberToday(launchUtc: number): number {
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.floor((today - launchUtc) / 86400000) + 1;
}

export default async function OpengraphImage() {
  const day = dayNumberToday(HOLES_LAUNCH_UTC);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(135deg, #0F1F0F 0%, #1F3A1A 50%, #2c5a28 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "72px 88px",
          color: "#FFFFFF",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              opacity: 0.7,
              letterSpacing: "1px",
              display: "flex",
              gap: 14,
            }}
          >
            <div style={{ display: "flex" }}>PARDLE</div>
            <div style={{ display: "flex" }}>·</div>
            <div style={{ display: "flex" }}>DAY {day}</div>
          </div>
          <div
            style={{
              fontSize: 152,
              fontWeight: 900,
              letterSpacing: "-5px",
              color: ACCENT,
              lineHeight: 1,
              marginTop: 18,
              display: "flex",
              alignItems: "center",
              gap: 24,
            }}
          >
            <div style={{ fontSize: 140, display: "flex" }}>🛰️</div>
            <div style={{ display: "flex" }}>Holes</div>
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              marginTop: 28,
              maxWidth: 560,
              lineHeight: 1.15,
              display: "flex",
            }}
          >
            Identify today&apos;s mystery course
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 500,
              marginTop: 14,
              opacity: 0.75,
              display: "flex",
            }}
          >
            67 of the world&apos;s most iconic holes.
          </div>
          <div
            style={{
              marginTop: 44,
              fontSize: 32,
              fontWeight: 800,
              color: "#FFD64A",
              display: "flex",
            }}
          >
            pardle.app/holes
          </div>
        </div>

        {/* Stylised hole illustration — fairway shape with green at top,
            bunker on the side, hole-line in gold. Mirrors the in-game art. */}
        <div
          style={{
            display: "flex",
            width: 360,
            height: 460,
            background: "#143018",
            borderRadius: 24,
            border: "3px solid #1f4524",
            padding: 28,
            transform: "rotate(-3deg)",
            position: "relative",
          }}
        >
          <svg width="100%" height="100%" viewBox="0 0 300 400">
            <path
              d="M150,40 a55,40 0 1,0 0.1,0 Z"
              fill="#2f7825"
            />
            <path
              d="M130 80 Q 60 200 90 360 Q 150 380 210 360 Q 240 200 170 80 Z"
              fill="#4e8b39"
            />
            <ellipse cx="80" cy="200" rx="34" ry="22" fill="#e7d6a3" />
            <ellipse cx="225" cy="280" rx="28" ry="20" fill="#e7d6a3" />
            <path
              d="M150 360 Q 150 220 150 60"
              stroke="#FFD64A"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
            />
            <circle cx="150" cy="55" r="9" fill="#FFD64A" />
          </svg>
        </div>
      </div>
    ),
    { ...size },
  );
}
