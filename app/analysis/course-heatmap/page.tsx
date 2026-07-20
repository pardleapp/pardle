"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import MainNav from "@/app/MainNav";
import AuthChip from "@/app/live/auth/AuthChip";
import { BRAND } from "@/lib/brand";
import Heatmap, { type Cell } from "./Heatmap";
import WeatherStrip, { type DailyWeatherView } from "../_components/WeatherStrip";

interface FetchResp {
  ok: boolean;
  error?: string;
  source?: "historical";
  year?: number;
  eventName?: string;
  bucketMinutes?: number;
  cells?: Cell[];
  generatedAt?: number | null;
  roundRanges?: Record<
    number,
    { minMins: number; maxMins: number; cellCount: number }
  >;
  weatherByRound?: Record<string, DailyWeatherView | null> | null;
}

const POLL_MS = 60_000;
type YearTab = "live" | "2025" | "2024" | "2023";
const YEAR_TABS: YearTab[] = ["live", "2025", "2024", "2023"];

export default function Page() {
  const [tab, setTab] = useState<YearTab>("live");
  const [data, setData] = useState<FetchResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = tab === "live" ? "" : `?year=${tab}`;
      const res = await fetch(`/api/analysis/course-heatmap${qs}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as FetchResp;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    }
  }, [tab]);

  useEffect(() => {
    // Reset the previous tab's data so we don't briefly render stale
    // cells from another year while the new fetch is in flight.
    setData(null);
    load();
    // Only the live tab polls; historical files never change.
    if (tab !== "live") return;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load, tab]);

  return (
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="analysis" />
          <AuthChip />
        </div>
      </header>
      <section
        style={{
          width: "100%",
          maxWidth: "100%",
          margin: "0 auto",
          padding: "20px 16px 60px",
          fontFamily:
            "var(--font-archivo), 'Archivo', system-ui, -apple-system, sans-serif",
          color: "oklch(0.2 0.02 150)",
          minWidth: 0,
        }}
      >
        <p
          style={{ fontSize: 12, color: "oklch(0.5 0.02 150)", margin: "0 0 6px" }}
        >
          <Link
            href="/analysis"
            style={{ color: "oklch(0.5 0.02 150)", textDecoration: "none" }}
          >
            ← All analyses
          </Link>
        </p>
        <h2 style={{ fontSize: 22, marginBottom: 4 }}>
          Course difficulty by hole and time
        </h2>
        <p style={{ fontSize: 13, color: "oklch(0.5 0.02 150)", margin: 0 }}>
          Heatmap of field average strokes vs par for every hole across the
          day. Green cells were easier than par; red cells were harder.
          Scanning a row shows when a specific hole started biting; scanning
          a column shows which holes were toughest at a specific hour.
        </p>
        <p
          style={{
            fontSize: 11,
            color: "oklch(0.55 0.02 150)",
            marginTop: 6,
            fontStyle: "italic",
          }}
        >
          Hole completion times estimated from tee time + ~15 min per hole.
          Actual timing may vary by ±10 min for slow / fast groups.
        </p>
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
            {data?.eventName ?? "3M Open"} {tab} — TPC Twin Cities. Historical
            data; won&apos;t refresh.
          </p>
        )}
        {error || (data && !data.ok) ? (
          <p style={{ marginTop: 20, color: "oklch(0.5 0.16 25)" }}>
            Couldn&apos;t load data: {error ?? data?.error}
          </p>
        ) : !data ? (
          <p style={{ marginTop: 20 }}>Loading…</p>
        ) : !data.cells || data.cells.length === 0 ? (
          <p style={{ marginTop: 20 }}>
            No completed rounds yet.
          </p>
        ) : (
          <>
            <p
              style={{
                fontSize: 11,
                color: "oklch(0.55 0.02 150)",
                marginTop: 8,
              }}
            >
              {data.cells.length} cells ·{" "}
              {data.generatedAt
                ? `updated ${new Date(data.generatedAt).toLocaleTimeString()}`
                : ""}
            </p>
            <WeatherStrip weatherByRound={data.weatherByRound} />
            <Heatmap cells={data.cells} bucketMinutes={data.bucketMinutes ?? 15} />
          </>
        )}
      </section>
    </main>
  );
}
