import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Pardle — daily mystery golfer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COLOR = {
  bgFrom: "#0F1F0F",
  bgTo: "#1F3A1A",
  accent: "#FFD64A",
  white: "#FFFFFF",
  green: "#7BAE3F",
  warm: "#B5D332",
  yellow: "#E8C547",
  grey: "#5C6063",
};

type CellSpec = { state: "green" | "warm" | "yellow" | "grey"; arrow?: "up" | "down" | null };

// Three rows simulating a successful solve — the visual story is "kept
// guessing, getting warmer, nailed it on the third try."
const ROWS: CellSpec[][] = [
  [
    { state: "grey" },
    { state: "yellow", arrow: "up" },
    { state: "grey" },
    { state: "yellow", arrow: "down" },
    { state: "grey" },
    { state: "warm", arrow: "up" },
  ],
  [
    { state: "warm", arrow: "up" },
    { state: "green" },
    { state: "grey" },
    { state: "green" },
    { state: "warm", arrow: "down" },
    { state: "yellow", arrow: "up" },
  ],
  [
    { state: "green" },
    { state: "green" },
    { state: "green" },
    { state: "green" },
    { state: "green" },
    { state: "green" },
  ],
];

function cellColor(state: CellSpec["state"]): string {
  if (state === "green") return COLOR.green;
  if (state === "warm") return COLOR.warm;
  if (state === "yellow") return COLOR.yellow;
  return COLOR.grey;
}

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: `radial-gradient(circle at 30% 20%, #2c5a28 0%, ${COLOR.bgTo} 45%, ${COLOR.bgFrom} 100%)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "72px 96px",
          color: COLOR.white,
          fontFamily: "system-ui, sans-serif",
          position: "relative",
        }}
      >
        {/* Subtle diagonal texture */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent 0 32px, rgba(255,255,255,0.035) 32px 34px)",
          }}
        />

        {/* Top-right small badge */}
        <div
          style={{
            position: "absolute",
            top: 36,
            right: 48,
            padding: "8px 18px",
            background: "rgba(255, 214, 74, 0.15)",
            border: "1.5px solid rgba(255, 214, 74, 0.55)",
            borderRadius: 999,
            fontSize: 22,
            fontWeight: 700,
            color: COLOR.accent,
            letterSpacing: 0.4,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 22 }}>🏌️</span>
          NEW PUZZLE DAILY
        </div>

        {/* Left column — branding + tagline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            zIndex: 2,
            maxWidth: 540,
          }}
        >
          <div
            style={{
              fontSize: 168,
              fontWeight: 900,
              letterSpacing: -7,
              lineHeight: 0.88,
              color: COLOR.white,
              textShadow: "0 6px 28px rgba(0, 0, 0, 0.55)",
            }}
          >
            PARDLE
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              opacity: 0.96,
              letterSpacing: -0.5,
              marginTop: 22,
              lineHeight: 1.1,
            }}
          >
            Guess today's mystery pro golfer
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 500,
              opacity: 0.7,
              marginTop: 14,
              lineHeight: 1.35,
              maxWidth: 480,
            }}
          >
            Six guesses. Beat your friends.
            <br />
            New puzzle at midday.
          </div>
          <div
            style={{
              marginTop: 48,
              fontSize: 36,
              fontWeight: 800,
              color: COLOR.accent,
              letterSpacing: 0.5,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: COLOR.accent,
                boxShadow: `0 0 16px ${COLOR.accent}`,
              }}
            />
            pardle.app
          </div>
        </div>

        {/* Right column — game grid demo */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: 28,
            background: "rgba(255, 255, 255, 0.07)",
            borderRadius: 22,
            border: "2px solid rgba(255, 255, 255, 0.12)",
            boxShadow: "0 24px 60px rgba(0, 0, 0, 0.45)",
            backdropFilter: "blur(6px)",
            transform: "rotate(2.5deg)",
            zIndex: 2,
          }}
        >
          {ROWS.map((row, rowIdx) => (
            <div
              key={rowIdx}
              style={{ display: "flex", gap: 10 }}
            >
              {row.map((cell, cellIdx) => (
                <div
                  key={cellIdx}
                  style={{
                    width: 86,
                    height: 86,
                    borderRadius: 8,
                    background: cellColor(cell.state),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 30,
                    fontWeight: 900,
                    color:
                      cell.state === "yellow" || cell.state === "warm"
                        ? "#1a1a1a"
                        : "#ffffff",
                    boxShadow: "0 6px 14px rgba(0, 0, 0, 0.3)",
                  }}
                >
                  {cell.arrow === "up" ? "▲" : cell.arrow === "down" ? "▼" : ""}
                </div>
              ))}
            </div>
          ))}
          <div
            style={{
              marginTop: 10,
              fontSize: 22,
              fontWeight: 700,
              color: "rgba(255, 255, 255, 0.85)",
              textAlign: "center",
              letterSpacing: 0.5,
            }}
          >
            Solved in 3/6
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
