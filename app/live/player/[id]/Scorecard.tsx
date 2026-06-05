"use client";

/**
 * Scorecard — four-round scorecard for the player page. Now driven
 * by real props (rounds + pars + per-hole field averages) so it
 * renders the actual player's strokes from the orchestrator, not the
 * old mock data. When a player hasn't played a round yet (status =
 * not-started), the round pill is disabled and the table shows par
 * only.
 *
 *   R1 R2 R3 R4
 *   ┌──────────────────────────────────────────────┐
 *   │ Hole  1 2 3 4 5 6 7 8 9 OUT 10 11 12 … 18 IN TOT │
 *   │ Par   4 4 3 5 4 4 3 4 5 36  4  3  4 …  4 36 72  │
 *   │ R3    ○ ─ ○ □ ─ ─ ─ ─ ○                          │
 *   │ SG   +0.5 ─0.1 …                                  │
 *   └──────────────────────────────────────────────┘
 *
 *   ○ under par   □ over par   ▣ eagle (emerald)   ▣ double+ (red)
 */

import { useState } from "react";

const FRONT = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const BACK = [9, 10, 11, 12, 13, 14, 15, 16, 17];

/** Strokes per hole for a round; null = not played yet. */
export type RoundStrokes = (number | null)[];

interface Props {
  /** 4 rounds, each an 18-entry array (strokes per hole, null when
   *  not yet played). Pass an array of 18 nulls for a round that
   *  hasn't started. */
  rounds: RoundStrokes[];
  /** Par per hole, length 18. */
  pars: number[];
  /** Optional per-hole field average — drives the SG cell shading.
   *  When absent, the SG row is hidden. */
  holeAvg?: number[];
  /** Defaults to the most recently started round (last non-null
   *  round, or 1 if none have started). */
  initialRound?: number;
}

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
  return `${n}`;
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
  const t = Math.max(-1, Math.min(1, sgValue / 1.3));
  if (Math.abs(t) < 0.04) return undefined;
  if (t > 0) {
    return { background: `oklch(0.62 0.16 150 / ${(t * 0.5).toFixed(2)})` };
  }
  return { background: `oklch(0.6 0.2 28 / ${(Math.abs(t) * 0.5).toFixed(2)})` };
}

function fmtSg(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

function roundHasData(round: RoundStrokes): boolean {
  return round.some((v) => v != null);
}

export default function Scorecard({ rounds, pars, holeAvg, initialRound }: Props) {
  // Default the open round to the latest one with data; otherwise R1.
  const latestWithData = (() => {
    for (let i = rounds.length - 1; i >= 0; i--) {
      if (roundHasData(rounds[i])) return i;
    }
    return 0;
  })();
  const [rd, setRd] = useState(initialRound ?? latestWithData);

  const round = rounds[rd] ?? new Array(18).fill(null);
  const hasData = roundHasData(round);

  // Numeric strokes array — for sums + cell rendering. Use NaN for
  // unplayed holes so sums skip them.
  const strokes: number[] = round.map((v) => (v == null ? NaN : v));
  const sg: number[] = holeAvg
    ? strokes.map((s, i) => (Number.isFinite(s) ? holeAvg[i] - s : NaN))
    : [];

  const parFront = sumAt(pars, FRONT);
  const parBack = sumAt(pars, BACK);
  const tpFront = FRONT.reduce(
    (acc, i) => acc + (Number.isFinite(strokes[i]) ? strokes[i] - pars[i] : 0),
    0,
  );
  const tpBack = BACK.reduce(
    (acc, i) => acc + (Number.isFinite(strokes[i]) ? strokes[i] - pars[i] : 0),
    0,
  );
  const sgFront = holeAvg
    ? FRONT.reduce((acc, i) => acc + (Number.isFinite(sg[i]) ? sg[i] : 0), 0)
    : 0;
  const sgBack = holeAvg
    ? BACK.reduce((acc, i) => acc + (Number.isFinite(sg[i]) ? sg[i] : 0), 0)
    : 0;

  return (
    <>
      <div className="sc-rdpills" role="tablist" aria-label="Round">
        {rounds.map((r, i) => {
          const has = roundHasData(r);
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={rd === i}
              className={rd === i ? "on" : ""}
              onClick={() => setRd(i)}
              disabled={!has}
              style={!has ? { opacity: 0.4 } : undefined}
            >
              R{i + 1}
            </button>
          );
        })}
      </div>
      <div className="scard">
        <table className="sctable">
          <thead>
            <tr>
              <th className="sctable-lbl">Hole</th>
              {FRONT.map((i) => (
                <th key={i} className={parClass(pars[i])}>
                  {i + 1}
                </th>
              ))}
              <th className="sctable-tot">OUT</th>
              {BACK.map((i) => (
                <th key={i} className={parClass(pars[i])}>
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
                <td key={i}>{pars[i]}</td>
              ))}
              <td className="sctable-tot">{parFront}</td>
              {BACK.map((i) => (
                <td key={i}>{pars[i]}</td>
              ))}
              <td className="sctable-tot">{parBack}</td>
              <td className="sctable-tot sctable-grand">{parFront + parBack}</td>
            </tr>
            <tr className="sctable-rdrow">
              <td className="sctable-lbl">R{rd + 1}</td>
              {FRONT.map((i) => {
                const s = strokes[i];
                if (!Number.isFinite(s)) return <td key={i}>—</td>;
                return (
                  <td key={i} className={scoreCellClass(s, pars[i])}>
                    <span className="sc-cell-v">{s}</span>
                  </td>
                );
              })}
              <td className="sctable-tot">{hasData ? fmtToPar(tpFront) : "—"}</td>
              {BACK.map((i) => {
                const s = strokes[i];
                if (!Number.isFinite(s)) return <td key={i}>—</td>;
                return (
                  <td key={i} className={scoreCellClass(s, pars[i])}>
                    <span className="sc-cell-v">{s}</span>
                  </td>
                );
              })}
              <td className="sctable-tot">{hasData ? fmtToPar(tpBack) : "—"}</td>
              <td className="sctable-tot sctable-grand">
                {hasData ? fmtToPar(tpFront + tpBack) : "—"}
              </td>
            </tr>
            {holeAvg && hasData && (
              <tr className="sctable-sgrow">
                <td className="sctable-lbl">SG</td>
                {FRONT.map((i) =>
                  Number.isFinite(sg[i]) ? (
                    <td key={i} style={sgCellStyle(sg[i])}>{fmtSg(sg[i])}</td>
                  ) : (
                    <td key={i}>—</td>
                  ),
                )}
                <td className="sctable-tot">{fmtSg(sgFront)}</td>
                {BACK.map((i) =>
                  Number.isFinite(sg[i]) ? (
                    <td key={i} style={sgCellStyle(sg[i])}>{fmtSg(sg[i])}</td>
                  ) : (
                    <td key={i}>—</td>
                  ),
                )}
                <td className="sctable-tot">{fmtSg(sgBack)}</td>
                <td className="sctable-tot sctable-grand">{fmtSg(sgFront + sgBack)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="sc-legend">
        <span>○ under par&nbsp;&nbsp;□ over par</span>
        {holeAvg && (
          <>
            <span>
              <i className="sc-legend-good" /> SG gained
            </span>
            <span>
              <i className="sc-legend-lost" /> SG lost
            </span>
          </>
        )}
      </div>
    </>
  );
}
