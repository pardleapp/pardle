"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Chart from "./Chart";
import Heatmap, { type Cell } from "../course-heatmap/Heatmap";
import MainNav from "@/app/MainNav";
import AuthChip from "@/app/live/auth/AuthChip";
import { BRAND } from "@/lib/brand";
import type { DailyWeatherView } from "../_components/WeatherStrip";

export type RoundNum = 1 | 2 | 3 | 4;

export interface Row {
  dgId: string;
  name: string;
  round: RoundNum;
  teeTime: string;
  teeMinutes: number;
  sgTotal: number;
  toPar: number;
  adjusted: number;
  thru: string | number;
  startHole: number;
  noSkill?: boolean;
  projected?: boolean;
  thruHoles?: number;
  currentToPar?: number;
}

interface FetchResp {
  ok: boolean;
  error?: string;
  source?: "historical";
  year?: number;
  eventName?: string;
  count?: number;
  countByRound?: { r1: number; r2: number; r3?: number; r4?: number };
  generatedAt?: number | null;
  rows?: Row[];
  weatherByRound?: Record<string, DailyWeatherView | null> | null;
}

/** Poll cadence — 60 s is plenty for a golf round; players finish
 *  at roughly 15 min intervals so refreshing more often is waste. */
const POLL_MS = 60_000;

type YearTab = "live" | "2025" | "2024" | "2023";
const YEAR_TABS: YearTab[] = ["live", "2025", "2024", "2023"];

interface HeatmapResp {
  ok: boolean;
  error?: string;
  eventName?: string;
  bucketMinutes?: number;
  cells?: Cell[];
  generatedAt?: number | null;
  weatherByRound?: Record<string, DailyWeatherView | null> | null;
}

type View = "chart" | "heatmap";

