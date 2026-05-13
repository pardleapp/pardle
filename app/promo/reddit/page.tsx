/**
 * Reddit promo page — renders a mid-game Pros board with the player
 * names CSS-blurred so it shows the mechanic (cells, arrows, colors)
 * without giving away an answer. Open in a browser, screenshot, post.
 *
 * Path: /promo/reddit
 */

import { BRAND } from "@/lib/brand";

interface CellSpec {
  v: string;
  state: "green" | "warm" | "yellow" | "grey";
  arrow?: "up" | "down";
}

interface GuessSpec {
  name: string;
  flag: string;
  flagState: CellSpec["state"];
  age: CellSpec;
  height: CellSpec;
  majors: CellSpec;
  wins: CellSpec;
  ryderCup: CellSpec;
}

function flagFor(countryCode: string): string {
  const cc = countryCode.toUpperCase();
  if (cc.length !== 2) return "🏳️";
  return cc
    .split("")
    .map((c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
    .join("");
}

const GUESSES: GuessSpec[] = [
  {
    name: "Scottie Scheffler",
    flag: flagFor("US"),
    flagState: "grey",
    age: { v: "29", state: "grey", arrow: "up" },
    height: { v: "190", state: "grey", arrow: "down" },
    majors: { v: "4", state: "warm", arrow: "down" },
    wins: { v: "20", state: "yellow", arrow: "down" },
    ryderCup: { v: "3", state: "warm", arrow: "up" },
  },
  {
    name: "Xander Schauffele",
    flag: flagFor("US"),
    flagState: "grey",
    age: { v: "32", state: "yellow", arrow: "up" },
    height: { v: "178", state: "warm", arrow: "up" },
    majors: { v: "2", state: "warm", arrow: "up" },
    wins: { v: "10", state: "yellow", arrow: "up" },
    ryderCup: { v: "3", state: "warm", arrow: "up" },
  },
  {
    name: "Mike Weir",
    flag: flagFor("CA"),
    flagState: "grey",
    age: { v: "56", state: "grey", arrow: "down" },
    height: { v: "173", state: "yellow", arrow: "up" },
    majors: { v: "1", state: "warm", arrow: "up" },
    wins: { v: "8", state: "yellow", arrow: "up" },
    ryderCup: { v: "—", state: "grey", arrow: "up" },
  },
  {
    name: "Adam Scott",
    flag: flagFor("AU"),
    flagState: "grey",
    age: { v: "45", state: "grey", arrow: "down" },
    height: { v: "191", state: "grey", arrow: "down" },
    majors: { v: "1", state: "warm", arrow: "up" },
    wins: { v: "14", state: "green" },
    ryderCup: { v: "11", state: "grey", arrow: "down" },
  },
];

function Arrow({ a }: { a?: "up" | "down" }) {
  if (!a) return null;
  return <span className="arrow">{a === "up" ? "▲" : "▼"}</span>;
}

function Cell({ spec, isFlag = false }: { spec: CellSpec; isFlag?: boolean }) {
  return (
    <span className={`cell cell-${spec.state}`}>
      <span style={isFlag ? { fontSize: "22px" } : undefined}>{spec.v}</span>
      <Arrow a={spec.arrow} />
    </span>
  );
}

export default function PromoRedditPage() {
  return (
    <main className="container">
      <style>{`
        .promo-wrap {
          padding-top: 16px;
        }
        .promo-title {
          text-align: center;
          font-size: 40px;
          font-weight: 900;
          letter-spacing: -1px;
          margin: 8px 0 4px;
        }
        .promo-sub {
          text-align: center;
          font-size: 16px;
          color: var(--green);
          font-weight: 600;
          margin: 0 0 18px;
          letter-spacing: 0.5px;
        }
        .promo-footer {
          text-align: center;
          margin-top: 18px;
          font-size: 18px;
          font-weight: 700;
          color: var(--text);
        }
        .promo-footer-sub {
          text-align: center;
          font-size: 14px;
          color: #6b7066;
          margin-top: 4px;
        }
        /* THE KEY BIT — blur the player-name pills */
        .guess-name {
          filter: blur(7px);
          user-select: none;
          pointer-events: none;
        }
      `}</style>

      <div className="promo-wrap">
        <h1 className="promo-title">{BRAND.name}</h1>
        <p className="promo-sub">
          Wordle, but for golf pros — guess the mystery player in 6.
        </p>

        <div className="grid">
          <div className="header-row">
            <span>Country</span>
            <span>Age</span>
            <span>Height</span>
            <span>Majors</span>
            <span>Wins</span>
            <span>
              Ryder Cup
              <br />
              Appearances
            </span>
          </div>

          {GUESSES.map((g, i) => (
            <div key={i} className="guess">
              <div className="guess-name">{g.name}</div>
              <div className="guess-cells">
                <Cell spec={{ v: g.flag, state: g.flagState }} isFlag />
                <Cell spec={g.age} />
                <Cell spec={g.height} />
                <Cell spec={g.majors} />
                <Cell spec={g.wins} />
                <Cell spec={g.ryderCup} />
              </div>
            </div>
          ))}

          {Array.from({ length: 2 }).map((_, i) => (
            <div key={`empty-${i}`} className="guess empty-guess">
              <div className="guess-cells">
                {Array.from({ length: 6 }).map((_, j) => (
                  <span key={j} className="cell cell-empty" />
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="promo-footer">Today&apos;s is brutal.</p>
        <p className="promo-footer-sub">pardle.app · new puzzle daily</p>
      </div>
    </main>
  );
}
