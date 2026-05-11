import { ImageResponse } from "next/og";

// Per-game OG card for pardle.app/clubs. Parchment + ink silhouette
// to match the in-game card style.

export const runtime = "edge";
export const revalidate = 1800;
export const alt = "Pardle: Clubhouses — name the course from its clubhouse";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CLUBS_LAUNCH_UTC = Date.UTC(2026, 4, 11);
const ACCENT = "#E0A85B";

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
  const day = dayNumberToday(CLUBS_LAUNCH_UTC);
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
            <div style={{ fontSize: 140, display: "flex" }}>🏛️</div>
            <div style={{ display: "flex" }}>Clubhouses</div>
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
            Name the course from its clubhouse
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
            Six guesses, top-down silhouette.
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
            pardle.app/clubs
          </div>
        </div>

        {/* Parchment card with a generic clubhouse silhouette */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 360,
            height: 360,
            background: "#f3ead5",
            borderRadius: 24,
            border: "3px solid #d8c89a",
            padding: 28,
            transform: "rotate(-3deg)",
          }}
        >
          <svg width="100%" height="100%" viewBox="0 0 320 240">
            <g fill="#2a2a2a">
              <rect x="30" y="120" width="260" height="80" />
              <polygon points="20,120 160,40 300,120" />
              <rect x="70" y="70" width="20" height="30" />
              <rect x="148" y="140" width="24" height="60" fill="#f3ead5" />
              <rect x="60" y="150" width="22" height="22" fill="#f3ead5" />
              <rect x="220" y="150" width="22" height="22" fill="#f3ead5" />
              <rect x="100" y="150" width="22" height="22" fill="#f3ead5" />
              <rect x="180" y="150" width="22" height="22" fill="#f3ead5" />
            </g>
          </svg>
        </div>
      </div>
    ),
    { ...size },
  );
}
