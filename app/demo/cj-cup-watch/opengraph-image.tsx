import { ImageResponse } from "next/og";

// OG share card for /demo/cj-cup-watch. Same hero numbers as the
// static demo's card, but eyebrow says "WATCH" so clickers know
// it's an animated experience, not a screenshot.

export const runtime = "edge";
export const revalidate = 3600;
export const alt =
  "Watch £100 turn into £5,000 — Wyndham Clark's CJ Cup back 9 on Pardle";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG_TOP = "#0a0d12";
const BG_MID = "#15171b";
const GREEN = "#00d96e";
const AMBER = "#ff9d2e";
const TEXT = "#f5f5f7";
const FAINT = "#9aa0a8";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: `radial-gradient(circle at 20% 30%, ${BG_MID} 0%, ${BG_TOP} 70%)`,
          display: "flex",
          flexDirection: "column",
          padding: "60px 72px",
          fontFamily: "system-ui, sans-serif",
          color: TEXT,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: 2,
            color: AMBER,
            textTransform: "uppercase",
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: GREEN,
              boxShadow: `0 0 18px ${GREEN}`,
            }}
          />
          Tap to watch · 13 seconds
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flex: 1,
            marginTop: 30,
          }}
        >
          <div
            style={{
              fontSize: 36,
              fontWeight: 700,
              color: FAINT,
              letterSpacing: -1,
            }}
          >
            £100 at +4900 →
          </div>
          <div
            style={{
              fontSize: 240,
              fontWeight: 900,
              color: GREEN,
              lineHeight: 1,
              letterSpacing: -10,
              marginTop: 6,
              textShadow: `0 0 60px rgba(0, 217, 110, 0.5)`,
              fontVariantNumeric: "tabular-nums",
              display: "flex",
              alignItems: "baseline",
            }}
          >
            £5,000
          </div>
          <div
            style={{
              fontSize: 30,
              fontWeight: 700,
              color: TEXT,
              marginTop: 22,
              letterSpacing: -0.5,
            }}
          >
            Eagle on 12 · 44-foot birdie on 15 · The whole back 9, live
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 22,
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <div
            style={{
              fontSize: 30,
              fontWeight: 900,
              color: TEXT,
              letterSpacing: 1,
            }}
          >
            Pardle
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: FAINT,
              letterSpacing: 1,
            }}
          >
            pardle.app/demo/cj-cup-watch
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
