import { ImageResponse } from "next/og";
import { cellColorFor } from "@/lib/share-card";

export const runtime = "edge";

// Reddit mobile feed performs best with square 1:1 images. 1080x1080
// is sharp on retina, compresses well, and crops cleanly to the feed
// thumbnail without losing the brand mark or the grid.

const SIZE = 1080;

type State = "G" | "W" | "Y" | "K";
type Arrow = "up" | "down" | null;
interface Cell {
  v: string;
  state: State;
  arrow: Arrow;
}
interface Guess {
  cells: Cell[];
}

// Three played guesses that illustrate the mechanic without spoiling
// today's answer. Country: text code only. Numbers: with up/down arrows
// that point toward the truth. Cells coloured per the live game:
//   G green  = exact match
//   W warm   = within 1
//   Y yellow = within 3 (or ±1 majors / ±3 wins, etc.)
//   K grey   = miss
const GUESSES: Guess[] = [
  // Guess 1 — cold start
  {
    cells: [
      { v: "USA", state: "K", arrow: null },
      { v: "28", state: "K", arrow: "up" },
      { v: "190", state: "K", arrow: "down" },
      { v: "0", state: "K", arrow: "up" },
      { v: "4", state: "K", arrow: "up" },
      { v: "0", state: "K", arrow: "up" },
    ],
  },
  // Guess 2 — closer
  {
    cells: [
      { v: "AUS", state: "K", arrow: null },
      { v: "34", state: "Y", arrow: "down" },
      { v: "178", state: "W", arrow: "down" },
      { v: "3", state: "Y", arrow: "up" },
      { v: "12", state: "Y", arrow: "down" },
      { v: "5", state: "W", arrow: "up" },
    ],
  },
  // Guess 3 — country green, age green, almost there
  {
    cells: [
      { v: "NIR", state: "G", arrow: null },
      { v: "32", state: "G", arrow: null },
      { v: "175", state: "W", arrow: "up" },
      { v: "5", state: "W", arrow: "up" },
      { v: "20", state: "Y", arrow: "down" },
      { v: "7", state: "W", arrow: "up" },
    ],
  },
];

const HEADERS = ["FLAG", "AGE", "HT", "MAJ", "WINS", "RC"];

function cellBg(state: State): string {
  return cellColorFor(state, "pros");
}

function ArrowGlyph({ arrow }: { arrow: Arrow }) {
  if (!arrow) return null;
  return (
    <span
      style={{
        display: "flex",
        fontSize: 24,
        marginLeft: 4,
        opacity: 0.9,
      }}
    >
      {arrow === "up" ? "▲" : "▼"}
    </span>
  );
}

function GuessRow({ guess }: { guess: Guess }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      {/* Redacted name pill */}
      <div
        style={{
          display: "flex",
          width: 220,
          height: 76,
          borderRadius: 12,
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.15)",
          alignItems: "center",
          justifyContent: "center",
          letterSpacing: 6,
          fontSize: 36,
          fontWeight: 800,
          color: "rgba(255,255,255,0.35)",
        }}
      >
        ▮▮▮▮▮
      </div>
      {guess.cells.map((c, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            width: 96,
            height: 76,
            borderRadius: 12,
            background: cellBg(c.state),
            color: "#0F1F0F",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: "-1px",
          }}
        >
          {c.v}
          <ArrowGlyph arrow={c.arrow} />
        </div>
      ))}
    </div>
  );
}

function EmptyRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          display: "flex",
          width: 220,
          height: 76,
          borderRadius: 12,
          background: "rgba(255,255,255,0.04)",
          border: "1px dashed rgba(255,255,255,0.15)",
        }}
      />
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            width: 96,
            height: 76,
            borderRadius: 12,
            background: "rgba(255,255,255,0.04)",
            border: "1px dashed rgba(255,255,255,0.15)",
          }}
        />
      ))}
    </div>
  );
}

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: SIZE,
          height: SIZE,
          background:
            "linear-gradient(135deg, #0F1F0F 0%, #1F3A1A 55%, #2c5a28 100%)",
          display: "flex",
          flexDirection: "column",
          padding: 56,
          color: "#FFFFFF",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Header: PARDLE wordmark + tagline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              display: "flex",
              fontSize: 80,
              fontWeight: 900,
              letterSpacing: "-3px",
              lineHeight: 1,
            }}
          >
            PARDLE
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              fontWeight: 600,
              color: "#7BAE3F",
              letterSpacing: "1px",
            }}
          >
            Wordle, but for golf pros — guess the mystery player in 6.
          </div>
        </div>

        {/* Column headers */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 36,
            paddingLeft: 4,
          }}
        >
          <div style={{ display: "flex", width: 220 }} />
          {HEADERS.map((h, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: 96,
                justifyContent: "center",
                fontSize: 22,
                fontWeight: 700,
                color: "rgba(255,255,255,0.55)",
                letterSpacing: 1,
              }}
            >
              {h}
            </div>
          ))}
        </div>

        {/* Guess grid (3 played + 3 empty so reader sees the 6-guess shape) */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginTop: 10,
          }}
        >
          {GUESSES.map((g, i) => (
            <GuessRow key={i} guess={g} />
          ))}
          {Array.from({ length: 3 }).map((_, i) => (
            <EmptyRow key={`empty-${i}`} />
          ))}
        </div>

        {/* Footer: bold "brutal" line + URL */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginTop: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 76,
              fontWeight: 900,
              letterSpacing: "-2px",
              color: "#FFD64A",
              lineHeight: 1,
            }}
          >
            Today&apos;s is brutal.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 32,
              fontWeight: 700,
              color: "#FFFFFF",
              opacity: 0.85,
              letterSpacing: 1,
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
