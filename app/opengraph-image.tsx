import { ImageResponse } from "next/og";

/**
 * Open Graph card rendered for the root URL.
 *
 * Shows the brand wordmark + a sample win-probability chart trending
 * up, so any pardle.app link unfurls as a "this is a real-time sports
 * data app" preview rather than a generic puzzle-game card.
 */

export const runtime = "edge";
export const revalidate = 3600;
export const alt = "Pardle — live bet tracker + tournament feed for PGA Tour";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#0b0e13";
const SURFACE = "#141821";
const SURFACE_2 = "#1c2230";
const TEXT = "#e8eaed";
const MUTED = "#8a93a3";
const GREEN = "#7BAE3F";
const GREEN_BRIGHT = "#9bd24d";
const GREEN_SOFT = "rgba(123, 174, 63, 0.18)";
const RED_SOFT = "rgba(248, 113, 113, 0.16)";

// Plausible win-prob trajectory across a tournament day. Slow start,
// dip on a bogey, climb on a hot stretch, ends near a fair value of
// ~45%. Shape sells the "this is what a real bet looks like."
const POINTS: [number, number][] = [
  [0, 11],
  [1, 13],
  [2, 9],
  [3, 8],
  [4, 12],
  [5, 16],
  [6, 18],
  [7, 14],
  [8, 22],
  [9, 28],
  [10, 25],
  [11, 24],
  [12, 30],
  [13, 36],
  [14, 41],
  [15, 44],
  [16, 47],
];

const CHART_W = 1072;
const CHART_H = 240;
const PAD = { top: 20, right: 24, bottom: 28, left: 56 };
const X_MIN = 0;
const X_MAX = 16;
const Y_MIN = 0;
const Y_MAX = 55;

// Build the chart as a standalone SVG string, then embed it as a
// data: URL <img>. Satori (next/og) is finicky about inline SVG
// inside JSX — an <img src="data:image/svg+xml,..."> renders
// reliably and is what Vercel themselves recommend.
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_W}" height="${CHART_H}" viewBox="0 0 ${CHART_W} ${CHART_H}">
    <line x1="${PAD.left}" x2="${CHART_W - PAD.right}" y1="${PAD.top}" y2="${PAD.top}" stroke="${SURFACE_2}" stroke-width="1"/>
    <line x1="${PAD.left}" x2="${CHART_W - PAD.right}" y1="${midY}" y2="${midY}" stroke="${SURFACE_2}" stroke-width="1"/>
    <line x1="${PAD.left}" x2="${CHART_W - PAD.right}" y1="${bottomY}" y2="${bottomY}" stroke="${SURFACE_2}" stroke-width="1"/>
    <text x="${PAD.left - 12}" y="${PAD.top + 5}" font-size="14" font-weight="800" fill="${MUTED}" text-anchor="end" font-family="sans-serif">50%</text>
    <text x="${PAD.left - 12}" y="${midY + 5}" font-size="14" font-weight="800" fill="${MUTED}" text-anchor="end" font-family="sans-serif">25%</text>
    <text x="${PAD.left - 12}" y="${bottomY + 5}" font-size="14" font-weight="800" fill="${MUTED}" text-anchor="end" font-family="sans-serif">0%</text>
    <path d="${areaPath}" fill="${GREEN_SOFT}"/>
    <path d="${linePath}" stroke="${GREEN}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="6" fill="${GREEN_BRIGHT}"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export default async function OpengraphImage() {
  try {
    const chartSrc = buildChartSvg();
    return await renderCard(chartSrc);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err);
    return new Response(msg, { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

async function renderCard(chartSrc: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          padding: 56,
          display: "flex",
          flexDirection: "column",
          fontFamily: "sans-serif",
          color: TEXT,
        }}
      >
        {/* Top row: wordmark + LIVE chip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                fontSize: 72,
                fontWeight: 900,
                letterSpacing: -3,
                color: TEXT,
                lineHeight: 1,
              }}
            >
              Pardle
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 16,
                fontWeight: 800,
                letterSpacing: 4,
                textTransform: "uppercase",
                color: MUTED,
                display: "flex",
              }}
            >
              Live bet tracker · PGA Tour
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "10px 18px",
              background: RED_SOFT,
              borderRadius: 999,
              color: "#f87171",
              fontWeight: 900,
              fontSize: 16,
              letterSpacing: 3,
            }}
          >
            <div
              style={{
                width: 11,
                height: 11,
                borderRadius: "50%",
                background: "#f87171",
                marginRight: 10,
              }}
            />
            LIVE
          </div>
        </div>

        {/* Bet card */}
        <div
          style={{
            marginTop: 36,
            padding: 28,
            background: SURFACE,
            borderRadius: 24,
            display: "flex",
            flexDirection: "column",
            flex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 900,
                  letterSpacing: 4,
                  textTransform: "uppercase",
                  color: MUTED,
                  display: "flex",
                }}
              >
                Outright winner
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 38,
                  fontWeight: 900,
                  letterSpacing: -1.5,
                  color: TEXT,
                  lineHeight: 1,
                  display: "flex",
                }}
              >
                Rory McIlroy
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 16,
                  color: MUTED,
                  fontWeight: 700,
                  display: "flex",
                }}
              >
                @ +400 · stake £50
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
              }}
            >
              <div
                style={{
                  fontSize: 56,
                  fontWeight: 900,
                  letterSpacing: -2.5,
                  color: GREEN_BRIGHT,
                  lineHeight: 1,
                  display: "flex",
                }}
              >
                +35pp
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 20,
                  fontWeight: 800,
                  color: GREEN_BRIGHT,
                  display: "flex",
                }}
              >
                +£140
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  fontWeight: 900,
                  letterSpacing: 2.5,
                  textTransform: "uppercase",
                  color: MUTED,
                  display: "flex",
                }}
              >
                Now worth £190
              </div>
            </div>
          </div>

          {/* Chart — pre-rendered SVG as data URL for Satori compat */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={chartSrc}
            alt=""
            width={CHART_W}
            height={CHART_H}
            style={{ marginTop: 20 }}
          />
        </div>

        <div
          style={{
            marginTop: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: TEXT,
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
