"use client";

/**
 * EventDetail — Recent-form drill-down. Opens over the player page
 * when a form row is tapped; shows the four round scores, the
 * event's 4-bucket SG split, and a "what happened" note.
 *
 * Matches the prototype's <EventDetail>:
 *
 *   ← Travelers
 *     R. Henley · 2025 · finished T4
 *
 *   ROUNDS
 *     R1 R2 R3 R4
 *     66 68 67 69
 *
 *   STROKES GAINED · EVENT
 *     +6.2          (header in green / red)
 *     SG total · Approach +3.1 · Putting +1.8
 *
 *     Off the tee   [bar]   +1.9
 *     Approach      [bar]   +2.5
 *     Around green  [bar]   +0.6
 *     Putting       [bar]   +1.9
 *
 *   WHAT HAPPENED
 *     In the mix all week; a closing 69 left him a shot outside the playoff.
 *
 * Negatives use Unicode minus; pf() in mock-player-data.ts handles
 * the conversion before any arithmetic.
 */

import type { PlayerFormEvent } from "./mock-player-data";
import { pf } from "./mock-player-data";
import { useDismissibleOverlay } from "@/app/_hooks/useDismissibleOverlay";

interface Props {
  ev: PlayerFormEvent;
  playerName: string;
  onClose: () => void;
}

/** Centred SG bar — 50% origin, expands left for negative, right for
 *  positive. Maxes out at ±3 strokes. */
function sgBarStyle(value: number): React.CSSProperties {
  const w = Math.min(Math.abs(value) / 3, 1) * 50;
  if (value < 0) {
    return { left: `${50 - w}%`, width: `${w}%` };
  }
  return { left: "50%", width: `${w}%` };
}

/** Split a total SG into the 4 buckets — proxy for the prototype's
 *  splitSg(); deterministic by event title length so each event
 *  gets a consistent breakdown. */
function splitSg(total: string, seed: number): number[] {
  const t = pf(total);
  const weights = [
    [0.3, 0.4, 0.1, 0.2],
    [0.22, 0.3, 0.18, 0.3],
    [0.35, 0.22, 0.18, 0.25],
  ][seed % 3];
  return weights.map((x) => t * x);
}

const BUCKETS = ["Off the tee", "Approach", "Around green", "Putting"];

export default function EventDetail({ ev, playerName, onClose }: Props) {
  useDismissibleOverlay(true, onClose);
  const totalNum = pf(ev.sgTotal);
  const totalNeg = totalNum < 0;
  const split = splitSg(ev.sgTotal, ev.t.length);
  return (
    <div className="pl-event" role="dialog" aria-label={`${ev.t} — event detail`}>
      <div className="pl-event-head">
        <button
          type="button"
          className="bd-pv-back"
          onClick={onClose}
          aria-label="Back to player"
        >
          ←
        </button>
        <div className="bd-pv-title">
          <div className="bd-pv-title-nm">{ev.t}</div>
          <div className="bd-pv-title-mk">
            {playerName} · {ev.season} · finished {ev.fin}
          </div>
        </div>
      </div>
      <div className="pl-event-body">
        <section className="bd-sec" style={{ borderTop: "none" }}>
          <h4 className="bd-sec-h">Rounds</h4>
          <div className="ev-rounds">
            {ev.rds.map((r, i) => (
              <div className="ev-rd" key={i}>
                <div className="ev-rd-lbl">R{i + 1}</div>
                <div className="ev-rd-val">{r}</div>
              </div>
            ))}
            {ev.rds.length < 4 && (
              <div className="ev-rd ev-rd-cut">
                <div className="ev-rd-lbl">CUT</div>
                <div className="ev-rd-val">—</div>
              </div>
            )}
          </div>
        </section>

        <section className="bd-sec">
          <h4 className="bd-sec-h">Strokes gained · event</h4>
          <div className="pl-livesg">
            <div className="pl-livesg-top">
              <span
                className="pl-livesg-num"
                style={{ color: totalNeg ? "var(--pv-down)" : "var(--pv-up)" }}
              >
                {ev.sgTotal}
              </span>
              <span className="pl-livesg-meta">
                SG total · {ev.keystat}
              </span>
            </div>
          </div>
          <div className="pl-sg-cats">
            {split.map((v, i) => (
              <div className="sgrow" key={i}>
                <span className="sgrow-lbl">{BUCKETS[i]}</span>
                <span className="sgrow-track">
                  <i
                    className={v < 0 ? "sgrow-bar sgrow-bar-neg" : "sgrow-bar"}
                    style={sgBarStyle(v)}
                  />
                </span>
                <span
                  className="sgrow-val"
                  style={{ color: v < 0 ? "var(--pv-down)" : "var(--pv-up)" }}
                >
                  {(v >= 0 ? "+" : "") + v.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="bd-sec">
          <h4 className="bd-sec-h">What happened</h4>
          <p className="pl-event-note">{ev.note}</p>
        </section>
      </div>
    </div>
  );
}
