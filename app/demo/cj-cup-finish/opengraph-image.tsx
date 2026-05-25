import { ImageResponse } from "next/og";

// OG share card for /demo/cj-cup-finish. Designed to stop the
// scroll: huge green +£X figure, the headline number "£5,000",
// and "Pardle" branding bottom-right. 1200×630 = LinkedIn /
// Twitter / WhatsApp standard.

export const runtime = "edge";
export const revalidate = 3600;
export const alt =
  "Wyndham Clark wins the CJ Cup Byron Nelson — £100 bet at +5000 paid £5,000 on Pardle";
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
        {/* Top eyebrow */}
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
          Real result · CJ Cup Byron Nelson · Final round
        </div>

        {/* Hero stat */}
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
              fontSize: 38,
              fontWeight: 700,
              color: FAINT,
              letterSpacing: -1,
            }}
          >
            £100 on Wyndham Clark @ +4900
          </div>
          <div
            style={{
              fontSize: 220,
              fontWeight: 900,
              color: GREEN,
              lineHeight: 1,
              letterSpacing: -8,
              marginTop: 8,
              textShadow: `0 0 60px rgba(0, 217, 110, 0.45)`,
              fontVariantNumeric: "tabular-nums",
              display: "flex",
              alignItems: "baseline",
            }}
          >
            £5,000
          </div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: TEXT,
              marginTop: 18,
              letterSpacing: -0.5,
            }}
          >
            Eagle on 12 · 44-foot birdie on 15 · Wins by 3
          </div>
        </div>

        {/* Footer: Pardle brand + URL */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 24,
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
            Track every £ swing live · pardle.app
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
