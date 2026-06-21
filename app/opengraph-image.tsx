import { ImageResponse } from "next/og";

/**
 * Open Graph card rendered for the root URL.
 *
 * Re-skinned to the light "broadcast" v2 theme (warm paper bg, white
 * card with emerald accent stripe, IBM Plex Mono numerals, big
 * flush-right delta) — same visual language users see on /bets and
 * the live shot cards. Below the bet header sits a real-looking
 * bankroll-curve chart so the card answers "what does Pardle do?"
 * at a glance: track a bet, watch its value move in real time.
 *
 * Satori (next/og) can't compute oklch() so the pv-theme tokens are
 * hard-coded here as their sRGB approximations.
 */

export const runtime = "edge";
export const revalidate = 3600;
export const alt =
  "Pardle — track your golf bets, watch them move shot by shot";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// pv-theme tokens, baked from oklch → sRGB.
const PAPER = "#fbf7eb"; // --pv-bg, warm paper
const CARD = "#fdfbf3"; // --pv-card
const SOFT = "#ede9d8"; // --pv-soft
const LINE = "#d8d3c1"; // --pv-line
const INK = "#1a2f23"; // --pv-ink
const MUTED = "#67756d"; // --pv-muted
const EMERALD = "#2f8552"; // --pv-emerald
const EMERALD_D = "#226a3f"; // --pv-emerald-d
const EMERALD_TINT = "rgba(47, 133, 82, 0.14)";
const TANG = "#d36a2e"; // accent for "le" of Pardle

// Win-probability curve over a live tournament day. Slow start, dip
// on a bogey, climb on a hot stretch — shape says "this is what a
// real bet looks like."
const POINTS: [number, number][] = [
  [0, 11],
  [1, 13],
  [2, 10],
  [3, 9],
  [4, 12],
  [5, 16],
  [6, 18],
  [7, 14],
  [8, 22],
  [9, 28],
  [10, 25],
  [11, 26],
  [12, 31],
  [13, 36],
  [14, 41],
  [15, 44],
  [16, 47],
];

const CHART_W = 1072;
const CHART_H = 240;
const PAD = { top: 18, right: 24, bottom: 28, left: 64 };
const X_MIN = 0;
const X_MAX = 16;
const Y_MIN = 0;
const Y_MAX = 55;

