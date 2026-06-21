import { ImageResponse } from "next/og";

/**
 * Open Graph card rendered for the root URL.
 *
 * Shows what the live bet-detail page actually delivers: a tracked
 * outright with a dramatic intraday swing chart annotated PEAK /
 * LOW / ENTRY pins, a "now" callout tooltip, gridlines and a slim
 * Now / Peak / Low / Biggest-swing stats strip beneath. The card is
 * the elevator pitch — "we don't just store your bet, we narrate it
 * shot by shot" — so a stranger seeing this link in a group chat
 * gets the product in one glance.
 *
 * Satori (next/og) can't compute oklch() so the pv-theme tokens are
 * hard-coded here as their sRGB approximations.
 */

export const runtime = "edge";
export const revalidate = 3600;
export const alt =
  "Pardle — track your golf bets, watch every shot move the needle";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// pv-theme tokens, baked from oklch → sRGB.
const PAPER = "#fbf7eb";
const CARD = "#fdfbf3";
const SOFT = "#ede9d8";
const LINE = "#d8d3c1";
const INK = "#1a2f23";
const MUTED = "#67756d";
const EMERALD = "#2f8552";
const EMERALD_D = "#226a3f";
const EMERALD_TINT = "rgba(47, 133, 82, 0.16)";
const DOWN = "#bc4736";
const DOWN_TINT = "rgba(188, 71, 54, 0.14)";
const TANG = "#d36a2e";

// Intraday R1 trajectory. Story arc: solid entry (28%), early climb
// to 35 by hole 4, brutal bogey drop to 18 (biggest swing), slow
// recovery, hot finish into the cut peaking at 56, settling at 47.
// Shape matters — flat lines don't sell "real-time".
const POINTS: [number, number][] = [
  [0, 28], // entry
  [1, 30],
  [2, 32],
  [3, 33],
  [4, 35], // pre-bogey high
  [5, 26],
  [6, 18], // bogey low
  [7, 22],
  [8, 26],
  [9, 30], // back to baseline
  [10, 34],
  [11, 41],
  [12, 47],
  [13, 52],
  [14, 56], // peak
  [15, 51],
  [16, 47], // now
];

const ENTRY_IDX = 0;
const PEAK_IDX = 14;
const LOW_IDX = 6;
const NOW_IDX = POINTS.length - 1;

const CHART_W = 1080;
const CHART_H = 230;
const PAD = { top: 26, right: 28, bottom: 26, left: 60 };
const X_MIN = 0;
const X_MAX = 16;
const Y_MIN = 0;
const Y_MAX = 65;

