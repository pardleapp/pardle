"use client";

/**
 * Inline scorecard expansion for a leaderboard row. Lazy-loads on
 * mount, renders four blocks:
 *
 *   1. Round trajectory — 4 chips (R1–R4) each showing toPar.
 *   2. Live/last round's 18-hole strip — par-coloured cells with
 *      front-9 / back-9 splits.
 *   3. Tournament tallies — birdies / eagles / bogeys / doubles +
 *      best round and scoring avg.
 *   4. "View full profile →" link to the dedicated player page.
 *
 * Caching: per-playerId in-memory so re-opening the same row inside
 * one session reuses the response. Refreshes from the network on
 * re-mount (i.e., navigating away + back).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PlayerCardResponse } from "@/app/api/leaderboard/player-card/[id]/route";

interface Props {
  playerId: string;
}

const cache = new Map<string, PlayerCardResponse>();

function fmtToPar(t: number | null): string {
  if (t == null) return "—";
  if (t === 0) return "E";
  return t > 0 ? `+${t}` : String(t);
}

function cellClass(par: number, score: number | null): string {
  if (score == null) return "pcell pcell-empty";
  const diff = score - par;
  if (diff <= -2) return "pcell pcell-eagle";
  if (diff === -1) return "pcell pcell-birdie";
  if (diff === 0) return "pcell pcell-par";
  if (diff === 1) return "pcell pcell-bogey";
  return "pcell pcell-double";
}

function roundChipClass(toPar: number | null): string {
  if (toPar == null) return "lb-round-chip lb-round-chip-empty";
  if (toPar < 0) return "lb-round-chip lb-round-chip-under";
  if (toPar === 0) return "lb-round-chip lb-round-chip-even";
  return "lb-round-chip lb-round-chip-over";
}

export default function PlayerCardPanel({ playerId }: Props) {
  const [data, setData] = useState<PlayerCardResponse | null>(
    () => cache.get(playerId) ?? null,
  );
  const [error, setError] = useState(false);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/leaderboard/player-card/${encodeURIComponent(playerId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as PlayerCardResponse;
        if (!cancelled) {
          cache.set(playerId, json);
          setData(json);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, data]);

  // Default-select the focusRound when data arrives; user picks
  // override afterwards.
  useEffect(() => {
    if (data && selectedRound == null && data.focusRound != null) {
      setSelectedRound(data.focusRound);
    }
  }, [data, selectedRound]);

  if (error) {
    return (
      <div className="lb-card-panel lb-card-panel-empty">
        Couldn&apos;t load this player&apos;s scorecard. Try again in a moment.
      </div>
    );
  }
  if (!data) {
    return <div className="lb-card-panel lb-card-panel-loading" aria-busy="true" />;
  }

  const displayRound = selectedRound ?? data.focusRound;
  const displayHoles =
    displayRound != null ? data.holesByRound[displayRound] ?? [] : [];
  const front = displayHoles.slice(0, 9);
  const back = displayHoles.slice(9, 18);
  const frontPar = front.reduce((a, h) => a + h.par, 0);
  const backPar = back.reduce((a, h) => a + h.par, 0);
  const frontStrokes = front.reduce((a, h) => a + (h.score ?? 0), 0);
  const backStrokes = back.reduce((a, h) => a + (h.score ?? 0), 0);
  const frontPlayed = front.filter((h) => h.score != null).length;
  const backPlayed = back.filter((h) => h.score != null).length;
  const frontTo = frontPlayed > 0 ? frontStrokes - frontPar : null;
  const backTo = backPlayed > 0 ? backStrokes - backPar : null;

  return (
    <div className="lb-card-panel">
      <div className="lb-round-row" role="tablist">
        {[1, 2, 3, 4].map((roundNum) => {
          const rs = data.rounds.find((r) => r.round === roundNum);
          const toPar = rs?.toPar ?? null;
          const isSelected = displayRound === roundNum;
          const hasData = !!data.holesByRound[roundNum];
          return (
            <button
              type="button"
              key={roundNum}
              role="tab"
              aria-selected={isSelected}
              disabled={!hasData}
              onClick={() => hasData && setSelectedRound(roundNum)}
              className={`${roundChipClass(toPar)} ${isSelected ? "lb-round-chip-focus" : ""} ${!hasData ? "lb-round-chip-disabled" : ""}`}
            >
              <span className="lb-round-chip-num">R{roundNum}</span>
              <span className="lb-round-chip-topar">{fmtToPar(toPar)}</span>
            </button>
          );
        })}
      </div>

      {displayRound != null && displayHoles.length > 0 && (
        <div className="lb-card-holes">
          <div className="lb-card-holes-head">
            <span>R{displayRound} · front</span>
            <span>{frontTo == null ? "—" : fmtToPar(frontTo)}</span>
          </div>
          <div className="lb-card-row">
            {front.map((h) => (
              <span
                key={h.hole}
                className={cellClass(h.par, h.score)}
                title={`Hole ${h.hole} · par ${h.par}`}
              >
                {h.score ?? ""}
              </span>
            ))}
          </div>
          <div className="lb-card-holes-head">
            <span>back</span>
            <span>{backTo == null ? "—" : fmtToPar(backTo)}</span>
          </div>
          <div className="lb-card-row">
            {back.map((h) => (
              <span
                key={h.hole}
                className={cellClass(h.par, h.score)}
                title={`Hole ${h.hole} · par ${h.par}`}
              >
                {h.score ?? ""}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="lb-card-stats">
        <div className="lb-card-stat">
          <span className="lb-card-stat-num">{data.totals.birdies}</span>
          <span className="lb-card-stat-lbl">Birdies</span>
        </div>
        {data.totals.eagles > 0 && (
          <div className="lb-card-stat">
            <span className="lb-card-stat-num">{data.totals.eagles}</span>
            <span className="lb-card-stat-lbl">Eagles</span>
          </div>
        )}
        <div className="lb-card-stat">
          <span className="lb-card-stat-num">{data.totals.bogeys}</span>
          <span className="lb-card-stat-lbl">Bogeys</span>
        </div>
        {data.totals.doubles > 0 && (
          <div className="lb-card-stat">
            <span className="lb-card-stat-num">{data.totals.doubles}</span>
            <span className="lb-card-stat-lbl">Doubles+</span>
          </div>
        )}
        {data.totals.bestRound != null && (
          <div className="lb-card-stat">
            <span className="lb-card-stat-num">{data.totals.bestRound}</span>
            <span className="lb-card-stat-lbl">Best round</span>
          </div>
        )}
        {data.totals.scoringAvg != null && (
          <div className="lb-card-stat">
            <span className="lb-card-stat-num">
              {data.totals.scoringAvg.toFixed(1)}
            </span>
            <span className="lb-card-stat-lbl">Avg</span>
          </div>
        )}
      </div>

      <Link
        className="lb-card-profile"
        href={`/live/player/${encodeURIComponent(playerId)}`}
      >
        View full profile →
      </Link>
    </div>
  );
}
