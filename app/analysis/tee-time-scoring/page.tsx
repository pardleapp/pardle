"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Chart from "./Chart";
import MainNav from "@/app/MainNav";
import AuthChip from "@/app/live/auth/AuthChip";
import { BRAND } from "@/lib/brand";

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
}

/** Poll cadence — 60 s is plenty for a golf round; players finish
 *  at roughly 15 min intervals so refreshing more often is waste. */
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
      const res = await fetch(`/api/analysis/tee-time-scoring${qs}`, {
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
    setData(null);
    load();
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
          maxWidth: 1200,
          margin: "0 auto",
          padding: "20px 16px 60px",
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
          Skill-adjusted score vs tee time
        </h2>
        <p style={{ fontSize: 13, color: "oklch(0.5 0.02 150)", margin: 0 }}>
          Every finisher of a round plotted at their tee time, adjusted for
          pre-tournament skill. Points below zero outperformed baseline,
          above zero under-performed. Refreshes as new players finish.
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
            {data?.eventName ?? "3M Open"} {tab} — TPC Twin Cities. Skill
            baseline is the player&apos;s own 4-round average that week;
            deviation from that is what the y-axis shows.
          </p>
        )}
      {error || (data && !data.ok) ? (
        <p style={{ marginTop: 20, color: "oklch(0.5 0.16 25)" }}>
          Couldn&apos;t load data: {error ?? data?.error}
        </p>
      ) : !data ? (
        <p style={{ marginTop: 20 }}>Loading…</p>
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
          <Chart rows={data.rows} />
        </>
      )}
      </section>
    </main>
  );
}