// Hole tick labels along the bottom axis — R1 holes the user has
// been on while the bet ran (purely visual; real charts use times).
const HOLE_LABELS: Array<[number, string]> = [
  [0, "H1"],
  [4, "H5"],
  [8, "H9"],
  [12, "H13"],
  [16, "H17"],
];

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
  const entryY = yToPx(POINTS[ENTRY_IDX][1]);
  const peakX = xToPx(POINTS[PEAK_IDX][0]);
  const peakY = yToPx(POINTS[PEAK_IDX][1]);
  const lowX = xToPx(POINTS[LOW_IDX][0]);
  const lowY = yToPx(POINTS[LOW_IDX][1]);

  const areaPath = `M${firstX.toFixed(1)},${baseY.toFixed(1)} ${POINTS.map(
    ([x, y]) => `L${xToPx(x).toFixed(1)},${yToPx(y).toFixed(1)}`,
  ).join(" ")} L${lastX.toFixed(1)},${baseY.toFixed(1)} Z`;

  // Y-axis gridline values — three horizontal lines + labels.
  const yTicks = [50, 25, 0];
  const yTickLines = yTicks
    .map(
      (v) =>
        `<line x1="${PAD.left}" x2="${CHART_W - PAD.right}" y1="${yToPx(v).toFixed(1)}" y2="${yToPx(v).toFixed(1)}" stroke="${LINE}" stroke-width="1" ${v === 0 ? 'stroke-dasharray="3 4"' : ""}/>`,
    )
    .join("");
  const yTickLabels = yTicks
    .map(
      (v) =>
        `<text x="${PAD.left - 12}" y="${(yToPx(v) + 5).toFixed(1)}" font-size="14" font-weight="700" fill="${MUTED}" text-anchor="end" font-family="monospace">${v}%</text>`,
    )
    .join("");

  // X-axis hole ticks along the bottom.
  const xTickLabels = HOLE_LABELS.map(
    ([x, label]) =>
      `<text x="${xToPx(x).toFixed(1)}" y="${(CHART_H - 8).toFixed(1)}" font-size="13" font-weight="700" fill="${MUTED}" text-anchor="middle" font-family="monospace">${label}</text>`,
  ).join("");

  // Per-shot markers — small dots so the chart reads as "each point
  // is a shot," not a smooth abstract curve.
  const shotDots = POINTS.map(
    ([x, y]) =>
      `<circle cx="${xToPx(x).toFixed(1)}" cy="${yToPx(y).toFixed(1)}" r="2.6" fill="${EMERALD}" opacity="0.85"/>`,
  ).join("");

  // ENTRY pin — sits at the entry point on the LEFT, label points
  // right toward the curve.
  const entryPin = `
    <g>
      <line x1="${(firstX - 4).toFixed(1)}" x2="${(firstX + 4).toFixed(1)}" y1="${entryY.toFixed(1)}" y2="${entryY.toFixed(1)}" stroke="${INK}" stroke-width="1.6" stroke-dasharray="2 2"/>
      <rect x="${(firstX + 6).toFixed(1)}" y="${(entryY - 12).toFixed(1)}" width="84" height="22" rx="5" fill="${INK}"/>
      <text x="${(firstX + 48).toFixed(1)}" y="${(entryY + 3).toFixed(1)}" font-size="11" font-weight="900" fill="#fff" text-anchor="middle" font-family="monospace" letter-spacing="0.5">ENTRY 28%</text>
    </g>`;

  // PEAK pin — emerald, anchored ABOVE the peak point, leader dot.
  const peakPinY = peakY - 28;
  const peakPin = `
    <g>
      <line x1="${peakX.toFixed(1)}" x2="${peakX.toFixed(1)}" y1="${(peakY - 6).toFixed(1)}" y2="${(peakPinY + 16).toFixed(1)}" stroke="${EMERALD}" stroke-width="1.6"/>
      <circle cx="${peakX.toFixed(1)}" cy="${peakY.toFixed(1)}" r="5.5" fill="#fff" stroke="${EMERALD}" stroke-width="2.4"/>
      <rect x="${(peakX - 56).toFixed(1)}" y="${(peakPinY - 4).toFixed(1)}" width="112" height="22" rx="5" fill="${EMERALD}"/>
      <text x="${peakX.toFixed(1)}" y="${(peakPinY + 11).toFixed(1)}" font-size="11" font-weight="900" fill="#fff" text-anchor="middle" font-family="monospace" letter-spacing="0.5">PEAK 56% · H15</text>
    </g>`;

  // LOW pin — red, anchored BELOW the low point.
  const lowPinY = lowY + 28;
  const lowPin = `
    <g>
      <line x1="${lowX.toFixed(1)}" x2="${lowX.toFixed(1)}" y1="${(lowY + 6).toFixed(1)}" y2="${(lowPinY - 16).toFixed(1)}" stroke="${DOWN}" stroke-width="1.6"/>
      <circle cx="${lowX.toFixed(1)}" cy="${lowY.toFixed(1)}" r="5.5" fill="#fff" stroke="${DOWN}" stroke-width="2.4"/>
      <rect x="${(lowX - 52).toFixed(1)}" y="${(lowPinY - 4).toFixed(1)}" width="104" height="22" rx="5" fill="${DOWN}"/>
      <text x="${lowX.toFixed(1)}" y="${(lowPinY + 11).toFixed(1)}" font-size="11" font-weight="900" fill="#fff" text-anchor="middle" font-family="monospace" letter-spacing="0.5">LOW 18% · H7</text>
    </g>`;

  // "Biggest swing" highlight — emphasise the 4→6 segment that drops
  // from 35 to 18 (the −17pp shock that any bettor would screenshot).
  const swingFromX = xToPx(POINTS[4][0]);
  const swingFromY = yToPx(POINTS[4][1]);
  const swingToX = xToPx(POINTS[6][0]);
  const swingToY = yToPx(POINTS[6][1]);
  const swingPath = `M${swingFromX.toFixed(1)},${swingFromY.toFixed(1)} L${xToPx(POINTS[5][0]).toFixed(1)},${yToPx(POINTS[5][1]).toFixed(1)} L${swingToX.toFixed(1)},${swingToY.toFixed(1)}`;
  const swingHighlight = `
    <path d="${swingPath}" stroke="${DOWN}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>`;

  // "Now" callout — tooltip card to the LEFT of the latest point so
  // it doesn't get clipped by the chart's right edge. Mirrors the
  // live ChartCallout shape: dark surface, percentage, sub-line.
  const calloutW = 130;
  const calloutH = 56;
  const calloutX = lastX - calloutW - 12;
  const calloutY = lastY - calloutH - 14;
  const callout = `
    <g>
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="11" fill="${EMERALD}" opacity="0.2"/>
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="6" fill="#fff" stroke="${EMERALD}" stroke-width="2.6"/>
      <rect x="${calloutX.toFixed(1)}" y="${calloutY.toFixed(1)}" width="${calloutW}" height="${calloutH}" rx="6" fill="${INK}"/>
      <text x="${(calloutX + 12).toFixed(1)}" y="${(calloutY + 19).toFixed(1)}" font-size="11" font-weight="900" fill="rgba(255,255,255,0.6)" font-family="monospace" letter-spacing="0.6">NOW · H17</text>
      <text x="${(calloutX + 12).toFixed(1)}" y="${(calloutY + 38).toFixed(1)}" font-size="20" font-weight="900" fill="#fff" font-family="monospace" letter-spacing="-0.5">47% win</text>
      <text x="${(calloutX + 12).toFixed(1)}" y="${(calloutY + 51).toFixed(1)}" font-size="10" font-weight="800" fill="${EMERALD}" font-family="monospace" letter-spacing="0.4">+£140 · +19pp today</text>
    </g>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_W}" height="${CHART_H}" viewBox="0 0 ${CHART_W} ${CHART_H}">${yTickLines}${yTickLabels}${xTickLabels}<path d="${areaPath}" fill="${EMERALD_TINT}"/><path d="${linePath}" stroke="${EMERALD}" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>${swingHighlight}${shotDots}${entryPin}${peakPin}${lowPin}${callout}</svg>`;
  // base64 encoding is the reliable path for Satori — encodeURIComponent
  // produces a long URL with %-escapes that resvg sometimes truncates
  // or rejects on edge runtimes. Buffer is available on Vercel edge.
  const b64 = Buffer.from(svg, "utf-8").toString("base64");
  return `data:image/svg+xml;base64,${b64}`;
}

