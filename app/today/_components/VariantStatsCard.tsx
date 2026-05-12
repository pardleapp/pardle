"use client";

import Link from "next/link";
import { useState } from "react";
import type { GameDayStats, StatsGameId } from "@/lib/stats-backend";

interface Meta {
  name: string;
  emoji: string;
  accent: string;
  maxScore: number;
}

interface Variant {
  /** Storage key ("easy" / "medium" / "hard"). */
  id: string;
  /** Display label ("Easy"). */
  label: string;
  stats: GameDayStats;
}

interface Props {
  game: StatsGameId;
  meta: Meta;
  variants: Variant[];
  /** Storage key of the variant shown by default. */
  initialVariantId: string;
}

function winRate(g: GameDayStats): number | null {
  if (g.total === 0) return null;
  return Math.round((g.wins / g.total) * 100);
}

function averageScore(g: GameDayStats): number | null {
  if (g.wins === 0) return null;
  let sum = 0;
  let count = 0;
  for (const [bucket, n] of Object.entries(g.distribution)) {
    if (bucket === "X") continue;
    sum += Number(bucket) * n;
    count += n;
  }
  if (count === 0) return null;
  return Math.round((sum / count) * 10) / 10;
}

function distributionMax(g: GameDayStats): number {
  return Math.max(1, ...Object.values(g.distribution));
}

export function VariantStatsCard({ game, meta, variants, initialVariantId }: Props) {
  const [selected, setSelected] = useState(initialVariantId);
  const active =
    variants.find((v) => v.id === selected) ?? variants[0];
  const stats = active.stats;
  const wr = winRate(stats);
  const avg = averageScore(stats);
  const distMax = distributionMax(stats);
  const totalAcross = variants.reduce((sum, v) => sum + v.stats.total, 0);

  return (
    <div
      className="today-card today-card-variant"
      style={{ borderColor: meta.accent }}
    >
      <div className="today-card-head">
        <div className="today-card-name">
          <span className="today-card-emoji">{meta.emoji}</span>
          <span style={{ color: meta.accent }}>{meta.name}</span>
        </div>
        <div className="today-card-played">{totalAcross} played</div>
      </div>

      <div
        className="today-variant-toggle"
        role="tablist"
        aria-label={`${meta.name} difficulty`}
      >
        {variants.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={v.id === selected}
            className={`today-variant-btn ${
              v.id === selected ? "today-variant-btn-active" : ""
            }`}
            style={
              v.id === selected
                ? { background: meta.accent, color: "white" }
                : undefined
            }
            onClick={() => setSelected(v.id)}
          >
            {v.label}
            <span className="today-variant-count">{v.stats.total}</span>
          </button>
        ))}
      </div>

      <div className="today-card-rows">
        <div className="today-stat-row">
          <span className="today-stat-label">Solve rate</span>
          <span className="today-stat-value">
            {wr === null ? "—" : `${wr}%`}
          </span>
        </div>
        <div className="today-stat-row">
          <span className="today-stat-label">Avg score</span>
          <span className="today-stat-value">
            {avg === null ? "—" : avg.toFixed(1)}
          </span>
        </div>
      </div>

      {Object.keys(stats.distribution).length > 0 && (
        <div className="today-dist">
          {Array.from({ length: meta.maxScore + 1 }, (_, i) => i).map(
            (bucket) => {
              const count = stats.distribution[String(bucket)] ?? 0;
              const width = (count / distMax) * 100;
              return (
                <div key={bucket} className="today-dist-row">
                  <span className="today-dist-label">{bucket}</span>
                  <span className="today-dist-bar-wrap">
                    <span
                      className="today-dist-bar"
                      style={{
                        width: `${Math.max(width, count > 0 ? 6 : 0)}%`,
                        background: meta.accent,
                      }}
                    />
                  </span>
                  <span className="today-dist-count">{count}</span>
                </div>
              );
            },
          )}
          {stats.distribution["X"] > 0 && (
            <div className="today-dist-row">
              <span className="today-dist-label">X</span>
              <span className="today-dist-bar-wrap">
                <span
                  className="today-dist-bar today-dist-bar-loss"
                  style={{
                    width: `${Math.max(
                      (stats.distribution["X"] / distMax) * 100,
                      6,
                    )}%`,
                  }}
                />
              </span>
              <span className="today-dist-count">
                {stats.distribution["X"]}
              </span>
            </div>
          )}
        </div>
      )}

      <Link href={`/${game}`} className="today-variant-cta">
        Play {meta.name} →
      </Link>
    </div>
  );
}
