import { ImageResponse } from "next/og";

export const runtime = "edge";
export const revalidate = 1800;
export const alt = "Pardle: Faces — two famous pros, blended into one";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FACES_LAUNCH_UTC = Date.UTC(2026, 4, 11);
const ACCENT = "#E07B5B";

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
  const day = dayNumberToday(FACES_LAUNCH_UTC);
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
            <div style={{ fontSize: 140, display: "flex" }}>👥</div>
            <div style={{ display: "flex" }}>Faces</div>
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
            Two famous pros, blended into one face
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
            Can you name them both?
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
            pardle.app/faces
          </div>
        </div>

        <div
          style={{
            position: "relative",
            width: 360,
            height: 360,
            borderRadius: 24,
            overflow: "hidden",
            background: ACCENT,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: "rotate(3deg)",
            boxShadow: "0 16px 40px rgba(0,0,0,0.4)",
          }}
        >
          <div
            style={{
              fontSize: 220,
              display: "flex",
              filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.3))",
            }}
          >
            👥
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
