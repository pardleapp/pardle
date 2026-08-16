/**
 * OddsComparePreview — mini table mock showing three player rows
 * with over/under pills across four bookmaker columns. One pill
 * per side is bordered emerald to hint at the "best price"
 * highlight the live tool uses. Static SVG; deterministic across
 * viewports.
 */

const W = 300;
const H = 130;

// Three player rows × four book columns. Best over/under per row
// gets bordered emerald in the live tool; we mirror that here so
// the illustration visually signals "cross-book compare".
interface Row {
  player: string;
  line: string;
  cells: Array<{ over: string; under: string; bestO: boolean; bestU: boolean }>;
}

const ROWS: Row[] = [
  {
    player: "Scheffler",
    line: "68.5",
    cells: [
      { over: "-125", under: "+105", bestO: false, bestU: false },
      { over: "-118", under: "+108", bestO: true, bestU: false },
      { over: "-120", under: "+110", bestO: false, bestU: true },
      { over: "-130", under: "+100", bestO: false, bestU: false },
    ],
  },
  {
    player: "McIlroy",
    line: "69.5",
    cells: [
      { over: "+100", under: "-125", bestO: false, bestU: false },
      { over: "+102", under: "-128", bestO: false, bestU: false },
      { over: "+108", under: "-135", bestO: true, bestU: false },
      { over: "-102", under: "-120", bestO: false, bestU: true },
    ],
  },
  {
    player: "Spieth",
    line: "70.5",
    cells: [
      { over: "-138", under: "+112", bestO: false, bestU: false },
      { over: "-140", under: "+115", bestO: false, bestU: true },
      { over: "-135", under: "+105", bestO: true, bestU: false },
      { over: "-142", under: "+110", bestO: false, bestU: false },
    ],
  },
];

const BOOKS = ["DK", "FD", "CZ", "MGM"];

const INK = "oklch(0.26 0.04 155)";
const MUTED = "oklch(0.55 0.02 150)";
const SOFT = "oklch(0.94 0.008 95)";
const LINE = "oklch(0.90 0.013 95)";
const EMERALD = "oklch(0.50 0.13 155)";
const EMERALD_TINT = "oklch(0.96 0.04 155)";
const EMERALD_DEEP = "oklch(0.38 0.13 156)";

export default function OddsComparePreview() {
  const padL = 14;
  const padR = 14;
  const padT = 18;
  const headerH = 14;
  const rowH = ((H - padT - headerH - 8) / ROWS.length) | 0;
  const bookColW = (W - padL - padR - 70) / BOOKS.length;
  const rowLabelW = 70;
  return (
    <div
      aria-hidden
      style={{
        width: "100%",
        aspectRatio: "16/9",
        background:
          "linear-gradient(180deg, oklch(0.98 0.005 95) 0%, oklch(0.96 0.008 155) 100%)",
        borderRadius: "10px 10px 0 0",
        overflow: "hidden",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Book column headers */}
        {BOOKS.map((b, i) => {
          const x = padL + rowLabelW + i * bookColW + bookColW / 2;
          return (
            <text
              key={b}
              x={x}
              y={padT}
              textAnchor="middle"
              fontSize={9}
              fontWeight={800}
              fill={MUTED}
              letterSpacing={0.3}
              style={{ fontFamily: "'Archivo', sans-serif" }}
            >
              {b}
            </text>
          );
        })}
        {/* Rows */}
        {ROWS.map((row, ri) => {
          const y = padT + headerH + ri * rowH;
          const midY = y + rowH / 2;
          const rowBg = ri % 2 === 0 ? "white" : SOFT;
          return (
            <g key={row.player}>
              <rect
                x={padL - 4}
                y={y}
                width={W - padL - padR + 8}
                height={rowH - 2}
                fill={rowBg}
                rx={2}
              />
              {/* Player name + line */}
              <text
                x={padL}
                y={midY + 3}
                fontSize={10}
                fontWeight={800}
                fill={INK}
                style={{ fontFamily: "'Archivo', sans-serif" }}
              >
                {row.player}
              </text>
              <text
                x={padL + 44}
                y={midY + 3}
                fontSize={9}
                fontWeight={700}
                fill={MUTED}
                style={{ fontFamily: "'IBM Plex Mono', ui-monospace, monospace" }}
              >
                {row.line}
              </text>
              {/* Book cells */}
              {row.cells.map((cell, ci) => {
                const cx = padL + rowLabelW + ci * bookColW;
                const cw = bookColW - 4;
                const pillW = (cw - 3) / 2;
                const pillH = rowH - 8;
                const pillY = y + 4;
                return (
                  <g key={ci}>
                    {/* Over pill */}
                    <rect
                      x={cx}
                      y={pillY}
                      width={pillW}
                      height={pillH}
                      rx={2}
                      fill={cell.bestO ? EMERALD_TINT : "white"}
                      stroke={cell.bestO ? EMERALD : LINE}
                      strokeWidth={cell.bestO ? 1.2 : 0.6}
                    />
                    <text
                      x={cx + pillW / 2}
                      y={pillY + pillH / 2 + 2.5}
                      textAnchor="middle"
                      fontSize={8.5}
                      fontWeight={cell.bestO ? 800 : 700}
                      fill={cell.bestO ? EMERALD_DEEP : INK}
                      style={{ fontFamily: "'IBM Plex Mono', ui-monospace, monospace" }}
                    >
                      {cell.over}
                    </text>
                    {/* Under pill */}
                    <rect
                      x={cx + pillW + 2}
                      y={pillY}
                      width={pillW}
                      height={pillH}
                      rx={2}
                      fill={cell.bestU ? EMERALD_TINT : "white"}
                      stroke={cell.bestU ? EMERALD : LINE}
                      strokeWidth={cell.bestU ? 1.2 : 0.6}
                    />
                    <text
                      x={cx + pillW + 2 + pillW / 2}
                      y={pillY + pillH / 2 + 2.5}
                      textAnchor="middle"
                      fontSize={8.5}
                      fontWeight={cell.bestU ? 800 : 700}
                      fill={cell.bestU ? EMERALD_DEEP : INK}
                      style={{ fontFamily: "'IBM Plex Mono', ui-monospace, monospace" }}
                    >
                      {cell.under}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
