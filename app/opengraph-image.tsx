import { ImageResponse } from "next/og";

// Hub OG card — what people see when they paste pardle.app into
// WhatsApp / iMessage / Twitter. Three game tiles + wordmark, so the
// link preview reads as "Pardle is a hub for golf puzzles" rather
// than "Pardle is one game" (which the previous Pros-grid card said).

export const runtime = "edge";
export const revalidate = 3600;
export const alt = "Pardle — Daily golf puzzles";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GAMES = [
  { emoji: "🏌️", name: "Pros", color: "#7BAE3F", blurb: "Guess the pro" },
  { emoji: "🛰️", name: "Holes", color: "#5BA0E0", blurb: "ID the course" },
  { emoji: "🏛️", name: "Clubs", color: "#E0A85B", blurb: "Spot the clubhouse" },
];

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(135deg, #0F1F0F 0%, #1F3A1A 50%, #2c5a28 100%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 70,
          color: "#FFFFFF",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "100%",
          }}
        >
          <div
            style={{
              fontSize: 168,
              fontWeight: 900,
              letterSpacing: "-6px",
              lineHeight: 1,
              display: "flex",
            }}
          >
            PARDLE
          </div>
          <div
            style={{
              fontSize: 40,
              opacity: 0.85,
              marginTop: 16,
              display: "flex",
            }}
          >
            Daily golf puzzles
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 24,
            justifyContent: "center",
            width: "100%",
          }}
        >
          {GAMES.map((g) => (
            <div
              key={g.name}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                background: "rgba(255,255,255,0.06)",
                border: `3px solid ${g.color}`,
                borderRadius: 28,
                padding: "32px 36px",
                width: 280,
              }}
            >
              <div style={{ fontSize: 96, lineHeight: 1, display: "flex" }}>
                {g.emoji}
              </div>
              <div
                style={{
                  fontSize: 52,
                  fontWeight: 900,
                  color: g.color,
                  marginTop: 12,
                  display: "flex",
                }}
              >
                {g.name}
              </div>
              <div
                style={{
                  fontSize: 22,
                  opacity: 0.85,
                  marginTop: 6,
                  display: "flex",
                }}
              >
                {g.blurb}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            fontSize: 36,
            fontWeight: 800,
            color: "#FFD64A",
            width: "100%",
          }}
        >
          pardle.app
        </div>
      </div>
    ),
    { ...size },
  );
}
