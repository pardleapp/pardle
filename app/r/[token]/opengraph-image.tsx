import { ImageResponse } from "next/og";
import {
  cellColorFor,
  decodeShareCard,
  shareGameAccent,
  shareGameTitle,
} from "@/lib/share-card";

// Dynamic OG image — renders the share-card grid as a PNG so that
// when someone pastes pardle.app/r/{token} into WhatsApp / iMessage /
// Twitter, the preview unfurls as a branded result card.

export const runtime = "edge";
export const alt = "Pardle result";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface Params {
  params: Promise<{ token: string }>;
}

export default async function OpengraphImage({ params }: Params) {
  const { token } = await params;
  const payload = decodeShareCard(token);

  if (!payload) {
    // Bad token — return a generic hub card so the link still
    // unfurls into something branded.
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "linear-gradient(135deg, #0F1F0F 0%, #2c5a28 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontFamily: "system-ui, sans-serif",
            fontSize: 132,
            fontWeight: 900,
            letterSpacing: "-4px",
          }}
        >
          PARDLE
        </div>
      ),
      { ...size },
    );
  }

  const game = shareGameTitle(payload.g);
  const accent = shareGameAccent(payload.g);
  const rows = payload.r.split("|").map((row) => row.split(""));

  // Auto-size grid cells so it always fits centred on the canvas
  // regardless of which game (Pros=6×6, Connections=4×4, Holes=6×5).
  const maxCellPx = 70;
  const cellGap = 8;
  const rowGap = 8;
  const maxCols = Math.max(...rows.map((r) => r.length));
  const longestSide = Math.max(rows.length, maxCols);
  const cellPx = Math.min(maxCellPx, Math.floor(420 / longestSide));

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
          padding: "60px 80px",
          color: "#FFFFFF",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* LEFT: brand + game + score */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            maxWidth: 520,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 14,
              fontSize: 26,
              fontWeight: 700,
              opacity: 0.72,
              letterSpacing: "1px",
            }}
          >
            <span>PARDLE</span>
            <span>·</span>
            <span>DAY {payload.d}</span>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 124,
              fontWeight: 900,
              letterSpacing: "-4px",
              color: accent,
              lineHeight: 1,
            }}
          >
            {game}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 88,
              fontWeight: 900,
              letterSpacing: "-2px",
              color: "#FFD64A",
              lineHeight: 1,
              marginTop: 8,
            }}
          >
            {payload.s}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              fontWeight: 600,
              opacity: 0.85,
              marginTop: 20,
            }}
          >
            Beat me at pardle.app
          </div>
        </div>

        {/* RIGHT: grid of result cells */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: rowGap,
            padding: 28,
            background: "rgba(255, 255, 255, 0.06)",
            borderRadius: 20,
            transform: "rotate(3deg)",
          }}
        >
          {rows.map((row, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: cellGap }}
            >
              {row.map((cell, j) => (
                <div
                  key={j}
                  style={{
                    width: cellPx,
                    height: cellPx,
                    borderRadius: 8,
                    background: cellColorFor(cell, payload.g),
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
