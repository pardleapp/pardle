import { ImageResponse } from "next/og";

// Per-game OG card for pardle.app/connections.

export const runtime = "edge";
export const revalidate = 1800;
export const alt = "Pardle: Connections — find four groups of four golf items";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CONN_LAUNCH_UTC = Date.UTC(2026, 4, 11);
const ACCENT = "#B388D6";

const COLORS = ["#f9df6d", "#a0c35a", "#b0c4ef", "#ba81c5"];

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
  const day = dayNumberToday(CONN_LAUNCH_UTC);
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
              fontSize: 132,
              fontWeight: 900,
              letterSpacing: "-5px",
              color: ACCENT,
              lineHeight: 1,
              marginTop: 18,
              display: "flex",
              alignItems: "center",
              gap: 22,
            }}
          >
            <div style={{ fontSize: 120, display: "flex" }}>🧩</div>
            <div style={{ display: "flex" }}>Connections</div>
          </div>
          <div
            style={{
              fontSize: 38,
              fontWeight: 700,
              marginTop: 28,
              maxWidth: 580,
              lineHeight: 1.15,
              display: "flex",
            }}
          >
            Find four groups of four. Every item has a golf connection.
          </div>
          <div
            style={{
              marginTop: 40,
              fontSize: 32,
              fontWeight: 800,
              color: "#FFD64A",
              display: "flex",
            }}
          >
            pardle.app/connections
          </div>
        </div>

        {/* 4 stacked coloured bands — the signature NYT Connections look */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            transform: "rotate(-3deg)",
          }}
        >
          {COLORS.map((c, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: 300,
                height: 80,
                background: c,
                borderRadius: 12,
              }}
            />
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