interface MiniStat {
  label: string;
  value: string;
  sub: string;
  tone: "up" | "down" | "muted";
}

const STATS: MiniStat[] = [
  { label: "Now", value: "47%", sub: "+£140 · H17", tone: "up" },
  { label: "Peak", value: "56%", sub: "H15 · +£220", tone: "up" },
  { label: "Low", value: "18%", sub: "H7 · −£74", tone: "down" },
  { label: "Biggest swing", value: "−17pp", sub: "H5→H7 bogey", tone: "down" },
];

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
          padding: "28px 36px 24px",
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
              fontSize: 52,
              fontWeight: 900,
              letterSpacing: -1.6,
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
              padding: "6px 14px",
              background: EMERALD,
              borderRadius: 999,
              color: "#fff",
              fontWeight: 900,
              fontSize: 13,
              letterSpacing: 2.2,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#fff",
                marginRight: 7,
              }}
            />
            LIVE · 1.2K WATCHING
          </div>
        </div>

        {/* Bet card */}
        <div
          style={{
            marginTop: 18,
            background: CARD,
            border: `1px solid ${LINE}`,
            borderRadius: 18,
            display: "flex",
            flexDirection: "column",
            flex: 1,
            overflow: "hidden",
          }}
        >
          {/* Header row — stripe / market+name / hero delta */}
          <div style={{ display: "flex", alignItems: "stretch" }}>
            <div style={{ width: 5, background: EMERALD, display: "flex" }} />
            <div
              style={{
                flex: 1,
                padding: "14px 22px",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 900,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  color: MUTED,
                  display: "flex",
                }}
              >
                Outright winner · U.S. Open R1
              </div>
              <div
                style={{
                  marginTop: 3,
                  fontSize: 32,
                  fontWeight: 900,
                  letterSpacing: -1.2,
                  color: INK,
                  lineHeight: 1.05,
                  display: "flex",
                }}
              >
                Rory McIlroy
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  color: MUTED,
                  fontWeight: 700,
                  display: "flex",
                  fontFamily: "monospace",
                }}
              >
                @ +400 · stake £50 · placed Thu 09:14
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                justifyContent: "center",
                padding: "14px 22px 14px 0",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 900,
                  letterSpacing: 2.8,
                  textTransform: "uppercase",
                  color: EMERALD_D,
                  display: "flex",
                  background: EMERALD_TINT,
                  padding: "3px 8px",
                  borderRadius: 5,
                }}
              >
                Winning
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 50,
                  fontWeight: 900,
                  letterSpacing: -2.2,
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
                  marginTop: 4,
                  fontSize: 12,
                  fontWeight: 800,
                  color: MUTED,
                  display: "flex",
                  fontFamily: "monospace",
                }}
              >
                Now worth £190 · +280%
              </div>
            </div>
          </div>

          {/* Chart band */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              padding: "0 22px 4px",
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 900,
                color: INK,
                letterSpacing: -0.2,
                display: "flex",
              }}
            >
              Win probability · live
            </div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: MUTED,
                letterSpacing: 0.4,
                display: "flex",
                fontFamily: "monospace",
              }}
            >
              17 shots tracked
            </div>
          </div>
          <div style={{ padding: "0 14px", display: "flex" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={chartSrc} alt="" width={CHART_W} height={CHART_H} />
          </div>

          {/* Slim 4-stat strip — same shape as the live BetChartFull
              expanded view: Now / Peak / Low / Biggest swing. */}
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "0 14px 12px",
            }}
          >
            {STATS.map((s) => {
              const valColor =
                s.tone === "up" ? EMERALD : s.tone === "down" ? DOWN : INK;
              const bgTint =
                s.tone === "up"
                  ? EMERALD_TINT
                  : s.tone === "down"
                    ? DOWN_TINT
                    : SOFT;
              return (
                <div
                  key={s.label}
                  style={{
                    flex: 1,
                    background: bgTint,
                    border: `1px solid ${LINE}`,
                    borderRadius: 10,
                    padding: "8px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                  }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 900,
                      letterSpacing: 1.6,
                      textTransform: "uppercase",
                      color: MUTED,
                      display: "flex",
                    }}
                  >
                    {s.label}
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 900,
                      color: valColor,
                      fontFamily: "monospace",
                      letterSpacing: -0.6,
                      lineHeight: 1.1,
                      display: "flex",
                    }}
                  >
                    {s.value}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: MUTED,
                      fontFamily: "monospace",
                      display: "flex",
                    }}
                  >
                    {s.sub}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer row — URL + tagline */}
        <div
          style={{
            marginTop: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 900,
              color: INK,
              letterSpacing: -0.4,
              display: "flex",
            }}
          >
            pardle.app
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: MUTED,
              letterSpacing: 2.8,
              textTransform: "uppercase",
              display: "flex",
            }}
          >
            Bet tracker · Shot by shot · Real time
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
