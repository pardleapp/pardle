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

type CellSpec = { state: "green" | "warm" | "yellow" | "grey"; arrow?: "up" | "down" };

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
          background:
            "linear-gradient(135deg, #0F1F0F 0%, #1F3A1A 50%, #2c5a28 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "72px 96px",
          color: COLOR.white,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: 168,
              fontWeight: 900,
              letterSpacing: -7,
              lineHeight: 1,
              color: COLOR.white,
            }}
          >
            PARDLE
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              marginTop: 24,
              maxWidth: 540,
              lineHeight: 1.1,
            }}
          >
            Guess today&apos;s mystery pro golfer
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 500,
              marginTop: 16,
              maxWidth: 480,
              opacity: 0.75,
              lineHeight: 1.35,
              display: "flex",
            }}
          >
            Six guesses. Beat your friends. New every day.
          </div>
          <div
            style={{
              marginTop: 56,
              fontSize: 38,
              fontWeight: 800,
              color: COLOR.accent,
              display: "flex",
            }}
          >
            pardle.app
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 24,
            background: "rgba(255, 255, 255, 0.08)",
            borderRadius: 22,
            transform: "rotate(3deg)",
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
                    width: 80,
                    height: 80,
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
                  }}
                >
                  {cell.arrow === "up" ? "▲" : cell.arrow === "down" ? "▼" : ""}
                </div>
              ))}
            </div>
          ))}
          <div
            style={{
              marginTop: 8,
              fontSize: 22,
              fontWeight: 700,
              color: "rgba(255, 255, 255, 0.85)",
              display: "flex",
              justifyContent: "center",
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
