import { ImageResponse } from "next/og";
import { cellColorFor } from "@/lib/share-card";

export const runtime = "edge";

// Reddit mobile feed performs best with square 1:1 images. 1080x1080
// is sharp on retina, compresses well, and crops cleanly to the feed
// thumbnail without losing the brand mark or the grid.

const SIZE = 1080;

// A scripted Pros result: brutal start, builds slowly, finally solved
// on guess 6. Tells the "today is hard" story visually in one glance.
const GRID: string[][] = [
  ["K", "K", "K", "W", "K", "K", "K"],
  ["K", "W", "K", "Y", "K", "K", "W"],
  ["K", "W", "Y", "W", "K", "K", "G"],
  ["G", "K", "Y", "W", "Y", "K", "G"],
  ["G", "W", "G", "W", "Y", "W", "G"],
  ["G", "G", "G", "G", "G", "G", "G"],
];

export async function GET() {
  const cellPx = 96;
  const cellGap = 10;

  return new ImageResponse(
    (
      <div
        style={{
          width: SIZE,
          height: SIZE,
          background:
            "linear-gradient(135deg, #0F1F0F 0%, #1F3A1A 50%, #2c5a28 100%)",
          display: "flex",
          flexDirection: "column",
          padding: 64,
          color: "#FFFFFF",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
        }}
      >
        {/* Top bar: wordmark + tagline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 96,
              fontWeight: 900,
              letterSpacing: "-4px",
              lineHeight: 1,
              color: "#FFFFFF",
            }}
          >
            PARDLE
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 36,
              fontWeight: 600,
              color: "#7BAE3F",
              letterSpacing: "1px",
            }}
          >
            Wordle, but for golf pros.
          </div>
        </div>

        {/* Centered grid */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: cellGap,
              padding: 32,
              background: "rgba(255,255,255,0.05)",
              borderRadius: 24,
              border: "1px solid rgba(255,255,255,0.08)",
              transform: "rotate(-2deg)",
            }}
          >
            {GRID.map((row, i) => (
              <div key={i} style={{ display: "flex", gap: cellGap }}>
                {row.map((cell, j) => (
                  <div
                    key={j}
                    style={{
                      width: cellPx,
                      height: cellPx,
                      borderRadius: 12,
                      background: cellColorFor(cell, "pros"),
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom: bold headline + URL */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 88,
              fontWeight: 900,
              letterSpacing: "-3px",
              color: "#FFD64A",
              lineHeight: 1,
            }}
          >
            Today&apos;s is brutal.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 38,
              fontWeight: 700,
              color: "#FFFFFF",
              opacity: 0.85,
              letterSpacing: "1px",
            }}
          >
            pardle.app · new puzzle daily
          </div>
        </div>
      </div>
    ),
    { width: SIZE, height: SIZE },
  );
}