function buildChartSvg() {
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const xToPx = (x: number) =>
    PAD.left + ((x - X_MIN) / (X_MAX - X_MIN)) * innerW;
  const yToPx = (y: number) =>
    PAD.top + ((Y_MAX - y) / (Y_MAX - Y_MIN)) * innerH;
  const linePath = POINTS.map(
    ([x, y], i) =>
      `${i === 0 ? "M" : "L"}${xToPx(x).toFixed(1)},${yToPx(y).toFixed(1)}`,
  ).join(" ");
  const firstX = xToPx(POINTS[0][0]);
  const lastX = xToPx(POINTS[POINTS.length - 1][0]);
  const lastY = yToPx(POINTS[POINTS.length - 1][1]);
  const baseY = yToPx(0);
  const areaPath = `M${firstX.toFixed(1)},${baseY.toFixed(1)} ${POINTS.map(
    ([x, y]) => `L${xToPx(x).toFixed(1)},${yToPx(y).toFixed(1)}`,
  ).join(" ")} L${lastX.toFixed(1)},${baseY.toFixed(1)} Z`;
  const midY = PAD.top + innerH / 2;
  const bottomY = CHART_H - PAD.bottom;
  // Dashed zero baseline (0%) at the very bottom — matches the
  // .pnl-chart rendering on the website.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_W}" height="${CHART_H}" viewBox="0 0 ${CHART_W} ${CHART_H}">
    <line x1="${PAD.left}" x2="${CHART_W - PAD.right}" y1="${PAD.top}" y2="${PAD.top}" stroke="${LINE}" stroke-width="1"/>
    <line x1="${PAD.left}" x2="${CHART_W - PAD.right}" y1="${midY}" y2="${midY}" stroke="${LINE}" stroke-width="1"/>
    <line x1="${PAD.left}" x2="${CHART_W - PAD.right}" y1="${bottomY}" y2="${bottomY}" stroke="${LINE}" stroke-width="1" stroke-dasharray="3 4"/>
    <text x="${PAD.left - 14}" y="${PAD.top + 6}" font-size="15" font-weight="700" fill="${MUTED}" text-anchor="end" font-family="monospace">50%</text>
    <text x="${PAD.left - 14}" y="${midY + 5}" font-size="15" font-weight="700" fill="${MUTED}" text-anchor="end" font-family="monospace">25%</text>
    <text x="${PAD.left - 14}" y="${bottomY + 5}" font-size="15" font-weight="700" fill="${MUTED}" text-anchor="end" font-family="monospace">0%</text>
    <path d="${areaPath}" fill="${EMERALD_TINT}"/>
    <path d="${linePath}" stroke="${EMERALD}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="6" fill="${EMERALD}"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export default async function OpengraphImage() {
  try {
    const chartSrc = buildChartSvg();
    return await renderCard(chartSrc);
  } catch (err) {
    const msg =
      err instanceof Error
        ? `${err.name}: ${err.message}\n${err.stack ?? ""}`
        : String(err);
    return new Response(msg, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

async function renderCard(chartSrc: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: PAPER,
          padding: 48,
          display: "flex",
          flexDirection: "column",
          fontFamily: "sans-serif",
          color: INK,
        }}
      >
        {/* Top row: brand wordmark + LIVE chip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 0,
              fontSize: 64,
              fontWeight: 900,
              letterSpacing: -2,
              lineHeight: 1,
            }}
          >
            <span style={{ color: EMERALD }}>Par</span>
            <span style={{ color: TANG }}>dle</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 16px",
              background: EMERALD,
              borderRadius: 999,
              color: "#fff",
              fontWeight: 900,
              fontSize: 14,
              letterSpacing: 2.5,
            }}
          >
            <div
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: "#fff",
                marginRight: 8,
              }}
            />
            LIVE
          </div>
        </div>

        {/* Bet card — light v2 shape: accent stripe + body + flush-right
            score anchor. Mirrors the live ShotPost / BetRow design so a
            shared link previews as the SAME card users will see when
            they land on the site. */}
        <div
          style={{
            marginTop: 28,
            background: CARD,
            border: `1px solid ${LINE}`,
            borderRadius: 18,
            display: "flex",
            flexDirection: "column",
            flex: 1,
            overflow: "hidden",
          }}
        >
          {/* Bet header row — stripe / market+name / hero delta */}
          <div style={{ display: "flex", alignItems: "stretch" }}>
            {/* Emerald accent stripe — same 4px on-the-left as ShotPost */}
            <div style={{ width: 5, background: EMERALD, display: "flex" }} />
            {/* Bet body */}
            <div
              style={{
                flex: 1,
                padding: "20px 22px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 900,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  color: MUTED,
                  display: "flex",
                }}
              >
                Outright winner
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 38,
                  fontWeight: 900,
                  letterSpacing: -1.5,
                  color: INK,
                  lineHeight: 1.05,
                  display: "flex",
                }}
              >
                Rory McIlroy
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 15,
                  color: MUTED,
                  fontWeight: 700,
                  display: "flex",
                  fontFamily: "monospace",
                }}
              >
                @ +400 · stake £50
              </div>
            </div>
            {/* Flush-right score anchor — big mono delta, colour-coded */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                justifyContent: "center",
                padding: "20px 26px 20px 0",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 900,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  color: EMERALD_D,
                  display: "flex",
                  background: EMERALD_TINT,
                  padding: "4px 9px",
                  borderRadius: 6,
                }}
              >
                Winning
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 60,
                  fontWeight: 900,
                  letterSpacing: -2.5,
                  color: EMERALD,
                  lineHeight: 1,
                  fontFamily: "monospace",
                  display: "flex",
                }}
              >
                +£140
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 14,
                  fontWeight: 800,
                  color: MUTED,
                  letterSpacing: -0.2,
                  display: "flex",
                  fontFamily: "monospace",
                }}
              >
                Now worth £190
              </div>
            </div>
          </div>

          {/* Divider before chart so the bet header reads as its own
              "card top" then the chart sits as the visual hero below. */}
          <div style={{ height: 1, background: LINE, display: "flex" }} />

          {/* Chart label band */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              padding: "14px 22px 6px",
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 900,
                color: INK,
                letterSpacing: -0.2,
                display: "flex",
              }}
            >
              Win probability
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: MUTED,
                letterSpacing: 0.4,
                display: "flex",
              }}
            >
              17 shots tracked · today
            </div>
          </div>

          {/* Chart — pre-rendered SVG as data URL for Satori compat */}
          <div style={{ padding: "0 14px 14px", display: "flex" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={chartSrc} alt="" width={CHART_W} height={CHART_H} />
          </div>
        </div>

        {/* Footer row — URL + tagline */}
        <div
          style={{
            marginTop: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: INK,
              letterSpacing: -0.5,
              display: "flex",
            }}
          >
            pardle.app
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              color: MUTED,
              letterSpacing: 3,
              textTransform: "uppercase",
              display: "flex",
            }}
          >
            Every bet · Every shot · Real time
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
