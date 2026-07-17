"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Chart from "./Chart";
import MainNav from "@/app/MainNav";
import AuthChip from "@/app/live/auth/AuthChip";
import { BRAND } from "@/lib/brand";

export interface Row {
  dgId: string;
  name: string;
  round: 1 | 2;
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
  count?: number;
  countByRound?: { r1: number; r2: number };
  generatedAt?: number;
  rows?: Row[];
}

/** Poll cadence — 60 s is plenty for a golf round; players finish
 *  at roughly 15 min intervals so refreshing more often is waste. */
const POLL_MS = 60_000;

export default function Page() {
  const [data, setData] = useState<FetchResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/analysis/tee-time-scoring", {
        cache: "no-store",
      });
      const json = (await res.json()) as FetchResp;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

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
              ? `R1: ${data.countByRound.r1} · R2: ${data.countByRound.r2}`
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