export default function Page() {
  const [tab, setTab] = useState<YearTab>("live");
  const [view, setView] = useState<View>("chart");
  const [data, setData] = useState<FetchResp | null>(null);
  const [heat, setHeat] = useState<HeatmapResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = tab === "live" ? "" : `?year=${tab}`;
      if (view === "chart") {
        const res = await fetch(`/api/analysis/tee-time-scoring${qs}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as FetchResp;
        setData(json);
      } else {
        const res = await fetch(`/api/analysis/course-heatmap${qs}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as HeatmapResp;
        setHeat(json);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    }
  }, [tab, view]);

  useEffect(() => {
    setData(null);
    setHeat(null);
    load();
    if (tab !== "live") return;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load, tab, view]);

  return (
    <main className="container container-wide v4-theme pv-theme analysis-full-shell">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="analysis" />
          <AuthChip />
        </div>
      </header>
      <section
        style={{
          // Fill the shell's middle grid track edge-to-edge — no
          // maxWidth cap here (the shell already sizes the track);
          // the shell's column-gap is the gutter to the nav rail.
          padding: "20px 4px 60px",
          fontFamily:
            "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
          color: "oklch(0.2 0.02 150)",
        }}
      >
        <p style={{ fontSize: 12, color: "oklch(0.5 0.02 150)", margin: "0 0 6px" }}>
          <Link
            href="/analysis"
            style={{ color: "oklch(0.5 0.02 150)", textDecoration: "none" }}
          >
            ← All analyses
          </Link>
        </p>
        <h2 style={{ fontSize: 22, marginBottom: 4 }}>
          {view === "chart"
            ? "Skill-adjusted score vs tee time"
            : "Field scoring by hole and hour"}
        </h2>
        <p style={{ fontSize: 13, color: "oklch(0.5 0.02 150)", margin: 0 }}>
          {view === "chart" ? (
            <>
              Every finisher of a round plotted at their tee time, adjusted
              for pre-tournament skill. Points below zero outperformed
              baseline, above zero under-performed. Refreshes as new players
              finish.
            </>
          ) : (
            <>
              Field-average strokes vs par for every hole across each hour
              of the day, per-round scoring summary and per-hour weather.
              Reveals which waves had it easier and which holes bit hardest.
            </>
          )}
        </p>
        <div
          role="tablist"
          aria-label="View"
          style={{
            display: "flex",
            gap: 4,
            marginTop: 12,
            marginBottom: 4,
            flexWrap: "wrap",
          }}
        >
          {(
            [
              { key: "chart", label: "Tee time vs score" },
              { key: "heatmap", label: "Scoring by hole/hour" },
            ] as { key: View; label: string }[]
          ).map((v) => {
            const active = view === v.key;
            return (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setView(v.key)}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: "1px solid oklch(0.85 0.013 95)",
                  background: active
                    ? "oklch(0.50 0.13 155)"
                    : "white",
                  color: active ? "white" : "oklch(0.3 0.02 150)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {v.label}
              </button>
            );
          })}
        </div>
        <div
          role="tablist"
          aria-label="Year"
          style={{
            display: "flex",
            gap: 4,
            marginTop: 12,
            marginBottom: 4,
            flexWrap: "wrap",
          }}
        >
          {YEAR_TABS.map((t) => {
            const active = tab === t;
            const label = t === "live" ? "Live" : t;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t)}
                style={{
                  padding: "5px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  borderRadius: 6,
                  border: "1px solid oklch(0.85 0.013 95)",
                  background: active ? "oklch(0.25 0.02 150)" : "white",
                  color: active ? "white" : "oklch(0.3 0.02 150)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {tab !== "live" && (
          <p
            style={{
              fontSize: 11,
              color: "oklch(0.55 0.02 150)",
              margin: "4px 0 0",
            }}
          >
            {data?.eventName ?? "3M Open"} {tab} — TPC Twin Cities.
            Skill baseline is each player&apos;s pre-tournament projection;
            deviation from that is what the y-axis shows.
          </p>
        )}
      {error ? (
        <p style={{ marginTop: 20, color: "oklch(0.5 0.16 25)" }}>
          Couldn&apos;t load data: {error}
        </p>
      ) : view === "chart" ? (
        !data || !data.ok ? (
          <p style={{ marginTop: 20 }}>
            {!data ? "Loading…" : `Couldn't load data: ${data.error}`}
          </p>
        ) : !data.rows || data.rows.length === 0 ? (
          <p style={{ marginTop: 20 }}>
            Nobody has finished R1 yet — check back after the first group is
            done.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 11, color: "oklch(0.55 0.02 150)", marginTop: 8 }}>
              {data.countByRound
                ? [
                    data.countByRound.r1 != null && `R1: ${data.countByRound.r1}`,
                    data.countByRound.r2 != null && `R2: ${data.countByRound.r2}`,
                    data.countByRound.r3 != null && `R3: ${data.countByRound.r3}`,
                    data.countByRound.r4 != null && `R4: ${data.countByRound.r4}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : `${data.count} rows`}
              {" · "}
              {data.generatedAt
                ? `updated ${new Date(data.generatedAt).toLocaleTimeString()}`
                : ""}
            </p>
            <Chart rows={data.rows} weatherByRound={data.weatherByRound} />
          </>
        )
      ) : (
        // view === "heatmap"
        !heat || !heat.ok ? (
          <p style={{ marginTop: 20 }}>
            {!heat ? "Loading…" : `Couldn't load data: ${heat.error}`}
          </p>
        ) : !heat.cells || heat.cells.length === 0 ? (
          <p style={{ marginTop: 20 }}>
            No completed rounds yet.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 11, color: "oklch(0.55 0.02 150)", marginTop: 8 }}>
              {heat.cells.length} cells ·{" "}
              {heat.generatedAt
                ? `updated ${new Date(heat.generatedAt).toLocaleTimeString()}`
                : ""}
              {" · "}
              Hole completion times estimated from tee time + ~15 min per hole.
            </p>
            <Heatmap
              cells={heat.cells}
              bucketMinutes={heat.bucketMinutes ?? 15}
              weatherByRound={heat.weatherByRound}
            />
          </>
        )
      )}
      </section>
    </main>
  );
}
