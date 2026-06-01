"use client";

/**
 * Scorecard — DataGolf-style four-round scorecard for the player
 * page. Matches the design-handoff prototype's <Scorecard>:
 *
 *   R1 R2 R3 R4
 *   ┌──────────────────────────────────────────────┐
 *   │ Hole  1 2 3 4 5 6 7 8 9 OUT 10 11 12 … 18 IN TOT │
 *   │ Par   4 4 3 5 4 4 3 4 5 36  4  3  4 …  4 36 72  │
 *   │ R3    ○ ─ ○ □ ─ ─ ─ ─ ○                          │
 *   │ SG   +0.5 ─0.1 …                                  │
 *   └──────────────────────────────────────────────┘
 *
 *   ○ under par
 *   □ over par
 *   ▣ eagle (filled emerald)
 *   ▣ double+ (filled red)
 *
 * SG cells are colored by score-vs-field-average for that hole
 * (not vs par), so a par on a hole averaging 4.2 reads positive.
 */

import { useState } from "react";
import { PAR, HOLE_AVG, SC_ROUNDS } from "./mock-player-data";

const FRONT = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const BACK = [9, 10, 11, 12, 13, 14, 15, 16, 17];

function sumAt(arr: number[], idxs: number[]): number {
  return idxs.reduce((acc, i) => acc + arr[i], 0);
}

function parClass(par: number): string {
  if (par === 3) return "pc-par3";
  if (par === 5) return "pc-par5";
  return "pc-par4";
}

function fmtToPar(n: number): string {
  if (n === 0) return "E";
  if (n > 0) return `+${n}`;
  return `${n}`; // already has minus
}

function scoreCellClass(score: number, par: number): string {
  const d = score - par;
  if (d <= -2) return "sc-cell sc-cell-eagle";
  if (d === -1) return "sc-cell sc-cell-under";
  if (d === 1) return "sc-cell sc-cell-over";
  if (d >= 2) return "sc-cell sc-cell-dbl";
  return "sc-cell";
}

function sgCellStyle(sgValue: number): React.CSSProperties | undefined {
  // sg = HOLE_AVG - score; positive means player beat the field.
  const t = Math.max(-1, Math.min(1, sgValue / 1.3));
  if (Math.abs(t) < 0.04) return undefined;
  if (t > 0) {
    return {
      background: `oklch(0.62 0.16 150 / ${(t * 0.5).toFixed(2)})`,
    };
  }
  return {
    background: `oklch(0.6 0.2 28 / ${(Math.abs(t) * 0.5).toFixed(2)})`,
  };
}

function fmtSg(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

export default function Scorecard() {
  const [rd, setRd] = useState(3);
  const round = SC_ROUNDS[rd];
  const sg = round.map((s, i) => HOLE_AVG[i] - s);

  const parFront = sumAt(PAR, FRONT);
  const parBack = sumAt(PAR, BACK);
  const tpFront = sumAt(round, FRONT) - parFront;
  const tpBack = sumAt(round, BACK) - parBack;
  const sgFront = sumAt(sg, FRONT);
  const sgBack = sumAt(sg, BACK);

  return (
    <>
      <div className="sc-rdpills" role="tablist" aria-label="Round">
        {[0, 1, 2, 3].map((i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={rd === i}
            className={rd === i ? "on" : ""}
            onClick={() => setRd(i)}
          >
            R{i + 1}
          </button>
        ))}
      </div>
      <div className="scard">
        <table className="sctable">
          <thead>
            <tr>
              <th className="sctable-lbl">Hole</th>
              {FRONT.map((i) => (
                <th key={i} className={parClass(PAR[i])}>
                  {i + 1}
                </th>
              ))}
              <th className="sctable-tot">OUT</th>
              {BACK.map((i) => (
                <th key={i} className={parClass(PAR[i])}>
                  {i + 1}
                </th>
              ))}
              <th className="sctable-tot">IN</th>
              <th className="sctable-tot sctable-grand">TOT</th>
            </tr>
          </thead>
          <tbody>
            <tr className="sctable-parrow">
              <td className="sctable-lbl">Par</td>
              {FRONT.map((i) => (
                <td key={i}>{PAR[i]}</td>
              ))}
              <td className="sctable-tot">{parFront}</td>
              {BACK.map((i) => (
                <td key={i}>{PAR[i]}</td>
              ))}
              <td className="sctable-tot">{parBack}</td>
              <td className="sctable-tot sctable-grand">
                {parFront + parBack}
              </td>
            </tr>
            <tr className="sctable-rdrow">
              <td className="sctable-lbl">R{rd + 1}</td>
              {FRONT.map((i) => (
                <td key={i} className={scoreCellClass(round[i], PAR[i])}>
                  <span className="sc-cell-v">{round[i]}</span>
                </td>
              ))}
              <td className="sctable-tot">{fmtToPar(tpFront)}</td>
              {BACK.map((i) => (
                <td key={i} className={scoreCellClass(round[i], PAR[i])}>
                  <span className="sc-cell-v">{round[i]}</span>
                </td>
              ))}
              <td className="sctable-tot">{fmtToPar(tpBack)}</td>
              <td className="sctable-tot sctable-grand">
                {fmtToPar(tpFront + tpBack)}
              </td>
            </tr>
            <tr className="sctable-sgrow">
              <td className="sctable-lbl">SG</td>
              {FRONT.map((i) => (
                <td key={i} style={sgCellStyle(sg[i])}>
                  {fmtSg(sg[i])}
                </td>
              ))}
              <td className="sctable-tot">{fmtSg(sgFront)}</td>
              {BACK.map((i) => (
                <td key={i} style={sgCellStyle(sg[i])}>
                  {fmtSg(sg[i])}
                </td>
              ))}
              <td className="sctable-tot">{fmtSg(sgBack)}</td>
              <td className="sctable-tot sctable-grand">
                {fmtSg(sgFront + sgBack)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="sc-legend">
        <span>○ under par&nbsp;&nbsp;□ over par</span>
        <span>
          <i className="sc-legend-good" /> SG gained
        </span>
        <span>
          <i className="sc-legend-lost" /> SG lost
        </span>
      </div>
    </>
  );
}
